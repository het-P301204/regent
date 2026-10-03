import { formatScope } from './scope.ts'
import { namesFor } from './explain.ts'
import type { CheckResult, EvidenceBundle, VerificationRun } from './types.ts'

/**
 * Action Replay. Steps are built only from recorded timestamps; a step with no
 * timestamp is listed separately as untimed rather than given an invented time.
 */

export type ReplayKind = 'delegation' | 'spawn' | 'revocation' | 'expiry' | 'request' | 'authorization' | 'credential' | 'execution' | 'result'

export interface ReplayStep {
  index: number
  at: string | null
  offset_ms: number | null
  kind: ReplayKind
  title: string
  detail: string
  edge: { from: string | null; to: string | null; kind: 'DELEGATES' | 'INVOKES' | 'EXECUTES_AS' | 'AUTHENTICATES_WITH' | 'TARGETS' | 'GOVERNED_BY' } | null
  status: CheckResult
}

export interface Replay {
  action_id: string
  event_id: string
  steps: ReplayStep[]
  untimed: ReplayStep[]
  /** Index of the first step at which an invariant breaks, if any. */
  violation_index: number | null
}

const ORDER: Record<ReplayKind, number> = { delegation: 0, spawn: 0, revocation: 1, expiry: 1, request: 2, authorization: 3, credential: 4, execution: 5, result: 6 }

