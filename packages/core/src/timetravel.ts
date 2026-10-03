import { buildIndex, ChainAnalyzer } from './chain.ts'
import { canonical, compareStrings } from './scope.ts'
import { temporalOf } from './verify.ts'
import type { EvidenceBundle, ResolvedHop, Scope } from './types.ts'

/**
 * Time travel: the authority that existed at an instant. Effective scope is
 * time-independent (it depends on grants, not clocks), so only validity is
 * recomputed for the chosen instant.
 */

export interface AuthorityAtTime {
  at: string
  delegations: {
    delegation_id: string
    delegator_principal_id: string | null
    delegatee_principal_id: string | null
    state: ResolvedHop['temporal']
    effective_scope: Scope | null
  }[]
  /** For each principal holding at least one in-force delegation: what it could exercise at that instant. */
  holders: { principal_id: string; scope: Scope; via: string[]; unverified: boolean }[]
  principals: { principal_id: string; state: 'VALID' | 'REVOKED' | 'SUSPENDED' | 'EXPIRED' | 'NOT_YET_VALID' }[]
  credentials: { credential_id: string; state: 'VALID' | 'REVOKED' | 'EXPIRED' | 'NOT_YET_VALID' }[]
  actions_so_far: string[]
}

export function authorityAt(bundle: EvidenceBundle, at: string): AuthorityAtTime {
  const ix = buildIndex(bundle)
  const analyzer = new ChainAnalyzer(ix)
  const delegations = bundle.delegations.map((d) => {
    const a = analyzer.analyze(d)
    const pathValid = a.path.every((p) => temporalOf(p, at) === 'VALID')
    return {
      delegation_id: d.delegation_id,
      delegator_principal_id: d.delegator_principal_id,
      delegatee_principal_id: d.delegatee_principal_id,
      state: temporalOf(d, at),
      effective_scope: a.effective,
      pathValid,
      unverified: a.effective_is_bound,
    }
  })
  const holders = new Map<string, { scope: string[]; via: string[]; unverified: boolean }>()
  for (const d of delegations) {
    if (d.state !== 'VALID' || !d.pathValid || !d.delegatee_principal_id || !d.effective_scope) continue
    const h = holders.get(d.delegatee_principal_id) ?? { scope: [], via: [], unverified: false }
    h.scope.push(...d.effective_scope)
    h.via.push(d.delegation_id)
    h.unverified ||= d.unverified
    holders.set(d.delegatee_principal_id, h)
  }
  const state = (created: string | null, revoked: string | null, expires: string | null, suspended: string | null) => {
    if (created && created > at) return 'NOT_YET_VALID' as const
    if (revoked && revoked <= at) return 'REVOKED' as const
    if (suspended && suspended <= at) return 'SUSPENDED' as const
    if (expires && expires <= at) return 'EXPIRED' as const
    return 'VALID' as const
  }
  return {
    at,
    delegations: delegations.map(({ pathValid: _p, unverified: _u, ...rest }) => rest),
    holders: [...holders.entries()]
      .map(([principal_id, h]) => ({ principal_id, scope: canonical(h.scope), via: canonical(h.via), unverified: h.unverified }))
      .sort((x, y) => compareStrings(x.principal_id, y.principal_id)),
    principals: bundle.principals.map((p) => ({ principal_id: p.principal_id, state: state(p.created_at, p.revoked_at, p.expires_at, p.suspended_at) })),
    credentials: bundle.credentials.map((c) => {
      const s = state(c.issued_at, c.revoked_at, c.expires_at, null)
      return { credential_id: c.credential_id, state: s === 'SUSPENDED' ? 'REVOKED' : s }
    }),
    actions_so_far: bundle.actions.filter((a) => a.timestamp !== null && a.timestamp <= at).map((a) => a.action_id),
  }
}

/** Instants worth stopping at: every recorded authority change and every action. */
export function timeCheckpoints(bundle: EvidenceBundle): { at: string; label: string }[] {
  const out: { at: string; label: string }[] = []
  for (const d of bundle.delegations) {
    if (d.created_at) out.push({ at: d.created_at, label: `${d.delegation_id} created` })
    if (d.revoked_at) out.push({ at: d.revoked_at, label: `${d.delegation_id} revoked` })
    if (d.expires_at) out.push({ at: d.expires_at, label: `${d.delegation_id} expires` })
  }
  for (const c of bundle.credentials) if (c.revoked_at) out.push({ at: c.revoked_at, label: `${c.credential_id} revoked` })
  for (const p of bundle.principals) if (p.revoked_at) out.push({ at: p.revoked_at, label: `${p.display_name} revoked` })
  for (const a of bundle.actions) if (a.timestamp) out.push({ at: a.timestamp, label: a.event_id })
  return out.sort((x, y) => compareStrings(x.at, y.at) || compareStrings(x.label, y.label))
}
