import { excess, intersect, isCovered, minimal, union } from './scope.ts'
import { policyKey } from './normalize.ts'
import { compareStrings } from './scope.ts'
import type {
  Action,
  AuthorizationPolicy,
  ChainBreak,
  Delegation,
  EvidenceBundle,
  Principal,
  Scope,
} from './types.ts'

/**
 * Chain reconstruction.
 *
 * A delegation chain is walked from the actor's delegation back to a root
 * principal using recorded `parent_delegation_id` references. When a record
 * does not carry the reference, REGENT looks for the delegator's inbound
 * delegations in the registry and links only when exactly one candidate
 * exists; zero is an orphan and more than one is ambiguous. Nothing is ever
 * assumed: a hop that cannot be linked breaks the chain.
 */

export const MAX_CHAIN_DEPTH = 32

export interface Index {
  bundle: EvidenceBundle
  principals: Map<string, Principal>
  delegations: Map<string, Delegation>
  policies: Map<string, AuthorizationPolicy>
  /** Delegations by delegatee, sorted by created_at then id. */
  inbound: Map<string, Delegation[]>
}

export function buildIndex(bundle: EvidenceBundle): Index {
  const principals = new Map(bundle.principals.map((p) => [p.principal_id, p]))
  const delegations = new Map(bundle.delegations.map((d) => [d.delegation_id, d]))
  const policies = new Map(bundle.policies.map((p) => [policyKey(p.policy_id, p.policy_version), p]))
  const inbound = new Map<string, Delegation[]>()
  for (const d of bundle.delegations) {
    if (!d.delegatee_principal_id) continue
    const list = inbound.get(d.delegatee_principal_id) ?? []
    list.push(d)
    inbound.set(d.delegatee_principal_id, list)
  }
  for (const list of inbound.values()) {
    list.sort((a, b) => compareStrings(a.created_at ?? '', b.created_at ?? '') || compareStrings(a.delegation_id, b.delegation_id))
  }
  return { bundle, principals, delegations, policies, inbound }
}

export interface DelegationAnalysis {
  delegation: Delegation
  /** Root-first path ending with this delegation. */
  path: Delegation[]
  /** links[i] says how path[i] was linked to path[i-1]. links[0] describes the root hop. */
  links: ('explicit' | 'lookup')[]
  root_principal_id: string | null
  /** Breaks anywhere on the path, including this delegation's own. */
  breaks: ChainBreak[]
  /** The delegator's effective scope. Null when it cannot be established. */
  available: Scope | null
  /** granted ∩ available ∩ ceiling, or, when available is unknown, an upper bound granted ∩ ceiling. */
  effective: Scope | null
  /** True when `effective` is only an upper bound because something upstream is unknown. */
  effective_is_bound: boolean
  /** True when the root principal's own authority was recorded (provisioned_scope present). */
  root_authority_recorded: boolean
  /** Authority this hop newly introduced: granted but not held by the delegator, and not already amplified upstream. */
  amplified: Scope
  /** Authority amplified at an earlier hop that this delegation's lineage carries. */
  inherited_amplified: Scope
  policy_restricted: Scope
  policy: AuthorizationPolicy | null
}

const CYCLE = Symbol('cycle')
/** Recursion guard, independent of the semantic hop limit, so a hostile 50k-hop chain cannot exhaust the stack. */
const RECURSION_LIMIT = 512

export class ChainAnalyzer {
  private readonly memo = new Map<string, DelegationAnalysis>()
  private readonly inProgress = new Set<string>()
  private readonly ix: Index
  private readonly maxDepth: number

  constructor(ix: Index, maxDepth = MAX_CHAIN_DEPTH) {
    this.ix = ix
    this.maxDepth = maxDepth
  }

  analyze(d: Delegation): DelegationAnalysis {
    const r = this.walk(d, 0)
    if (r === CYCLE) {
      // Only reachable if analyze() is re-entered for a node on the stack; walk() handles cycles itself.
      return this.memo.get(d.delegation_id) ?? this.cycleResult(d)
    }
    return r
  }

  private cycleResult(d: Delegation): DelegationAnalysis {
    return {
      delegation: d,
      path: [d],
      links: ['explicit'],
      root_principal_id: null,
      breaks: [{ kind: 'cycle', delegation_id: d.delegation_id }],
      available: null,
      effective: null,
      effective_is_bound: true,
      root_authority_recorded: false,
      amplified: [],
      inherited_amplified: [],
      policy_restricted: [],
      policy: null,
    }
  }

  private tooDeep(d: Delegation, hops: number): DelegationAnalysis {
    return { ...this.cycleResult(d), breaks: [{ kind: 'too_deep', depth: hops }] }
  }