export function buildReplay(bundle: EvidenceBundle, run: VerificationRun, actionId: string): Replay | null {
  const v = run.actions.find((a) => a.action_id === actionId || a.event_id === actionId)
  if (!v) return null
  const a = bundle.actions.find((x) => x.action_id === v.action_id)!
  const n = namesFor(bundle)
  const principals = new Map(bundle.principals.map((p) => [p.principal_id, p]))
  const raw: Omit<ReplayStep, 'index' | 'offset_ms'>[] = []
  const t = a.timestamp
  const check = (d: string) => v.checks.find((c) => c.dimension === d)?.result ?? 'UNKNOWN'

  for (const h of v.chain.hops) {
    const sub = principals.get(h.delegatee_principal_id ?? '')?.principal_type === 'sub_agent'
    raw.push({
      at: h.created_at,
      kind: sub ? 'spawn' : 'delegation',
      title: sub ? `${n.principal(h.delegator_principal_id)} spawned ${n.principal(h.delegatee_principal_id)}` : `${n.principal(h.delegator_principal_id)} delegated to ${n.principal(h.delegatee_principal_id)}`,
      detail: `Granted {${formatScope(h.granted_scope)}}${h.amplified.length ? `; {${formatScope(h.amplified)}} was not held by the delegator` : ''}. ${h.delegation_id}.`,
      edge: { from: h.delegator_principal_id, to: h.delegatee_principal_id, kind: 'DELEGATES' },
      // A temporal failure is shown at the moment it happens (revocation/expiry step), not at creation.
      status: h.amplified.length > 0 ? 'FAIL' : h.temporal === 'EXPIRED' || h.temporal === 'REVOKED' ? 'WARN' : h.result,
    })
    if (h.revoked_at && t && h.revoked_at <= t) {
      raw.push({ at: h.revoked_at, kind: 'revocation', title: `Delegation ${h.delegation_id} revoked`, detail: `${n.principal(h.delegator_principal_id)} → ${n.principal(h.delegatee_principal_id)} is no longer in force.`, edge: { from: h.delegator_principal_id, to: h.delegatee_principal_id, kind: 'DELEGATES' }, status: v.executed ? 'FAIL' : 'WARN' })
    }
    if (h.expires_at && t && h.expires_at <= t) {
      raw.push({ at: h.expires_at, kind: 'expiry', title: `Delegation ${h.delegation_id} expired`, detail: `${n.principal(h.delegator_principal_id)} → ${n.principal(h.delegatee_principal_id)} is no longer in force.`, edge: { from: h.delegator_principal_id, to: h.delegatee_principal_id, kind: 'DELEGATES' }, status: v.executed ? 'FAIL' : 'WARN' })
    }
  }
  const cred = bundle.credentials.find((c) => c.credential_id === a.credential_id)
  if (cred?.revoked_at && t && cred.revoked_at <= t) {
    raw.push({ at: cred.revoked_at, kind: 'revocation', title: `Credential ${cred.credential_id} revoked`, detail: 'Any execution authenticating with it after this point is not valid.', edge: { from: a.execution_identity_id, to: cred.credential_id, kind: 'AUTHENTICATES_WITH' }, status: v.executed ? 'FAIL' : 'WARN' })
  }
  for (const pid of [v.chain.root_principal_id, a.actor_principal_id]) {
    const p = pid ? principals.get(pid) : undefined
    if (p?.revoked_at && t && p.revoked_at <= t) raw.push({ at: p.revoked_at, kind: 'revocation', title: `${p.display_name} revoked`, detail: 'Authority derived from this principal ends here.', edge: null, status: v.executed ? 'FAIL' : 'WARN' })
  }

  const actor = n.principal(a.actor_principal_id)
  raw.push({
    at: t,
    kind: 'request',
    title: `${actor} requested ${n.tool(a.tool_id)}`,
    detail: a.requested_scope ? `Requested {${formatScope(a.requested_scope)}} for ${a.operation ?? 'an operation'} on ${n.resource(a.resource_id)}.` : 'Requested scope not recorded.',
    edge: { from: a.actor_principal_id, to: a.tool_id, kind: 'INVOKES' },
    status: a.requested_scope ? 'PASS' : 'WARN',
  })
  raw.push({
    at: a.authorization_evaluated_at,
    kind: 'authorization',
    title: `Authorization evaluated: ${a.recorded_decision ?? 'no decision recorded'}`,
    detail: `${a.policy_id ? `${a.policy_id}${a.policy_version ? ` v${a.policy_version}` : ' (version not recorded)'}` : 'No policy recorded'}. REGENT's action-time decision: ${v.derived_decision}.${a.decision_reason ? ` Reason recorded: "${a.decision_reason}".` : ''}`,
    edge: { from: a.action_id, to: a.policy_id, kind: 'GOVERNED_BY' },
    // A disagreeing decision is flagged, but the violation itself is placed on the step that broke the invariant.
    status: v.decision_agreement === 'DISAGREE' ? 'WARN' : check('policy') === 'FAIL' ? 'FAIL' : check('policy'),
  })
  raw.push({
    at: t,
    kind: 'credential',
    title: `Executed as ${a.execution_identity_id ?? 'an unrecorded identity'}`,
    detail: `Credential ${a.credential_id ?? 'not recorded'}. ${v.checks.find((c) => c.dimension === 'identity')?.detail ?? ''}`,
    edge: { from: a.tool_id, to: a.execution_identity_id, kind: 'EXECUTES_AS' },
    status: worst(check('identity'), check('credential_binding')),
  })
  raw.push({
    at: t,
    kind: 'execution',
    title: `${n.resource(a.resource_id)} accessed`,
    detail: `Exercised {${formatScope(a.exercised_scope)}}. ${v.checks.find((c) => c.dimension === 'scope')?.detail ?? ''}`,
    edge: { from: a.execution_identity_id ?? a.tool_id, to: a.resource_id, kind: 'TARGETS' },
    status: worst(check('scope'), check('authority') === 'FAIL' && check('scope') === 'FAIL' ? 'FAIL' : 'PASS', check('approval')),
  })
  if (a.downstream_result) {
    raw.push({ at: t, kind: 'result', title: `Downstream result: ${a.downstream_result}`, detail: v.executed ? 'The action took effect.' : 'The action did not take effect.', edge: null, status: 'PASS' })
  }

  const timed = raw.filter((s) => s.at !== null).sort((x, y) => (x.at! < y.at! ? -1 : x.at! > y.at! ? 1 : ORDER[x.kind] - ORDER[y.kind]))
  const start = timed[0]?.at ? Date.parse(timed[0].at) : null
  const steps: ReplayStep[] = timed.map((s, i) => ({ ...s, index: i, offset_ms: start !== null ? Date.parse(s.at!) - start : null }))
  const untimed: ReplayStep[] = raw.filter((s) => s.at === null).map((s, i) => ({ ...s, index: steps.length + i, offset_ms: null }))
  const vi = steps.findIndex((s) => s.status === 'FAIL')
  return { action_id: v.action_id, event_id: v.event_id, steps, untimed, violation_index: vi === -1 ? null : vi }
}

const W: Record<CheckResult, number> = { SKIPPED: 0, PASS: 1, WARN: 2, UNKNOWN: 3, FAIL: 4 }
function worst(...r: CheckResult[]): CheckResult {
  return r.reduce((acc, x) => (W[x] > W[acc] ? x : acc), 'PASS' as CheckResult)
}
