import { buildIndex, ChainAnalyzer, describeBreak, resolveActorDelegation, MAX_CHAIN_DEPTH } from './chain.ts'
import type { DelegationAnalysis } from './chain.ts'
import { canonicalJson, digestOf, sha256, shortHash } from './digest.ts'
import { policyKey } from './normalize.ts'
import { DEFAULT_RULESET, FINDING_CODE, FINDING_TITLE, RULE_FOR_FINDING, SEVERITY_ORDER } from './rules.ts'
import { canonical, compareStrings, covers, excess, formatScope, intersect, isCovered, union } from './scope.ts'
import type {
  Action,
  ActionVerification,
  AuthorizationDecision,
  ChainBreak,
  CheckResult,
  Delegation,
  DimensionCheck,
  EvidenceBundle,
  EvidenceKind,
  EvidenceRef,
  ExecutionEdge,
  Finding,
  FindingType,
  PrincipalType,
  RecordCompleteness,
  ReconstructedChain,
  ResolvedHop,
  RuleConfig,
  RuleId,
  RuleSet,
  RunSummary,
  Scope,
  Severity,
  VerificationDimension,
  VerificationRun,
} from './types.ts'

export const ENGINE_VERSION = '0.1.0'

export interface CompletenessField {
  name: keyof Action
  critical: boolean
  /** Why the field matters, shown next to a gap. */
  why: string
}

export interface CompletenessSchema {
  schema_id: string
  fields: CompletenessField[]
}

/** The default audit-record schema. Critical fields are the ones attribution and scope checks depend on. */
export const DEFAULT_COMPLETENESS_SCHEMA: CompletenessSchema = {
  schema_id: 'regent.action-record/v1',
  fields: [
    { name: 'event_id', critical: true, why: 'Immutable identity of the record.' },
    { name: 'timestamp', critical: true, why: 'Action-time checks need to know when the action ran.' },
    { name: 'root_principal_id', critical: true, why: 'Names the human or root principal the action is attributed to.' },
    { name: 'actor_principal_id', critical: true, why: 'Names the principal that performed the action.' },
    { name: 'delegation_id', critical: false, why: 'Links the action to the delegation it relied on, so the chain is not reconstructed by lookup.' },
    { name: 'tool_id', critical: false, why: 'Which interface executed the action.' },
    { name: 'resource_id', critical: false, why: 'What the action operated on.' },
    { name: 'operation', critical: false, why: 'What the action did.' },
    { name: 'parameters', critical: false, why: 'The inputs the action was invoked with.' },
    { name: 'requested_scope', critical: true, why: 'What authority the action asked for. Without it, the decision cannot be re-checked.' },
    { name: 'exercised_scope', critical: true, why: 'What authority the action used. Without it, containment cannot be verified.' },
    { name: 'execution_identity_id', critical: false, why: 'Which workload identity the action ran as.' },
    { name: 'credential_id', critical: false, why: 'Which credential authenticated the execution.' },
    { name: 'policy_id', critical: false, why: 'Which policy made the decision.' },
    { name: 'policy_version', critical: false, why: 'Which exact revision of the policy made the decision.' },
    { name: 'recorded_decision', critical: false, why: 'What the system decided.' },
    { name: 'decision_reason', critical: false, why: 'Why the system decided it.' },
    { name: 'authorization_evaluated_at', critical: false, why: 'Whether the decision was made at action time or reused from earlier.' },
    { name: 'approval_state', critical: false, why: 'Whether a required approval was in place.' },
    { name: 'downstream_result', critical: false, why: 'Whether the action took effect.' },
  ],
}

export interface VerifyOptions {
  ruleset?: RuleSet
  completeness?: CompletenessSchema
  maxDepth?: number
}

type Invalidation = {
  kind: 'delegation' | 'principal' | 'execution_identity' | 'credential'
  id: string
  state: 'EXPIRED' | 'REVOKED' | 'SUSPENDED' | 'NOT_YET_VALID'
  at: string | null
}

/**
 * Verify a normalized evidence bundle. Pure: no I/O, no clock, no randomness.
 * The same bundle and rule set always yield a byte-identical run.
 */
