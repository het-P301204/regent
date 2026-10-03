import { buildReplay } from './replay.ts'
import type { Replay } from './replay.ts'
import { explainAction } from './explain.ts'
import type { Explanation } from './explain.ts'
import { chainHealth } from './verify.ts'
import { compareStrings } from './scope.ts'
import type { ActionVerification, EvidenceBundle, Finding, VerificationRun } from './types.ts'

/**
 * Incident response: start from one event id and pull together who authorized
 * it, what broke, and every other action that shares its authority.
 */

export interface RelatedAction {
  action_id: string
  event_id: string
  timestamp: string | null
  actor_principal_id: string | null
  resource_id: string | null
  relation: string[]
  health: ReturnType<typeof chainHealth>
}

export interface Investigation {
  event_id: string
  action_id: string
  root_principal_id: string | null
  path: { principal_id: string | null; role: 'root' | 'delegatee' | 'actor' }[]
  tool_id: string | null
  execution_identity_id: string | null
  credential_id: string | null
  resource_id: string | null
  result: string | null
  verification: ActionVerification
  explanation: Explanation
  replay: Replay
  findings: Finding[]
  related: RelatedAction[]
  related_agents: string[]
  affected_resources: string[]
}

export function investigate(bundle: EvidenceBundle, run: VerificationRun, eventId: string): Investigation | null {
  const v = run.actions.find((a) => a.event_id === eventId || a.action_id === eventId)
  if (!v) return null
  const a = bundle.actions.find((x) => x.action_id === v.action_id)!
  const delegationIds = new Set(v.chain.hops.map((h) => h.delegation_id))
  const related: RelatedAction[] = []
  for (const o of run.actions) {
    if (o.action_id === v.action_id) continue
    const oa = bundle.actions.find((x) => x.action_id === o.action_id)!
    const rel: string[] = []
    if (o.chain.hops.some((h) => delegationIds.has(h.delegation_id))) rel.push('shares delegation')
    if (oa.actor_principal_id && oa.actor_principal_id === a.actor_principal_id) rel.push('same actor')
    if (oa.execution_identity_id && oa.execution_identity_id === a.execution_identity_id) rel.push('same execution identity')
    if (oa.credential_id && oa.credential_id === a.credential_id) rel.push('same credential')
    if (oa.parent_event_id === a.event_id) rel.push('child event')
    if (a.parent_event_id === oa.event_id) rel.push('parent event')
    if (rel.length > 0) {
      related.push({ action_id: o.action_id, event_id: o.event_id, timestamp: o.timestamp, actor_principal_id: oa.actor_principal_id, resource_id: oa.resource_id, relation: rel, health: chainHealth(o) })
    }
  }
  related.sort((x, y) => compareStrings(x.timestamp ?? '', y.timestamp ?? '') || compareStrings(x.event_id, y.event_id))
  const findings = v.finding_ids.map((id) => run.findings.find((f) => f.finding_id === id)).filter((f): f is Finding => f !== undefined)
  const agents = new Set<string>()
  for (const h of v.chain.hops) if (h.delegatee_principal_id) agents.add(h.delegatee_principal_id)
  for (const r of related) if (r.actor_principal_id) agents.add(r.actor_principal_id)
  const resources = new Set<string>([a.resource_id, ...related.map((r) => r.resource_id)].filter((x): x is string => !!x))
  return {
    event_id: v.event_id,
    action_id: v.action_id,
    root_principal_id: v.chain.root_principal_id,
    path: [
      ...(v.chain.root_principal_id ? [{ principal_id: v.chain.root_principal_id, role: 'root' as const }] : []),
      ...v.chain.hops.slice(0, -1).map((h) => ({ principal_id: h.delegatee_principal_id, role: 'delegatee' as const })),
      { principal_id: a.actor_principal_id, role: 'actor' as const },
    ],
    tool_id: a.tool_id,
    execution_identity_id: a.execution_identity_id,
    credential_id: a.credential_id,
    resource_id: a.resource_id,
    result: a.downstream_result,
    verification: v,
    explanation: explainAction(bundle, run, v.action_id)!,
    replay: buildReplay(bundle, run, v.action_id)!,
    findings,
    related,
    related_agents: [...agents].sort(compareStrings),
    affected_resources: [...resources].sort(compareStrings),
  }
}