  private walk(d: Delegation, depth: number): DelegationAnalysis | typeof CYCLE {
    const cached = this.memo.get(d.delegation_id)
    if (cached) return cached
    if (this.inProgress.has(d.delegation_id)) return CYCLE
    if (depth >= RECURSION_LIMIT) return this.tooDeep(d, depth)
    this.inProgress.add(d.delegation_id)

    const own: ChainBreak[] = []
    let parent: DelegationAnalysis | null = null
    let link: 'explicit' | 'lookup' = 'explicit'
    let isRootHop = false
    const delegatorId = d.delegator_principal_id
    const delegator = delegatorId ? this.ix.principals.get(delegatorId) : undefined

    if (!delegatorId) {
      own.push({ kind: 'no_root', principal_id: null, delegation_id: d.delegation_id })
    } else {
      if (!delegator) own.push({ kind: 'unknown_principal', principal_id: delegatorId, role: 'delegator' })
      let parentDelegation: Delegation | undefined
      if (d.parent_delegation_id) {
        parentDelegation = this.ix.delegations.get(d.parent_delegation_id)
        if (!parentDelegation) own.push({ kind: 'missing_delegation', delegation_id: d.parent_delegation_id, referenced_by: d.delegation_id })
      } else if (delegator?.root_eligible) {
        isRootHop = true
      } else {
        const candidates = (this.ix.inbound.get(delegatorId) ?? []).filter(
          (c) => c.delegation_id !== d.delegation_id && (c.created_at === null || d.created_at === null || c.created_at <= d.created_at),
        )
        if (candidates.length === 1) {
          parentDelegation = candidates[0]
          link = 'lookup'
        } else if (candidates.length === 0) {
          own.push({ kind: 'no_root', principal_id: delegatorId, delegation_id: d.delegation_id })
        } else {
          own.push({ kind: 'ambiguous', principal_id: delegatorId, candidates: candidates.map((c) => c.delegation_id) })
        }
      }
      if (parentDelegation) {
        const p = this.walk(parentDelegation, depth + 1)
        if (p === CYCLE) {
          own.push({ kind: 'cycle', delegation_id: d.delegation_id })
        } else if (p.path.length >= this.maxDepth) {
          // The hop limit is semantic (path length), not the recursion depth of whichever
          // delegation happened to be analyzed first, so the result is order-independent.
          this.inProgress.delete(d.delegation_id)
          const result = this.tooDeep(d, p.path.length + 1)
          this.memo.set(d.delegation_id, result)
          return result
        } else {
          parent = p
          if (parentDelegation.delegatee_principal_id !== delegatorId) {
            own.push({ kind: 'delegatee_mismatch', delegation_id: parentDelegation.delegation_id, expected: delegatorId, recorded: parentDelegation.delegatee_principal_id })
          }
        }
      }
    }

    const rootId = parent ? parent.root_principal_id : isRootHop ? delegatorId : null
    if (rootId && d.root_principal_id && d.root_principal_id !== rootId) {
      own.push({ kind: 'root_mismatch', declared: d.root_principal_id, reconstructed: rootId, where: d.delegation_id })
    }

    // Scopes, root first.
    const policy = d.policy_id ? (this.ix.policies.get(policyKey(d.policy_id, d.policy_version)) ?? null) : null
    const ceiling = policy?.scope_ceiling ?? null
    let available: Scope | null = null
    let rootAuthorityRecorded = false
    let upstreamBound = false
    if (parent) {
      // The parent's effective scope is exact, or an upper bound when something upstream is
      // unknown. Excess over an upper bound is still definite amplification; only a PASS is
      // weakened, which `effective_is_bound` carries forward. If the parent delegation was
      // issued to someone else, the delegator holds nothing through it at all.
      const misissued = own.some((b) => b.kind === 'delegatee_mismatch')
      available = misissued ? null : parent.effective
      rootAuthorityRecorded = parent.root_authority_recorded
      upstreamBound = parent.effective_is_bound || parent.breaks.length > 0
    } else if (isRootHop && delegator) {
      available = delegator.provisioned_scope
      rootAuthorityRecorded = delegator.provisioned_scope !== null
    }

    // Authority amplified upstream is reported once, at the hop where it entered. A later
    // delegator re-granting it holds it nominally, so the later hop is not a new break.
    const inherited: Scope = parent ? union(parent.inherited_amplified, parent.amplified) : []
    let effective: Scope | null = null
    let amplified: Scope = []
    let restricted: Scope = []
    let isBound = upstreamBound || own.length > 0 || available === null
    if (d.granted_scope !== null) {
      const base = available !== null ? intersect(d.granted_scope, available) : minimal(d.granted_scope)
      amplified = available !== null ? excess(d.granted_scope, available).filter((p) => !isCovered(p, inherited)) : []
      effective = ceiling ? intersect(base, ceiling) : base
      restricted = ceiling ? excess(base, ceiling) : []
    } else {
      isBound = true
    }
    if (parent && parent.effective === null) isBound = true

    const result: DelegationAnalysis = {
      delegation: d,
      path: parent ? [...parent.path, d] : [d],
      links: parent ? [...parent.links, link] : [link],
      root_principal_id: rootId,
      breaks: [...(parent?.breaks ?? []), ...own],
      available,
      effective,
      effective_is_bound: isBound,
      root_authority_recorded: rootAuthorityRecorded,
      amplified,
      inherited_amplified: inherited,
      policy_restricted: restricted,
      policy,
    }
    this.inProgress.delete(d.delegation_id)
    this.memo.set(d.delegation_id, result)
    return result
  }