export function verify(bundle: EvidenceBundle, options: VerifyOptions = {}): VerificationRun {
  const ruleset = options.ruleset ?? DEFAULT_RULESET
  const schema = options.completeness ?? DEFAULT_COMPLETENESS_SCHEMA
  const ix = buildIndex(bundle)
  const analyzer = new ChainAnalyzer(ix, options.maxDepth ?? MAX_CHAIN_DEPTH)
  const rules = new Map(ruleset.rules.map((r) => [r.rule_id, r]))
  const execIds = new Map(bundle.execution_identities.map((e) => [e.execution_identity_id, e]))
  const credentials = new Map(bundle.credentials.map((c) => [c.credential_id, c]))
  const tools = new Map(bundle.tools.map((t) => [t.tool_id, t]))
  const resources = new Map(bundle.resources.map((r) => [r.resource_id, r]))

  const digests = new Map<string, string>()
  const put = (kind: EvidenceKind, id: string, rec: unknown) => digests.set(`${kind}:${id}`, digestOf(rec))
  bundle.principals.forEach((r) => put('principal', r.principal_id, r))
  bundle.execution_identities.forEach((r) => put('execution_identity', r.execution_identity_id, r))
  bundle.credentials.forEach((r) => put('credential', r.credential_id, r))
  bundle.tools.forEach((r) => put('tool', r.tool_id, r))
  bundle.resources.forEach((r) => put('resource', r.resource_id, r))
  bundle.policies.forEach((r) => put('policy', policyKey(r.policy_id, r.policy_version), r))
  bundle.delegations.forEach((r) => put('delegation', r.delegation_id, r))
  bundle.actions.forEach((r) => put('action', r.action_id, r))

  const name = (id: string | null | undefined): string => {
    if (!id) return 'an unnamed principal'
    return ix.principals.get(id)?.display_name ?? id
  }
  const ref = (kind: EvidenceKind, id: string | null | undefined, note: string, eventId: string | null = null): EvidenceRef | null => {
    if (!id) return null
    return { kind, id, event_id: eventId, digest: digests.get(`${kind}:${id}`) ?? null, note }
  }
  const refs = (...list: (EvidenceRef | null)[]): EvidenceRef[] => list.filter((r): r is EvidenceRef => r !== null)

  // ---------------------------------------------------------------- findings
  const findings = new Map<string, Finding>()

  const ruleActive = (ruleId: RuleId, principalType: PrincipalType | null): RuleConfig | null => {
    const rule = rules.get(ruleId)
    if (!rule || !rule.enabled) return null
    if (rule.applies_to.length > 0 && principalType && !rule.applies_to.includes(principalType)) return null
    return rule
  }

  type Emit = Omit<Finding, 'finding_id' | 'type' | 'rule_id' | 'title' | 'severity' | 'remediation' | 'first_seen' | 'last_seen'> & {
    seen: (string | null)[]
  }
  const emit = (type: FindingType, subject: string, principalType: PrincipalType | null, body: Emit, ruleOverride?: RuleId): string | null => {
    const ruleId = ruleOverride ?? RULE_FOR_FINDING[type]
    const rule = ruleActive(ruleId, principalType)
    if (!rule) return null
    const findingId = `REG-${FINDING_CODE[type]}-${shortHash(`${type}|${ruleId}|${subject}`)}`
    const seen = body.seen.filter((s): s is string => s !== null).sort(compareStrings)
    const existing = findings.get(findingId)
    if (existing) {
      existing.related_event_ids = canonical([...existing.related_event_ids, ...body.related_event_ids])
      existing.affected_principal_ids = canonical([...existing.affected_principal_ids, ...body.affected_principal_ids])
      existing.affected_resource_ids = canonical([...existing.affected_resource_ids, ...body.affected_resource_ids])
      for (const e of body.evidence) {
        if (!existing.evidence.some((x) => x.kind === e.kind && x.id === e.id)) existing.evidence.push(e)
      }
      if (seen[0] && (!existing.first_seen || seen[0] < existing.first_seen)) existing.first_seen = seen[0]
      const last = seen[seen.length - 1]
      if (last && (!existing.last_seen || last > existing.last_seen)) existing.last_seen = last
      return findingId
    }
    findings.set(findingId, {
      finding_id: findingId,
      type,
      rule_id: ruleId,
      title: FINDING_TITLE[type],
      severity: rule.severity,
      summary: body.summary,
      root_cause: body.root_cause,
      remediation: rule.remediation,
      action_id: body.action_id,
      delegation_id: body.delegation_id,
      broken_edge: body.broken_edge,
      affected_principal_ids: canonical(body.affected_principal_ids),
      affected_resource_ids: canonical(body.affected_resource_ids),
      authority_delta: body.authority_delta,
      missing_fields: body.missing_fields,
      evidence: body.evidence,
      related_event_ids: canonical(body.related_event_ids),
      first_seen: seen[0] ?? null,
      last_seen: seen[seen.length - 1] ?? null,
    })
    return findingId
  }

  const base = (): Omit<Emit, 'summary' | 'root_cause'> => ({
    action_id: null,
    delegation_id: null,
    broken_edge: null,
    affected_principal_ids: [],
    affected_resource_ids: [],
    authority_delta: null,
    missing_fields: [],
    evidence: [],
    related_event_ids: [],
    seen: [],
  })

  // ------------------------------------------------- delegation-level checks
  const delegationFindings = new Map<string, string[]>()
  const addDelegationFinding = (delegationId: string, fid: string | null) => {
    if (!fid) return
    const list = delegationFindings.get(delegationId) ?? []
    if (!list.includes(fid)) list.push(fid)
    delegationFindings.set(delegationId, list)
  }

  for (const d of bundle.delegations) {
    const a = analyzer.analyze(d)
    const own = analyzer.ownBreaks(d)
    const delegateeType = d.delegatee_principal_id ? (ix.principals.get(d.delegatee_principal_id)?.principal_type ?? null) : null
    const evidence = refs(
      ref('delegation', d.delegation_id, 'The delegation record.', d.event_id),
      ref('principal', d.delegator_principal_id, 'Delegator.'),
      ref('principal', d.delegatee_principal_id, 'Delegatee.'),
      d.policy_id ? ref('policy', policyKey(d.policy_id, d.policy_version), 'Governing policy.') : null,
    )
    const hopIndex = a.path.length - 1
    const edge = { from: d.delegator_principal_id, to: d.delegatee_principal_id, hop_index: hopIndex, delegation_id: d.delegation_id }
    const related = d.event_id ? [d.event_id] : []

    if (a.amplified.length > 0) {
      addDelegationFinding(d.delegation_id, emit('AUTHORITY_AMPLIFICATION', `grant|${d.delegation_id}`, delegateeType, {
        ...base(),
        delegation_id: d.delegation_id,
        broken_edge: edge,
        summary: `${name(d.delegator_principal_id)} granted ${name(d.delegatee_principal_id)} ${formatScope(a.amplified)}, which ${name(d.delegator_principal_id)} did not hold.`,
        root_cause: `Delegation ${d.delegation_id} grants {${formatScope(d.granted_scope)}}. The delegator's own effective scope was {${formatScope(a.available)}}. A delegation can only pass on authority the delegator holds, so {${formatScope(a.amplified)}} appeared at this hop from nowhere. Any action relying on it is unauthorized even if every downstream check passes.`,
        affected_principal_ids: [d.delegator_principal_id, d.delegatee_principal_id].filter(isString),
        authority_delta: { available: a.available, granted: d.granted_scope, requested: d.requested_scope, effective: a.effective, exercised: null, excess: a.amplified },
        evidence,
        related_event_ids: related,
        seen: [d.created_at],
      }, 'AUTH-010'))
    }
    if (d.granted_scope === null) {
      addDelegationFinding(d.delegation_id, emit('MISSING_DELEGATED_SCOPE', `grant|${d.delegation_id}`, delegateeType, {
        ...base(),
        delegation_id: d.delegation_id,
        broken_edge: edge,
        summary: `Delegation ${d.delegation_id} from ${name(d.delegator_principal_id)} to ${name(d.delegatee_principal_id)} does not record a granted scope.`,
        root_cause: 'Without a granted scope there is no record of what authority was passed on, so nothing the delegatee does can be shown to be within its authority. REGENT does not infer a scope: every downstream scope check is UNKNOWN, not PASS.',
        affected_principal_ids: [d.delegator_principal_id, d.delegatee_principal_id].filter(isString),
        missing_fields: ['granted_scope'],
        evidence,
        related_event_ids: related,
        seen: [d.created_at],
      }))
    }
    if (d.policy_version === null) {
      addDelegationFinding(d.delegation_id, emit('MISSING_POLICY_VERSION', `delegation|${d.delegation_id}`, delegateeType, {
        ...base(),
        delegation_id: d.delegation_id,
        summary: `Delegation ${d.delegation_id} does not record which policy version authorized it.`,
        root_cause: `The delegation ${d.policy_id ? `names policy ${d.policy_id} but no version` : 'names no policy'}. A later change to the policy cannot be distinguished from the policy in force when the delegation was issued, so the decision cannot be reconstructed.`,
        missing_fields: d.policy_id ? ['policy_version'] : ['policy_id', 'policy_version'],
        evidence,
        related_event_ids: related,
        seen: [d.created_at],
      }))
    }
    for (const b of own) {
      const fid = emitBreak(b, d, edge, evidence, related, delegateeType)
      addDelegationFinding(d.delegation_id, fid)
    }
    if (d.delegatee_principal_id && !ix.principals.has(d.delegatee_principal_id)) {
      addDelegationFinding(d.delegation_id, emitUnknown('principal', d.delegatee_principal_id, `delegatee of ${d.delegation_id}`, related, [d.created_at]))
    }
  }

  function emitBreak(b: ChainBreak, d: Delegation, edge: Finding['broken_edge'], evidence: EvidenceRef[], related: string[], ptype: PrincipalType | null): string | null {
    const seen = [d.created_at]
    switch (b.kind) {
      case 'no_root':
        if (b.principal_id) {
          return emit('ORPHANED_PRINCIPAL', `principal|${b.principal_id}`, ix.principals.get(b.principal_id)?.principal_type ?? null, {
            ...base(),
            delegation_id: d.delegation_id,
            broken_edge: edge,
            summary: `${name(b.principal_id)} delegates authority but no delegation to it is recorded.`,
            root_cause: `${describeBreak(b)} Its authority cannot be traced to a root principal, so everything it delegates is unattributable. This is an attribution failure, not proof of misuse.`,
            affected_principal_ids: [b.principal_id],
            evidence,
            related_event_ids: related,
            seen,
          })
        }
        return emit('BROKEN_DELEGATION_CHAIN', `delegation|${d.delegation_id}|no-delegator`, ptype, {
          ...base(), delegation_id: d.delegation_id, broken_edge: edge,
          summary: `Delegation ${d.delegation_id} does not name its delegator.`,
          root_cause: describeBreak(b), missing_fields: ['delegator_principal_id'], evidence, related_event_ids: related, seen,
        })
      case 'unknown_principal':
        return emitUnknown('principal', b.principal_id, `${b.role} in ${d.delegation_id}`, related, seen)
      default:
        return emit('BROKEN_DELEGATION_CHAIN', `delegation|${d.delegation_id}|${b.kind}`, ptype, {
          ...base(),
          delegation_id: d.delegation_id,
          broken_edge: edge,
          summary: `The delegation chain breaks at ${d.delegation_id}.`,
          root_cause: `${describeBreak(b)} Authority cannot be followed past this point, so REGENT cannot confirm where it came from.`,
          affected_principal_ids: [d.delegator_principal_id, d.delegatee_principal_id].filter(isString),
          evidence,
          related_event_ids: related,
          seen,
        })
    }
  }

  function emitUnknown(kind: 'principal' | 'execution_identity' | 'credential' | 'tool' | 'resource', id: string, role: string, related: string[], seen: (string | null)[]): string | null {
    const label = kind.replace('_', ' ')
    return emit('UNKNOWN_REFERENCE', `${kind}|${id}`, null, {
      ...base(),
      summary: `The evidence references ${label} "${id}", which is not registered.`,
      root_cause: `"${id}" appears as the ${role} but has no ${label} record. An unregistered identity cannot hold authority implicitly, so anything that depends on it is unverifiable.`,
      affected_principal_ids: kind === 'principal' ? [id] : [],
      affected_resource_ids: kind === 'resource' ? [id] : [],
      related_event_ids: related,
      seen,
    })
  }

  // ----------------------------------------------------- action-level checks
  const verifications: ActionVerification[] = []

  for (const a of bundle.actions) {
    const t = a.timestamp
    const actor = a.actor_principal_id ? ix.principals.get(a.actor_principal_id) : undefined
    const actorType = actor?.principal_type ?? null
    const res = resolveActorDelegation(ix, a)
    const analysis = res.delegation ? analyzer.analyze(res.delegation) : null
    const actionFindings: string[] = []
    const add = (fid: string | null) => {
      if (fid && !actionFindings.includes(fid)) actionFindings.push(fid)
    }
    const actionRef = ref('action', a.action_id, 'The action record.', a.event_id)
    const related = [a.event_id]
    const seen = [t]

    // ---- chain
    const breaks: ChainBreak[] = [...(analysis?.breaks ?? []), ...res.breaks]
    const misissued = res.breaks.some((b) => b.kind === 'delegatee_mismatch')
    let root: string | null = analysis ? analysis.root_principal_id : res.resolution === 'direct' ? a.actor_principal_id : null
    if (misissued) root = null
    if (a.root_principal_id && root && a.root_principal_id !== root) {
      breaks.push({ kind: 'root_mismatch', declared: a.root_principal_id, reconstructed: root, where: a.event_id })
    }
    if (a.parent_principal_id && analysis && analysis.delegation.delegator_principal_id !== a.parent_principal_id) {
      breaks.push({ kind: 'parent_mismatch', declared: a.parent_principal_id, reconstructed: analysis.delegation.delegator_principal_id })
    }
    const complete = breaks.length === 0 && root !== null

    const hops: ResolvedHop[] = (analysis?.path ?? []).map((d, i) => buildHop(d, i, analysis!.links[i] ?? 'explicit', analyzer.analyze(d), t))
    const chain: ReconstructedChain = {
      action_id: a.action_id,
      hops,
      root_principal_id: root,
      actor_principal_id: a.actor_principal_id,
      resolution: res.resolution,
      complete,
      breaks,
    }
    for (const d of analysis?.path ?? []) {
      for (const fid of delegationFindings.get(d.delegation_id) ?? []) {
        const f = findings.get(fid)
        if (f) {
          f.related_event_ids = canonical([...f.related_event_ids, a.event_id])
          if (t && (!f.last_seen || t > f.last_seen)) f.last_seen = t
        }
      }
    }

    // ---- attribution findings
    const lastHop = hops[hops.length - 1]
    const chainEvidence = refs(
      actionRef,
      ...(analysis?.path ?? []).map((d) => ref('delegation', d.delegation_id, `Hop ${analysis!.path.indexOf(d) + 1}.`, d.event_id)),
      ref('principal', a.actor_principal_id, 'Actor principal.'),
      ref('principal', root, 'Root principal.'),
    )
    if (actor === undefined && a.actor_principal_id) add(emitUnknown('principal', a.actor_principal_id, `actor of ${a.event_id}`, related, seen))
    for (const b of res.breaks) {
      if (b.kind === 'no_delegation' && b.principal_id && actor && !actor.root_eligible) {
        add(emit('ORPHANED_PRINCIPAL', `principal|${b.principal_id}`, actorType, {
          ...base(),
          action_id: a.action_id,
          broken_edge: { from: null, to: b.principal_id, hop_index: null, delegation_id: null },
          summary: `${name(b.principal_id)} acted without any recorded delegation.`,
          root_cause: `${describeBreak(b)} An agent cannot hold authority it was never given; with no delegation, there is nothing to verify its actions against.`,
          affected_principal_ids: [b.principal_id],
          evidence: chainEvidence,
          related_event_ids: related,
          seen,
        }))
      }
      if (b.kind === 'missing_delegation' || b.kind === 'delegatee_mismatch') {
        add(emit('BROKEN_DELEGATION_CHAIN', `action|${a.action_id}|${b.kind}`, actorType, {
          ...base(),
          action_id: a.action_id,
          delegation_id: b.kind === 'delegatee_mismatch' ? b.delegation_id : null,
          broken_edge: { from: null, to: a.actor_principal_id, hop_index: hops.length > 0 ? hops.length - 1 : null, delegation_id: b.delegation_id },
          summary: b.kind === 'missing_delegation'
            ? `${a.event_id} cites delegation ${b.delegation_id}, which does not exist.`
            : `${a.event_id} cites delegation ${b.delegation_id}, which was issued to ${name(b.recorded)}, not to ${name(b.expected)}.`,
          root_cause: `${describeBreak(b)} ${b.kind === 'delegatee_mismatch' ? 'Citing another principal\'s delegation is how a forged parent reference looks in the evidence: the actor gains no authority from it.' : 'The action\'s authority cannot be followed back to anyone.'}`,
          affected_principal_ids: [a.actor_principal_id].filter(isString),
          evidence: chainEvidence,
          related_event_ids: related,
          seen,
        }))
      }
    }
    for (const b of breaks) {
      if (b.kind === 'root_mismatch' && b.where === a.event_id) {
        add(emit('BROKEN_DELEGATION_CHAIN', `action|${a.action_id}|root_mismatch`, actorType, {
          ...base(),
          action_id: a.action_id,
          summary: `${a.event_id} claims ${name(b.declared)} as its root principal, but the delegation chain leads to ${name(b.reconstructed)}.`,
          root_cause: `${describeBreak(b)} The declared root is a claim made by the record; the reconstructed root is what the delegation records support. They disagree, so one of them is wrong.`,
          affected_principal_ids: [b.declared, b.reconstructed].filter(isString),
          evidence: chainEvidence,
          related_event_ids: related,
          seen,
        }))
      }
      if (b.kind === 'parent_mismatch') {
        add(emit('BROKEN_DELEGATION_CHAIN', `action|${a.action_id}|parent_mismatch`, actorType, {
          ...base(),
          action_id: a.action_id,
          summary: `${a.event_id} names ${name(b.declared)} as the delegator, but the delegation it relied on was issued by ${name(b.reconstructed)}.`,
          root_cause: describeBreak(b),
          affected_principal_ids: [b.declared, b.reconstructed].filter(isString),
          evidence: chainEvidence,
          related_event_ids: related,
          seen,
        }))
      }
    }
    if (root === null) {
      const missing = [a.root_principal_id ? null : 'root_principal_id', a.delegation_id ? null : 'delegation_id', a.actor_principal_id ? null : 'actor_principal_id'].filter(isString)
      add(emit('UNATTRIBUTABLE_ACTION', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        broken_edge: firstBrokenEdge(chain),
        summary: `${a.event_id} cannot be traced to a root principal.`,
        root_cause: `${breaks.map(describeBreak).join(' ') || 'No delegation chain could be reconstructed.'} Missing evidence is not the same as unauthorized behaviour: REGENT reports the action as unattributable and does not guess who authorized it.`,
        affected_principal_ids: [a.actor_principal_id].filter(isString),
        affected_resource_ids: [a.resource_id].filter(isString),
        missing_fields: missing,
        evidence: chainEvidence,
        related_event_ids: related,
        seen,
      }))
    }

    // ---- scope
    let effective: Scope | null = null
    let effectiveIsBound = true
    if (analysis && !misissued) {
      effective = analysis.effective
      effectiveIsBound = analysis.effective_is_bound || res.breaks.length > 0
    } else if (res.resolution === 'direct' && actor) {
      effective = actor.provisioned_scope
      effectiveIsBound = actor.provisioned_scope === null
    }
    const actionPolicy = a.policy_id ? (ix.policies.get(policyKey(a.policy_id, a.policy_version)) ?? null) : null
    let actionRestricted: Scope = []
    if (effective && actionPolicy?.scope_ceiling) {
      actionRestricted = excess(effective, actionPolicy.scope_ceiling)
      effective = intersect(effective, actionPolicy.scope_ceiling)
    }
    const exercised = a.exercised_scope
    const requested = a.requested_scope
    const rootAuthorityRecorded = analysis ? analysis.root_authority_recorded : actor?.provisioned_scope !== null

    const exec = a.execution_identity_id ? execIds.get(a.execution_identity_id) : undefined
    let ampFromHop = null as { hop: ResolvedHop; perms: string[] } | null
    const ampAtBoundary: string[] = []
    const stripped: string[] = []
    let exercisedExcess: string[] = []
    if (exercised && effective) {
      exercisedExcess = excess(exercised, effective)
      for (const p of exercisedExcess) {
        // The earliest hop that granted p without holding it is where the chain broke.
        const hop = hops.find((h) => isCovered(p, h.amplified))
        if (hop) {
          if (!ampFromHop || hop.hop_index < ampFromHop.hop.hop_index) ampFromHop = { hop, perms: [...(ampFromHop?.perms ?? [])] }
          ampFromHop.perms.push(p)
        } else if (lastHop && lastHop.granted_scope && !isCovered(p, lastHop.granted_scope)) {
          ampAtBoundary.push(p)
        } else if (!lastHop) {
          stripped.push(p) // a root principal acting directly beyond its own authority
        } else {
          stripped.push(p)
        }
      }
    }

    const toolId = a.tool_id
    const resourceIds = [a.resource_id].filter(isString)
    if (ampFromHop || ampAtBoundary.length > 0) {
      const allAmp = canonical([...(ampFromHop?.perms ?? []), ...ampAtBoundary])
      const confusedDeputy = exec?.provisioned_scope ? allAmp.filter((p) => isCovered(p, exec.provisioned_scope!)) : []
      const edge = ampFromHop
        ? { from: ampFromHop.hop.delegator_principal_id, to: ampFromHop.hop.delegatee_principal_id, hop_index: ampFromHop.hop.hop_index, delegation_id: ampFromHop.hop.delegation_id }
        : { from: a.actor_principal_id, to: toolId, hop_index: null, delegation_id: null }
      const where = ampFromHop
        ? `The authority entered the chain at hop ${ampFromHop.hop.hop_index + 1} (${name(ampFromHop.hop.delegator_principal_id)} → ${name(ampFromHop.hop.delegatee_principal_id)}), where delegation ${ampFromHop.hop.delegation_id} granted {${formatScope(ampFromHop.hop.amplified)}} that the delegator did not hold.`
        : `No delegation in the chain grants it: the last delegation to ${name(a.actor_principal_id)} granted {${formatScope(lastHop?.granted_scope ?? null)}}.`
      const deputy = confusedDeputy.length > 0
        ? ` The execution identity ${exec!.execution_identity_id} holds standing permission for {${formatScope(confusedDeputy)}}: the action used the workload's own authority instead of the authority delegated to the agent. That is a confused deputy spread across a chain, authorized by no single component.`
        : ''
      add(emit('AUTHORITY_AMPLIFICATION', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        delegation_id: ampFromHop?.hop.delegation_id ?? null,
        broken_edge: edge,
        summary: `${name(a.actor_principal_id)} exercised ${formatScope(allAmp)}, which no delegation in its chain legitimately conveyed.`,
        root_cause: `${name(root)}'s authority reached ${name(a.actor_principal_id)} as {${formatScope(effective)}}. The action exercised {${formatScope(exercised)}}. ${where}${deputy} Authority expanded across a delegation boundary, so the action is not contained in what was delegated.`,
        affected_principal_ids: [root, a.actor_principal_id, ...hops.map((h) => h.delegatee_principal_id)].filter(isString),
        affected_resource_ids: resourceIds,
        authority_delta: { available: lastHop?.available_scope ?? null, granted: lastHop?.granted_scope ?? null, requested, effective, exercised, excess: allAmp },
        evidence: refs(...chainEvidence, ref('execution_identity', a.execution_identity_id, 'Execution identity.'), ref('tool', toolId, 'Tool invoked.'), ref('resource', a.resource_id, 'Target resource.')),
        related_event_ids: related,
        seen,
      }))
    }
    if (stripped.length > 0) {
      const byPolicy = actionRestricted.length > 0 || hops.some((h) => h.policy_restricted.length > 0)
      add(emit('SCOPE_VIOLATION', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        broken_edge: { from: a.actor_principal_id, to: toolId, hop_index: null, delegation_id: null },
        summary: `${name(a.actor_principal_id)} exercised ${formatScope(stripped)}, outside its effective scope {${formatScope(effective)}}.`,
        root_cause: lastHop
          ? `The delegation chain conveyed {${formatScope(stripped)}}, but ${byPolicy ? `the governing policy ceiling removed it (${actionPolicy ? `${actionPolicy.policy_id} v${actionPolicy.policy_version}` : 'a hop policy'})` : 'a restriction removed it'}, so it was never part of the effective scope. The action exercised it anyway.`
          : `${name(a.actor_principal_id)} acted directly as a root principal. Its recorded authority is {${formatScope(effective)}}; the action exercised {${formatScope(exercised)}}.`,
        affected_principal_ids: [a.actor_principal_id].filter(isString),
        affected_resource_ids: resourceIds,
        authority_delta: { available: lastHop?.available_scope ?? null, granted: lastHop?.granted_scope ?? null, requested, effective, exercised, excess: canonical(stripped) },
        evidence: refs(...chainEvidence, actionPolicy ? ref('policy', policyKey(actionPolicy.policy_id, actionPolicy.policy_version), 'Policy whose ceiling applies.') : null),
        related_event_ids: related,
        seen,
      }))
    }
    if (requested === null) {
      add(emit('MISSING_REQUESTED_SCOPE', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        summary: `${a.event_id} does not record the scope it requested.`,
        root_cause: 'Requested scope is what the authorization decision was asked to approve. Without it, the recorded decision cannot be re-checked against the effective scope.',
        missing_fields: ['requested_scope'],
        evidence: refs(actionRef),
        related_event_ids: related,
        seen,
      }))
    }

    // ---- identity binding
    const idEdges: ExecutionEdge[] = []
    let identityResult: CheckResult = 'PASS'
    const identityNotes: string[] = []
    if (!a.execution_identity_id) {
      identityResult = 'UNKNOWN'
      identityNotes.push('No execution identity recorded.')
      idEdges.push({ kind: 'EXECUTES_AS', from: toolId, to: null, result: 'UNKNOWN', reason: 'No execution identity recorded.' })
    } else if (!exec) {
      identityResult = 'UNKNOWN'
      identityNotes.push(`Execution identity ${a.execution_identity_id} is not registered.`)
      add(emitUnknown('execution_identity', a.execution_identity_id, `execution identity of ${a.event_id}`, related, seen))
      idEdges.push({ kind: 'EXECUTES_AS', from: toolId, to: a.execution_identity_id, result: 'UNKNOWN', reason: 'Execution identity not registered.' })
    } else if (exec.bound_principal_id && exec.bound_principal_id !== a.actor_principal_id) {
      identityResult = 'FAIL'
      identityNotes.push(`${exec.execution_identity_id} is issued to ${name(exec.bound_principal_id)}, not to ${name(a.actor_principal_id)}.`)
      add(emit('EXECUTION_IDENTITY_MISMATCH', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        broken_edge: { from: toolId, to: exec.execution_identity_id, hop_index: null, delegation_id: null },
        summary: `${a.event_id} ran as ${exec.execution_identity_id}, which belongs to ${name(exec.bound_principal_id)}, not ${name(a.actor_principal_id)}.`,
        root_cause: `The action is recorded as performed by ${name(a.actor_principal_id)}, but it executed under an identity issued to ${name(exec.bound_principal_id)}. The target saw ${name(exec.bound_principal_id)}'s identity, so the delegation chain on record is not the authority that was actually used.`,
        affected_principal_ids: [a.actor_principal_id, exec.bound_principal_id].filter(isString),
        affected_resource_ids: resourceIds,
        evidence: refs(actionRef, ref('execution_identity', exec.execution_identity_id, 'Execution identity and its bound principal.'), ref('principal', a.actor_principal_id, 'Recorded actor.')),
        related_event_ids: related,
        seen,
      }))
      idEdges.push({ kind: 'EXECUTES_AS', from: toolId, to: exec.execution_identity_id, result: 'FAIL', reason: `Bound to ${name(exec.bound_principal_id)}, not the actor.` })
    } else if (!exec.bound_principal_id) {
      identityResult = 'WARN'
      identityNotes.push(`${exec.execution_identity_id} does not record which principal it is issued to.`)
      idEdges.push({ kind: 'EXECUTES_AS', from: toolId, to: exec.execution_identity_id, result: 'WARN', reason: 'Bound principal not recorded.' })
    } else {
      identityNotes.push(`${exec.execution_identity_id} is issued to ${name(a.actor_principal_id)}.`)
      idEdges.push({ kind: 'EXECUTES_AS', from: toolId, to: exec.execution_identity_id, result: 'PASS', reason: 'Issued to the acting principal.' })
    }

    let credentialResult: CheckResult = 'PASS'
    let credentialDetail: string
    const cred = a.credential_id ? credentials.get(a.credential_id) : undefined
    if (!a.credential_id) {
      credentialResult = 'UNKNOWN'
      credentialDetail = 'No credential recorded.'
    } else if (!cred) {
      credentialResult = 'UNKNOWN'
      credentialDetail = `Credential ${a.credential_id} is not registered.`
      add(emitUnknown('credential', a.credential_id, `credential of ${a.event_id}`, related, seen))
    } else if (cred.execution_identity_id !== a.execution_identity_id) {
      credentialResult = 'FAIL'
      credentialDetail = `${cred.credential_id} is bound to ${cred.execution_identity_id ?? 'no execution identity'}, but the action ran as ${a.execution_identity_id ?? 'an unrecorded identity'}.`
      add(emit('CREDENTIAL_BINDING_MISMATCH', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        broken_edge: { from: a.execution_identity_id, to: cred.credential_id, hop_index: null, delegation_id: null },
        summary: `${a.event_id} presented credential ${cred.credential_id}, which is bound to ${cred.execution_identity_id ?? 'no execution identity'}.`,
        root_cause: `${credentialDetail} A credential used outside its binding means the identity that authenticated is not the identity the action claims, so neither the execution identity nor the delegation chain describes who acted.`,
        affected_principal_ids: [a.actor_principal_id].filter(isString),
        affected_resource_ids: resourceIds,
        evidence: refs(actionRef, ref('credential', cred.credential_id, 'Credential and its binding.'), ref('execution_identity', a.execution_identity_id, 'Execution identity the action ran as.')),
        related_event_ids: related,
        seen,
      }))
    } else {
      credentialDetail = `${cred.credential_id} is bound to ${cred.execution_identity_id}.`
    }
    idEdges.push({ kind: 'AUTHENTICATES_WITH', from: a.execution_identity_id, to: a.credential_id, result: credentialResult, reason: credentialDetail })

    // ---- temporal validity
    const executed = a.downstream_result === 'success' || a.downstream_result === 'partial' || (a.downstream_result === null && a.recorded_decision !== 'DENY')
    const invalid: Invalidation[] = []
    if (t) {
      for (const h of hops) {
        if (h.temporal === 'EXPIRED') invalid.push({ kind: 'delegation', id: h.delegation_id, state: 'EXPIRED', at: h.expires_at })
        if (h.temporal === 'REVOKED') invalid.push({ kind: 'delegation', id: h.delegation_id, state: 'REVOKED', at: h.revoked_at })
        if (h.temporal === 'NOT_YET_VALID') invalid.push({ kind: 'delegation', id: h.delegation_id, state: 'NOT_YET_VALID', at: h.created_at })
      }
      const principalIds = canonical([root, ...hops.map((h) => h.delegator_principal_id), a.actor_principal_id].filter(isString))
      for (const pid of principalIds) {
        const p = ix.principals.get(pid)
        if (!p) continue
        const st = lifecycleAt(p.created_at, p.revoked_at, p.expires_at, p.suspended_at, t)
        if (st) invalid.push({ kind: 'principal', id: pid, state: st.state, at: st.at })
      }
      if (exec) {
        const st = lifecycleAt(exec.issued_at, exec.revoked_at, exec.expires_at, null, t)
        if (st) invalid.push({ kind: 'execution_identity', id: exec.execution_identity_id, state: st.state, at: st.at })
      }
      if (cred) {
        const st = lifecycleAt(cred.issued_at, cred.revoked_at, cred.expires_at, null, t)
        if (st) invalid.push({ kind: 'credential', id: cred.credential_id, state: st.state, at: st.at })
      }
    }
    let temporalResult: CheckResult = t ? 'PASS' : 'UNKNOWN'
    const temporalNotes: string[] = []
    if (!t) temporalNotes.push('The action has no timestamp, so validity at action time cannot be checked.')
    const evaluatedAt = a.authorization_evaluated_at
    if (t && invalid.length > 0) {
      const describe = (x: Invalidation) => `${x.kind.replace('_', ' ')} ${x.kind === 'principal' ? name(x.id) : x.id} was ${x.state === 'NOT_YET_VALID' ? 'not yet valid' : x.state.toLowerCase()}${x.at ? ` (${x.state === 'NOT_YET_VALID' ? 'from' : 'at'} ${x.at})` : ''}`
      if (!executed) {
        temporalNotes.push(`${invalid.map(describe).join('; ')}. The system refused the action, which is the correct outcome.`)
      } else {
        temporalResult = 'FAIL'
        temporalNotes.push(`${invalid.map(describe).join('; ')}, yet the action ran.`)
        const staleDecision = evaluatedAt !== null && evaluatedAt < t && invalid.some((x) => x.at !== null && evaluatedAt < x.at && x.at <= t && x.state !== 'NOT_YET_VALID')
        if (staleDecision) {
          const changes = invalid.filter((x) => x.at !== null && evaluatedAt! < x.at && x.at <= t)
          add(emit('ACTION_TIME_AUTHORIZATION_FAILURE', `action|${a.action_id}`, actorType, {
            ...base(),
            action_id: a.action_id,
            broken_edge: brokenEdgeForInvalidation(changes[0]!, chain, a),
            summary: `${a.event_id} was allowed on a decision made at ${evaluatedAt}, before ${changes.map(describe).join('; ')}.`,
            root_cause: `Provision-time: the decision evaluated at ${evaluatedAt} returned ${a.recorded_decision ?? 'an allow'}. Action-time: at ${t} the authority it relied on had ended (${changes.map(describe).join('; ')}). The decision was not re-evaluated when the action executed, so a revocation that should have stopped it did not.`,
            affected_principal_ids: [a.actor_principal_id, root].filter(isString),
            affected_resource_ids: resourceIds,
            evidence: refs(actionRef, ...changes.map((x) => ref(x.kind, x.id, `${x.state} at ${x.at ?? 'unknown time'}.`))),
            related_event_ids: related,
            seen,
          }))
        } else {
          for (const x of invalid) {
            if (x.kind === 'delegation') {
              const type: FindingType = x.state === 'NOT_YET_VALID' ? 'BROKEN_DELEGATION_CHAIN' : 'STALE_DELEGATION'
              const hop = hops.find((h) => h.delegation_id === x.id)
              add(emit(type, `action|${a.action_id}|${x.id}|temporal`, actorType, {
                ...base(),
                action_id: a.action_id,
                delegation_id: x.id,
                broken_edge: hop ? { from: hop.delegator_principal_id, to: hop.delegatee_principal_id, hop_index: hop.hop_index, delegation_id: hop.delegation_id } : null,
                summary: x.state === 'NOT_YET_VALID'
                  ? `${a.event_id} relies on delegation ${x.id}, which was created after the action ran.`
                  : `${a.event_id} relied on delegation ${x.id}, which had ${x.state === 'EXPIRED' ? 'expired' : 'been revoked'} at ${x.at}.`,
                root_cause: x.state === 'NOT_YET_VALID'
                  ? `The action timestamp ${t} predates the delegation's creation (${x.at}). Timestamps that run backwards are either a clock problem or a backdated record; either way the chain cannot be trusted as recorded.`
                  : `At ${t} the delegation was no longer in force, so the authority it conveyed had ended. ${evaluatedAt ? `The decision was evaluated at ${evaluatedAt}, after the delegation ended, and allowed the action anyway.` : 'No evaluation timestamp is recorded, so REGENT cannot tell whether the decision was made at action time.'}`,
                affected_principal_ids: [hop?.delegator_principal_id, hop?.delegatee_principal_id].filter(isString),
                affected_resource_ids: resourceIds,
                evidence: refs(actionRef, ref('delegation', x.id, `${x.state} at ${x.at ?? 'unknown time'}.`)),
                related_event_ids: related,
                seen,
              }))
            } else {
              const type: FindingType = x.kind === 'credential' ? 'REVOKED_CREDENTIAL' : 'REVOKED_IDENTITY'
              add(emit(type, `action|${a.action_id}|${x.kind}|${x.id}`, actorType, {
                ...base(),
                action_id: a.action_id,
                broken_edge: x.kind === 'credential'
                  ? { from: a.execution_identity_id, to: x.id, hop_index: null, delegation_id: null }
                  : x.kind === 'execution_identity' ? { from: toolId, to: x.id, hop_index: null, delegation_id: null } : null,
                summary: `${a.event_id} ran while ${describe(x)}.`,
                root_cause: `At ${t}, ${describe(x)}. Authority that depends on an identity or credential ends when it ends. ${evaluatedAt ? `The decision was evaluated at ${evaluatedAt} and allowed the action regardless.` : 'No evaluation timestamp is recorded, so REGENT cannot tell whether the decision was made at action time.'}`,
                affected_principal_ids: x.kind === 'principal' ? [x.id] : [a.actor_principal_id].filter(isString),
                affected_resource_ids: resourceIds,
                evidence: refs(actionRef, ref(x.kind, x.id, `${x.state} at ${x.at ?? 'unknown time'}.`)),
                related_event_ids: related,
                seen,
              }))
            }
          }
        }
      }
    }
    if (t && executed && evaluatedAt === null && temporalResult === 'PASS') {
      temporalResult = 'WARN'
      temporalNotes.push('No authorization_evaluated_at is recorded, so REGENT cannot confirm the decision was made at action time.')
    }
    if (t && evaluatedAt !== null && evaluatedAt > t) {
      if (temporalResult === 'PASS') temporalResult = 'WARN'
      temporalNotes.push(`The decision is timestamped ${evaluatedAt}, after the action ran at ${t}.`)
    }
    if (t && temporalResult === 'PASS') {
      temporalNotes.push(evaluatedAt && evaluatedAt < t ? `Every delegation, identity and credential was valid at ${t}. The decision was evaluated at ${evaluatedAt} and nothing changed in between.` : `Every delegation, identity and credential was valid at ${t}, and the decision was evaluated at action time.`)
    }

    // ---- approval
    let approvalResult: CheckResult = 'PASS'
    let approvalDetail: string
    let conditional = false
    const used = union(exercised ?? [], requested ?? [])
    if (actionPolicy) {
      const needs = used.filter((p) => actionPolicy.approval_required_for.some((q) => covers(q, p) || covers(p, q)))
      if (needs.length === 0) {
        approvalDetail = `Policy ${actionPolicy.policy_id} v${actionPolicy.policy_version} requires no approval for {${formatScope(used)}}.`
      } else if (a.approval_state === 'APPROVED') {
        approvalDetail = `{${formatScope(needs)}} requires approval; approval is recorded as APPROVED.`
      } else if (executed) {
        approvalResult = 'FAIL'
        approvalDetail = `{${formatScope(needs)}} requires approval under ${actionPolicy.policy_id} v${actionPolicy.policy_version}; approval state was ${a.approval_state}, yet the action ran.`
        add(emit('MISSING_APPROVAL', `action|${a.action_id}`, actorType, {
          ...base(),
          action_id: a.action_id,
          summary: `${name(a.actor_principal_id)} exercised ${formatScope(needs)} without a recorded approval.`,
          root_cause: `Policy ${actionPolicy.policy_id} v${actionPolicy.policy_version} marks {${formatScope(actionPolicy.approval_required_for)}} as privileged. The action's approval_state is ${a.approval_state}. Authorization and approval are separate: the action may have been in scope, but the approval the policy requires is not in the evidence.`,
          affected_principal_ids: [a.actor_principal_id].filter(isString),
          affected_resource_ids: resourceIds,
          missing_fields: a.approval_state === 'UNKNOWN' ? ['approval_state'] : [],
          evidence: refs(actionRef, ref('policy', policyKey(actionPolicy.policy_id, actionPolicy.policy_version), 'Policy marking the permission as privileged.')),
          related_event_ids: related,
          seen,
        }))
      } else {
        approvalResult = 'WARN'
        conditional = true
        approvalDetail = `{${formatScope(needs)}} requires approval; state is ${a.approval_state} and the action did not run.`
      }
    } else {
      approvalResult = a.approval_state === 'APPROVED' || a.approval_state === 'NOT_REQUIRED' ? 'PASS' : 'UNKNOWN'
      approvalDetail = a.policy_id
        ? `Policy ${a.policy_id}${a.policy_version ? ` v${a.policy_version}` : ''} is not in the evidence, so its approval requirements are unknown. Recorded approval: ${a.approval_state}.`
        : `No policy is recorded, so approval requirements are unknown. Recorded approval: ${a.approval_state}.`
    }
    for (const h of hops) {
      if ((h.approval_state === 'PENDING' || h.approval_state === 'REJECTED' || h.approval_state === 'EXPIRED') && executed) {
        approvalResult = 'FAIL'
        approvalDetail += ` Delegation ${h.delegation_id} is ${h.approval_state.toLowerCase()} and was not in force.`
        add(emit('MISSING_APPROVAL', `action|${a.action_id}|${h.delegation_id}`, actorType, {
          ...base(),
          action_id: a.action_id,
          delegation_id: h.delegation_id,
          broken_edge: { from: h.delegator_principal_id, to: h.delegatee_principal_id, hop_index: h.hop_index, delegation_id: h.delegation_id },
          summary: `${a.event_id} relied on delegation ${h.delegation_id}, whose approval is ${h.approval_state}.`,
          root_cause: `A delegation whose approval is ${h.approval_state} has not been put in force. The action used authority that was never approved.`,
          affected_principal_ids: [h.delegator_principal_id, h.delegatee_principal_id].filter(isString),
          affected_resource_ids: resourceIds,
          evidence: refs(actionRef, ref('delegation', h.delegation_id, `Approval ${h.approval_state}.`)),
          related_event_ids: related,
          seen,
        }))
      }
    }

    // ---- policy traceability
    let policyResult: CheckResult = 'PASS'
    let policyDetail: string
    if (!a.policy_version) {
      policyResult = 'FAIL'
      policyDetail = a.policy_id ? `Policy ${a.policy_id} is named but its version is not.` : 'No policy or policy version is recorded for the decision.'
      add(emit('MISSING_POLICY_VERSION', `action|${a.action_id}`, actorType, {
        ...base(),
        action_id: a.action_id,
        summary: `${a.event_id} does not record which policy version made its decision.`,
        root_cause: `${policyDetail} A decision that cannot be tied to an exact policy revision cannot be reconstructed later, and a policy change cannot be told apart from a policy bypass.`,
        missing_fields: a.policy_id ? ['policy_version'] : ['policy_id', 'policy_version'],
        evidence: refs(actionRef),
        related_event_ids: related,
        seen,
      }))
    } else if (!actionPolicy) {
      policyResult = 'WARN'
      policyDetail = `Decision references ${a.policy_id ?? 'a policy'} v${a.policy_version}, but that policy record is not in the evidence; its ceiling and approval requirements were not applied.`
    } else {
      policyDetail = `Decision made under ${actionPolicy.display_name} (${actionPolicy.policy_id} v${actionPolicy.policy_version}).`
    }

    // ---- references to tool/resource
    if (a.tool_id && !tools.has(a.tool_id)) add(emitUnknown('tool', a.tool_id, `tool of ${a.event_id}`, related, seen))
    if (a.resource_id && !resources.has(a.resource_id)) add(emitUnknown('resource', a.resource_id, `resource of ${a.event_id}`, related, seen))

    // ---- derived decision
    const deny: string[] = []
    const unknown: string[] = []
    const requestedExcess = requested && effective ? excess(requested, effective) : []
    if (exercisedExcess.length > 0) deny.push(`Exercised {${formatScope(exercisedExcess)}} is outside the effective scope {${formatScope(effective)}}.`)
    if (requestedExcess.length > 0 && !(exercisedExcess.length > 0 && requestedExcess.every((p) => exercisedExcess.includes(p)))) {
      deny.push(`Requested {${formatScope(requestedExcess)}} is outside the effective scope {${formatScope(effective)}}.`)
    }
    if (t) for (const x of invalid) deny.push(`At ${t} the ${x.kind.replace('_', ' ')} ${x.id} was ${x.state === 'NOT_YET_VALID' ? 'not yet valid' : x.state.toLowerCase()}.`)
    if (identityResult === 'FAIL') deny.push('The execution identity is not bound to the acting principal.')
    if (credentialResult === 'FAIL') deny.push('The credential is not bound to the execution identity.')
    if (misissued) deny.push('The cited delegation was issued to a different principal.')
    if (hops.some((h) => h.approval_state === 'REJECTED' || h.approval_state === 'EXPIRED')) deny.push('A delegation in the chain was not approved.')
    if (root === null) unknown.push('The action cannot be attributed to a root principal.')
    else if (breaks.length > 0) unknown.push('The delegation chain contains conflicting or missing links.')
    if (effective === null) unknown.push('The effective scope cannot be established from the evidence.')
    if (exercised === null && requested === null) unknown.push('Neither requested nor exercised scope is recorded.')
    if (!t) unknown.push('The action has no timestamp.')
    if (approvalResult === 'FAIL' || (actionPolicy && approvalResult === 'WARN')) conditional = true
    const derived: AuthorizationDecision = deny.length > 0 ? 'DENY' : unknown.length > 0 ? 'UNKNOWN' : conditional ? 'CONDITIONAL' : 'ALLOW'
    const reasons = deny.length > 0 ? deny : unknown.length > 0 ? unknown : conditional ? [approvalDetail.trim()] : [`Every permission used is within the effective scope {${formatScope(effective)}} and all authority was valid at ${t}.`]
    const agreement = a.recorded_decision === null || derived === 'UNKNOWN' || a.recorded_decision === 'UNKNOWN'
      ? 'UNVERIFIABLE'
      : a.recorded_decision === derived ? 'AGREE' : 'DISAGREE'

    // ---- dimension checks
    const lookupLinks = res.resolution === 'lookup' || hops.some((h) => h.link === 'lookup')
    const anyAmplifiedHop = hops.some((h) => h.amplified.length > 0)
    const checks: DimensionCheck[] = [
      check('attribution', 'Attribution', ['AUTH-003'],
        root === null ? 'FAIL' : breaks.length > 0 ? 'FAIL' : 'PASS',
        root === null ? 'No root principal can be established.' : breaks.length > 0 ? `Root ${name(root)} reconstructed, but the evidence conflicts: ${breaks.map(describeBreak).join(' ')}` : `Traced to ${name(root)} through ${hops.length} delegation hop${hops.length === 1 ? '' : 's'}.`),
      check('chain_completeness', 'Chain completeness', ['AUTH-002', 'AUTH-004'],
        breaks.length > 0 ? 'FAIL' : root === null ? 'FAIL' : lookupLinks ? 'WARN' : 'PASS',
        breaks.length > 0 ? breaks.map(describeBreak).join(' ') : lookupLinks ? 'Every hop is present, but at least one link was found by registry lookup because the record did not cite its parent delegation.' : res.resolution === 'direct' ? 'The root principal acted directly; there are no delegation hops.' : 'Every hop cites its parent delegation.'),
      check('authority', 'Authority integrity', ['AUTH-010', 'AUTH-001'],
        anyAmplifiedHop || ampAtBoundary.length > 0 || ampFromHop ? 'FAIL' : hops.some((h) => h.available_scope === null && h.hop_index > 0) || (effective === null) ? 'UNKNOWN' : !rootAuthorityRecorded && hops.length > 0 ? 'WARN' : 'PASS',
        anyAmplifiedHop ? `Authority expands at ${hops.filter((h) => h.amplified.length > 0).map((h) => `hop ${h.hop_index + 1} (+${formatScope(h.amplified)})`).join(', ')}.` : ampAtBoundary.length > 0 ? `${name(a.actor_principal_id)} exercised {${formatScope(ampAtBoundary)}} beyond its grant.` : !rootAuthorityRecorded && hops.length > 0 ? `Every hop narrows or preserves authority. ${name(root)}'s own authority is not recorded, so the first grant is unverified.` : 'Authority narrows or is preserved at every hop.'),
      check('scope', 'Scope containment', ['AUTH-001'],
        exercisedExcess.length > 0 ? 'FAIL' : exercised === null || effective === null ? 'UNKNOWN' : effectiveIsBound && breaks.length > 0 ? 'UNKNOWN' : requestedExcess.length > 0 || effectiveIsBound ? 'WARN' : 'PASS',
        exercisedExcess.length > 0 ? `Exercised {${formatScope(exercised)}} ⊄ effective {${formatScope(effective)}}; outside: {${formatScope(exercisedExcess)}}.`
          : exercised === null ? 'Exercised scope not recorded.'
          : effective === null ? 'Effective scope cannot be established.'
          : `Exercised {${formatScope(exercised)}} ⊆ effective {${formatScope(effective)}}.${requestedExcess.length > 0 ? ` Requested {${formatScope(requestedExcess)}} exceeded the effective scope but was not exercised.` : ''}${effectiveIsBound ? ' The effective scope is an upper bound because upstream authority is not fully recorded.' : ''}`),
      check('identity', 'Identity binding', ['AUTH-006', 'AUTH-009'], identityResult, identityNotes.join(' ')),
      check('credential_binding', 'Credential binding', ['AUTH-006'], credentialResult, credentialDetail),
      check('temporal', 'Action-time validity', ['AUTH-005'], temporalResult, temporalNotes.join(' ')),
      check('policy', 'Policy traceability', ['AUTH-007'], policyResult, policyDetail),
      check('approval', 'Approval', ['AUTH-008'], approvalResult, approvalDetail.trim()),
    ]
    const completeness = recordCompleteness(a, schema)
    checks.push(check('evidence', 'Record completeness', ['AUTH-007', 'AUTH-003'],
      completeness.critical_missing.length > 0 ? 'FAIL' : completeness.missing.length > 0 ? 'WARN' : 'PASS',
      `${completeness.percent}% (${completeness.present.length} of ${completeness.required_count} fields).${completeness.missing.length ? ` Missing: ${completeness.missing.join(', ')}.` : ''}`))

    const edges: ExecutionEdge[] = [
      {
        kind: 'INVOKES',
        from: a.actor_principal_id,
        to: toolId,
        result: checks.find((c) => c.dimension === 'scope')!.result === 'SKIPPED' ? 'UNKNOWN' : checks.find((c) => c.dimension === 'scope')!.result,
        reason: checks.find((c) => c.dimension === 'scope')!.detail,
      },
      ...idEdges,
      { kind: 'TARGETS', from: a.execution_identity_id ?? toolId, to: a.resource_id, result: a.resource_id ? (resources.has(a.resource_id) ? 'PASS' : 'UNKNOWN') : 'UNKNOWN', reason: a.resource_id ? (resources.has(a.resource_id) ? `${a.operation ?? 'operation'} on ${resources.get(a.resource_id)!.display_name}.` : 'Resource not registered.') : 'No resource recorded.' },
      { kind: 'GOVERNED_BY', from: a.action_id, to: a.policy_id ? policyKey(a.policy_id, a.policy_version) : null, result: policyResult, reason: policyDetail },
    ]

    verifications.push({
      action_id: a.action_id,
      event_id: a.event_id,
      timestamp: t,
      chain,
      effective_scope: effective,
      exercised_scope: exercised,
      requested_scope: requested,
      derived_decision: derived,
      derived_decision_reasons: reasons,
      recorded_decision: a.recorded_decision,
      decision_agreement: agreement,
      executed,
      execution_edges: edges,
      checks,
      finding_ids: [...actionFindings, ...hops.flatMap((h) => delegationFindings.get(h.delegation_id) ?? [])].filter((v, i, arr) => arr.indexOf(v) === i).sort(compareStrings),
      record_completeness: completeness,
      overall: overallOf(checks),
    })
  }

  function check(dimension: VerificationDimension, label: string, ruleIds: RuleId[], result: CheckResult, detail: string): DimensionCheck {
    const anyEnabled = ruleIds.some((r) => rules.get(r)?.enabled)
    return { dimension, label, result: anyEnabled ? result : 'SKIPPED', detail: anyEnabled ? detail : `Skipped: ${ruleIds.join(', ')} disabled in rule set ${ruleset.version}.`, rule_ids: ruleIds }
  }

  function buildHop(d: Delegation, i: number, link: 'explicit' | 'lookup', da: DelegationAnalysis, t: string | null): ResolvedHop {
    const temporal = temporalOf(d, t)
    const reasons: string[] = []
    let result: CheckResult = 'PASS'
    const worse = (r: CheckResult) => {
      if (rank(r) > rank(result)) result = r
    }
    const own = analyzer.ownBreaks(d)
    if (own.length > 0) {
      worse('FAIL')
      reasons.push(...own.map(describeBreak))
    }
    if (da.amplified.length > 0) {
      worse('FAIL')
      reasons.push(`Grants {${formatScope(da.amplified)}} that ${name(d.delegator_principal_id)} did not hold.`)
    }
    if (d.granted_scope === null) {
      worse('UNKNOWN')
      reasons.push('No granted scope recorded.')
    }
    const carried = d.granted_scope ? d.granted_scope.filter((p) => isCovered(p, da.inherited_amplified)) : []
    if (carried.length > 0) {
      worse('WARN')
      reasons.push(`Passes on {${formatScope(carried)}}, which was amplified at an earlier hop.`)
    }
    if (temporal === 'EXPIRED' || temporal === 'REVOKED' || temporal === 'NOT_YET_VALID') {
      worse('FAIL')
      reasons.push(temporal === 'NOT_YET_VALID' ? 'Created after the action.' : `${temporal === 'EXPIRED' ? 'Expired' : 'Revoked'} before the action.`)
    } else if (temporal === 'UNKNOWN') {
      worse('WARN')
      reasons.push('Validity at action time cannot be established (missing timestamps).')
    }
    if (d.approval_state === 'REJECTED' || d.approval_state === 'EXPIRED' || d.approval_state === 'PENDING') {
      worse('FAIL')
      reasons.push(`Approval ${d.approval_state.toLowerCase()}.`)
    }
    if (da.available === null && d.granted_scope !== null) {
      if (i === 0) {
        worse('WARN')
        reasons.push(`${name(d.delegator_principal_id)}'s own authority is not recorded; the grant cannot be checked against it.`)
      } else {
        worse('UNKNOWN')
        reasons.push("The delegator's effective scope cannot be established.")
      }
    }
    if (link === 'lookup') {
      worse('WARN')
      reasons.push('Linked to its parent by registry lookup; the record does not cite the parent delegation.')
    }
    if (da.policy_restricted.length > 0) reasons.push(`Policy ceiling removed {${formatScope(da.policy_restricted)}}.`)
    if (d.policy_version === null) {
      worse('WARN')
      reasons.push('Policy version not recorded.')
    }
    if (reasons.length === 0) reasons.push('Grant is within the delegator\'s authority and in force at action time.')
    return {
      hop_index: i,
      delegation_id: d.delegation_id,
      link,
      delegator_principal_id: d.delegator_principal_id,
      delegatee_principal_id: d.delegatee_principal_id,
      granted_scope: d.granted_scope,
      available_scope: da.available,
      effective_scope: da.effective,
      amplified: da.amplified,
      inherited_amplified: da.inherited_amplified,
      policy_restricted: da.policy_restricted,
      policy_id: d.policy_id,
      policy_version: d.policy_version,
      approval_state: d.approval_state,
      created_at: d.created_at,
      expires_at: d.expires_at,
      revoked_at: d.revoked_at,
      temporal,
      result,
      reasons,
    }
  }

  // Prose only: storage keeps fixed-width ISO strings so they sort lexically.
  for (const f of findings.values()) {
    f.summary = humanizeTimes(f.summary)
    f.root_cause = humanizeTimes(f.root_cause)
  }
  for (const v of verifications) {
    for (const c of v.checks) c.detail = humanizeTimes(c.detail)
    for (const h of v.chain.hops) h.reasons = h.reasons.map(humanizeTimes)
    v.derived_decision_reasons = v.derived_decision_reasons.map(humanizeTimes)
    for (const e of v.execution_edges) e.reason = humanizeTimes(e.reason)
  }

  const findingList = [...findings.values()].sort(
    (x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || compareStrings(x.type, y.type) || compareStrings(x.finding_id, y.finding_id),
  )
  for (const f of findingList) f.evidence.sort((x, y) => compareStrings(`${x.kind}:${x.id}`, `${y.kind}:${y.id}`))

  const inputDigest = `sha256:${sha256(canonicalJson({ bundle, ruleset, schema, engine: ENGINE_VERSION }))}`
  return {
    input_digest: inputDigest,
    ruleset_version: ruleset.version,
    engine_version: ENGINE_VERSION,
    actions: verifications,
    findings: findingList,
    summary: summarize(verifications, findingList),
  }
}

// ---------------------------------------------------------------- helpers

/** 2026-10-03T13:30:00.000Z -> 2026-10-03 13:30 UTC (seconds kept when non-zero). */
export function humanizeTimes(text: string): string {
  return text.replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})\.\d{3}Z/g, (_m, d: string, hm: string, ss: string) => `${d} ${hm}${ss === '00' ? '' : `:${ss}`} UTC`)
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

const RANK: Record<CheckResult, number> = { SKIPPED: 0, PASS: 1, WARN: 2, UNKNOWN: 3, FAIL: 4 }
function rank(r: CheckResult): number {
  return RANK[r]
}

function overallOf(checks: DimensionCheck[]): CheckResult {
  let worst: CheckResult = 'PASS'
  for (const c of checks) if (rank(c.result) > rank(worst)) worst = c.result
  return worst
}

export function temporalOf(d: Delegation, t: string | null): ResolvedHop['temporal'] {
  if (!t) return 'UNKNOWN'
  if (d.created_at && d.created_at > t) return 'NOT_YET_VALID'
  if (d.revoked_at && d.revoked_at <= t) return 'REVOKED'
  if (d.expires_at && d.expires_at <= t) return 'EXPIRED'
  if (!d.created_at) return 'UNKNOWN'
  return 'VALID'
}