  /** Breaks that belong to this delegation alone, not inherited from its ancestors. */
  ownBreaks(d: Delegation): ChainBreak[] {
    const a = this.analyze(d)
    const parent = a.path.length > 1 ? this.memo.get(a.path[a.path.length - 2]!.delegation_id) : undefined
    const inherited = parent ? parent.breaks.length : 0
    return a.breaks.slice(inherited)
  }
}

export interface ActorResolution {
  delegation: Delegation | null
  resolution: 'explicit' | 'lookup' | 'direct' | 'none'
  breaks: ChainBreak[]
}

/** Locate the delegation under which the actor performed the action. */
export function resolveActorDelegation(ix: Index, a: Action): ActorResolution {
  const breaks: ChainBreak[] = []
  const actorId = a.actor_principal_id
  if (!actorId) return { delegation: null, resolution: 'none', breaks: [{ kind: 'no_delegation', principal_id: null }] }
  const actor = ix.principals.get(actorId)
  if (!actor) breaks.push({ kind: 'unknown_principal', principal_id: actorId, role: 'actor' })

  if (a.delegation_id) {
    const d = ix.delegations.get(a.delegation_id)
    if (!d) {
      breaks.push({ kind: 'missing_delegation', delegation_id: a.delegation_id, referenced_by: a.event_id })
      return { delegation: null, resolution: 'explicit', breaks }
    }
    if (d.delegatee_principal_id !== actorId) {
      breaks.push({ kind: 'delegatee_mismatch', delegation_id: d.delegation_id, expected: actorId, recorded: d.delegatee_principal_id })
    }
    return { delegation: d, resolution: 'explicit', breaks }
  }

  if (actor?.root_eligible) return { delegation: null, resolution: 'direct', breaks }

  let candidates = (ix.inbound.get(actorId) ?? []).filter((d) => a.timestamp === null || d.created_at === null || d.created_at <= a.timestamp)
  if (a.parent_principal_id) candidates = candidates.filter((d) => d.delegator_principal_id === a.parent_principal_id)
  if (candidates.length > 1 && a.root_principal_id) {
    const narrowed = candidates.filter((d) => d.root_principal_id === a.root_principal_id)
    if (narrowed.length > 0) candidates = narrowed
  }
  if (candidates.length === 1) return { delegation: candidates[0]!, resolution: 'lookup', breaks }
  if (candidates.length === 0) {
    breaks.push({ kind: 'no_delegation', principal_id: actorId })
    return { delegation: null, resolution: 'none', breaks }
  }
  breaks.push({ kind: 'ambiguous', principal_id: actorId, candidates: candidates.map((c) => c.delegation_id) })
  return { delegation: null, resolution: 'none', breaks }
}

export function describeBreak(b: ChainBreak): string {
  switch (b.kind) {
    case 'missing_delegation':
      return `${b.referenced_by} references delegation ${b.delegation_id}, which is not in the evidence.`
    case 'delegatee_mismatch':
      return `Delegation ${b.delegation_id} was issued to ${b.recorded ?? 'nobody'}, but the chain needs it to be held by ${b.expected ?? 'an unnamed principal'}.`
    case 'cycle':
      return `Delegation ${b.delegation_id} is part of a cycle: following its parents leads back to itself.`
    case 'too_deep':
      return `The chain exceeds ${b.depth - 1} hops and was not followed further.`
    case 'no_root':
      return b.principal_id
        ? `${b.principal_id} delegated authority (${b.delegation_id ?? 'unknown delegation'}) but holds no recorded authority of its own and is not a root principal.`
        : `Delegation ${b.delegation_id ?? ''} does not name a delegator.`
    case 'no_delegation':
      return b.principal_id
        ? `${b.principal_id} acted but no delegation to it is recorded, and it is not a root principal.`
        : 'The action does not name the principal that performed it.'
    case 'ambiguous':
      return `${b.principal_id} holds ${b.candidates.length} delegations (${b.candidates.join(', ')}) and the record does not say which one it acted under.`
    case 'unknown_principal':
      return `${b.principal_id} (${b.role}) is not in the identity registry.`
    case 'root_mismatch':
      return `${b.where} declares root principal ${b.declared}, but the chain reconstructs to ${b.reconstructed ?? 'no root'}.`
    case 'parent_mismatch':
      return `The action declares ${b.declared} as the actor's delegator, but the chain reconstructs to ${b.reconstructed ?? 'no delegator'}.`
  }
}