function lifecycleAt(created: string | null, revoked: string | null, expires: string | null, suspended: string | null, t: string): { state: Invalidation['state']; at: string | null } | null {
  if (created && created > t) return { state: 'NOT_YET_VALID', at: created }
  if (revoked && revoked <= t) return { state: 'REVOKED', at: revoked }
  if (suspended && suspended <= t) return { state: 'SUSPENDED', at: suspended }
  if (expires && expires <= t) return { state: 'EXPIRED', at: expires }
  return null
}

function firstBrokenEdge(chain: ReconstructedChain): Finding['broken_edge'] {
  const bad = chain.hops.find((h) => h.result === 'FAIL' || h.result === 'UNKNOWN')
  if (bad) return { from: bad.delegator_principal_id, to: bad.delegatee_principal_id, hop_index: bad.hop_index, delegation_id: bad.delegation_id }
  const first = chain.hops[0]
  if (first) return { from: null, to: first.delegator_principal_id, hop_index: null, delegation_id: null }
  return { from: null, to: chain.actor_principal_id, hop_index: null, delegation_id: null }
}

function brokenEdgeForInvalidation(x: Invalidation, chain: ReconstructedChain, a: Action): Finding['broken_edge'] {
  if (x.kind === 'delegation') {
    const h = chain.hops.find((hop) => hop.delegation_id === x.id)
    if (h) return { from: h.delegator_principal_id, to: h.delegatee_principal_id, hop_index: h.hop_index, delegation_id: h.delegation_id }
  }
  if (x.kind === 'credential') return { from: a.execution_identity_id, to: x.id, hop_index: null, delegation_id: null }
  if (x.kind === 'execution_identity') return { from: a.tool_id, to: x.id, hop_index: null, delegation_id: null }
  return { from: null, to: x.id, hop_index: null, delegation_id: null }
}

export function recordCompleteness(a: Action, schema: CompletenessSchema): RecordCompleteness {
  const present: string[] = []
  const missing: string[] = []
  const critical: string[] = []
  for (const f of schema.fields) {
    const v = a[f.name]
    const has = v !== null && v !== undefined && v !== '' && !(f.name === 'approval_state' && v === 'UNKNOWN')
    if (has) present.push(f.name)
    else {
      missing.push(f.name)
      if (f.critical) critical.push(f.name)
    }
  }
  const required = schema.fields.length
  return {
    schema_id: schema.schema_id,
    present,
    missing,
    critical_missing: critical,
    required_count: required,
    percent: required === 0 ? 100 : Math.round((present.length / required) * 100),
  }
}

function summarize(actions: ActionVerification[], findings: Finding[]): RunSummary {
  const sev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  const byType: Partial<Record<FindingType, number>> = {}
  for (const f of findings) {
    sev[f.severity]++
    byType[f.type] = (byType[f.type] ?? 0) + 1
  }
  const decisions: Record<AuthorizationDecision, number> = { ALLOW: 0, DENY: 0, CONDITIONAL: 0, UNKNOWN: 0 }
  const health = { verified: 0, incomplete: 0, violated: 0, unknown: 0 }
  let attributable = 0
  let unattributable = 0
  let unknownAttr = 0
  let violations = 0
  let amplification = 0
  let broken = 0
  let missingFields = 0
  let passing = 0
  let evaluated = 0
  let authUnknown = 0
  for (const a of actions) {
    decisions[a.derived_decision]++
    health[chainHealth(a)]++
    const attr = a.checks.find((c) => c.dimension === 'attribution')!.result
    if (a.chain.root_principal_id && attr === 'PASS') attributable++
    else if (a.chain.root_principal_id === null) unattributable++
    else unknownAttr++
    const scope = a.checks.find((c) => c.dimension === 'scope')!.result
    const auth = a.checks.find((c) => c.dimension === 'authority')!.result
    if (scope === 'FAIL' || auth === 'FAIL') violations++
    if (auth === 'FAIL') amplification++
    if (a.chain.breaks.length > 0 || a.chain.root_principal_id === null) broken++
    if (a.record_completeness.missing.length > 0) missingFields++
    if (scope === 'UNKNOWN' || auth === 'UNKNOWN' || scope === 'SKIPPED' || auth === 'SKIPPED') authUnknown++
    else {
      evaluated++
      if (scope !== 'FAIL' && auth !== 'FAIL') passing++
    }
  }
  return {
    total_actions: actions.length,
    attributable_actions: attributable,
    unattributable_actions: unattributable,
    unknown_attribution_actions: unknownAttr,
    authority_violations: violations,
    amplification_events: amplification,
    broken_chains: broken,
    missing_field_records: missingFields,
    authority_integrity: { passing, evaluated, unknown: authUnknown },
    findings_by_severity: sev,
    findings_by_type: byType,
    decisions,
    chain_health: health,
  }
}

/** Colour class for the chain health map. Missing evidence is "incomplete", never "violated". */
export function chainHealth(a: ActionVerification): 'verified' | 'incomplete' | 'violated' | 'unknown' {
  const r = (d: VerificationDimension) => a.checks.find((c) => c.dimension === d)?.result ?? 'UNKNOWN'
  const violationDims: VerificationDimension[] = ['authority', 'scope', 'identity', 'credential_binding', 'temporal', 'approval']
  if (violationDims.some((d) => r(d) === 'FAIL')) return 'violated'
  if (r('attribution') === 'FAIL' || r('chain_completeness') === 'FAIL') return 'incomplete'
  if (['authority', 'scope', 'identity'].some((d) => r(d as VerificationDimension) === 'UNKNOWN')) return 'unknown'
  if (a.checks.some((c) => c.result === 'WARN' || c.result === 'FAIL' || c.result === 'UNKNOWN')) return 'incomplete'
  return 'verified'
}
