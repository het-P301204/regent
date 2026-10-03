import { chainHealth, compareStrings, explainAction, buildReplay, SEVERITY_ORDER } from '@regent/core'
import type { Action, ActionVerification, Delegation, EvidenceBundle, Finding, FindingStatus, ResolvedHop, Severity } from '@regent/core'
import type { Workspace } from './workspace.ts'

/**
 * View models. These only reshape engine output for display; they never
 * decide anything. Every verdict below is read from the stored run.
 */

/**
 * Lookup tables built once per verification run and cached with it. Every
 * route reads through these instead of scanning arrays per row, so request
 * cost stays linear in the size of the response, not the dataset squared.
 */
export interface WorkspaceIndex {
  action: Map<string, Action>
  verification: Map<string, ActionVerification>
  finding: Map<string, Finding>
  names: ReturnType<typeof nameIndex>
  hopByDelegation: Map<string, ResolvedHop>
  actionsByDelegation: Map<string, ActionVerification[]>
  actionsByCredential: Map<string, ActionVerification[]>
  actionsByPrincipal: Map<string, ActionVerification[]>
  findingsByPrincipal: Map<string, Finding[]>
  findingsByDelegation: Map<string, Finding[]>
  findingsByCredential: Map<string, Finding[]>
  delegationsByDelegatee: Map<string, Delegation[]>
  delegationsByDelegator: Map<string, Delegation[]>
  delegationsByParent: Map<string, Delegation[]>
}

const INDEX = new WeakMap<object, WorkspaceIndex>()

function push<K, V>(m: Map<K, V[]>, k: K | null | undefined, v: V) {
  if (k === null || k === undefined) return
  const list = m.get(k)
  if (list) {
    if (list[list.length - 1] !== v) list.push(v)
  } else m.set(k, [v])
}

export function indexOf(ws: Workspace): WorkspaceIndex {
  const hit = INDEX.get(ws.run)
  if (hit) return hit
  const ix: WorkspaceIndex = {
    action: new Map(ws.bundle.actions.map((a) => [a.action_id, a])),
    verification: new Map(),
    finding: new Map(ws.run.findings.map((f) => [f.finding_id, f])),
    names: nameIndex(ws.bundle),
    hopByDelegation: new Map(),
    actionsByDelegation: new Map(),
    actionsByCredential: new Map(),
    actionsByPrincipal: new Map(),
    findingsByPrincipal: new Map(),
    findingsByDelegation: new Map(),
    findingsByCredential: new Map(),
    delegationsByDelegatee: new Map(),
    delegationsByDelegator: new Map(),
    delegationsByParent: new Map(),
  }
  for (const v of ws.run.actions) {
    ix.verification.set(v.action_id, v)
    if (!ix.verification.has(v.event_id)) ix.verification.set(v.event_id, v)
    push(ix.actionsByPrincipal, v.chain.actor_principal_id, v)
    for (const h of v.chain.hops) {
      if (!ix.hopByDelegation.has(h.delegation_id)) ix.hopByDelegation.set(h.delegation_id, h)
      push(ix.actionsByDelegation, h.delegation_id, v)
      if (h.delegator_principal_id !== v.chain.actor_principal_id) push(ix.actionsByPrincipal, h.delegator_principal_id, v)
      if (h.delegatee_principal_id !== v.chain.actor_principal_id && h.delegatee_principal_id !== h.delegator_principal_id) push(ix.actionsByPrincipal, h.delegatee_principal_id, v)
    }
    push(ix.actionsByCredential, ix.action.get(v.action_id)?.credential_id, v)
  }
  for (const f of ws.run.findings) {
    for (const p of f.affected_principal_ids) push(ix.findingsByPrincipal, p, f)
    if (f.delegation_id) push(ix.findingsByDelegation, f.delegation_id, f)
    for (const e of f.evidence) {
      if (e.kind === 'delegation' && e.id !== f.delegation_id) push(ix.findingsByDelegation, e.id, f)
      if (e.kind === 'credential') push(ix.findingsByCredential, e.id, f)
    }
  }
  for (const d of ws.bundle.delegations) {
    push(ix.delegationsByDelegatee, d.delegatee_principal_id, d)
    push(ix.delegationsByDelegator, d.delegator_principal_id, d)
    push(ix.delegationsByParent, d.parent_delegation_id, d)
  }
  INDEX.set(ws.run, ix)
  return ix
}

export function statusOf(ws: Workspace, id: string): FindingStatus {
  return ws.statuses.get(id)?.status ?? 'OPEN'
}

export function findingView(ws: Workspace, f: Finding) {
  const s = ws.statuses.get(f.finding_id)
  return { ...f, status: s?.status ?? 'OPEN', status_note: s?.note ?? null, status_updated_by: s?.updated_by ?? null, status_updated_at: s?.updated_at ?? null }
}

export function chainRow(ws: Workspace, v: ActionVerification) {
  const ix = indexOf(ws)
  const a = ix.action.get(v.action_id)!
  const names = ix.names
  const worst = v.finding_ids.map((id) => ix.finding.get(id)).filter((f): f is Finding => !!f).sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity])[0]
  return {
    action_id: v.action_id,
    event_id: v.event_id,
    timestamp: v.timestamp,
    root_principal_id: v.chain.root_principal_id,
    root_name: v.chain.root_principal_id ? names.p(v.chain.root_principal_id) : null,
    actor_principal_id: a.actor_principal_id,
    actor_name: a.actor_principal_id ? names.p(a.actor_principal_id) : null,
    path: [v.chain.root_principal_id, ...v.chain.hops.map((h) => h.delegatee_principal_id)].filter((x): x is string => !!x).map((id) => ({ id, name: names.p(id) })),
    hop_count: v.chain.hops.length,
    tool_id: a.tool_id,
    tool_name: a.tool_id ? names.t(a.tool_id) : null,
    resource_id: a.resource_id,
    resource_name: a.resource_id ? names.r(a.resource_id) : null,
    operation: a.operation,
    exercised_scope: v.exercised_scope,
    effective_scope: v.effective_scope,
    derived_decision: v.derived_decision,
    recorded_decision: v.recorded_decision,
    decision_agreement: v.decision_agreement,
    health: chainHealth(v),
    overall: v.overall,
    checks: Object.fromEntries(v.checks.map((c) => [c.dimension, c.result])),
    finding_count: v.finding_ids.length,
    worst_severity: worst?.severity ?? null,
    record_completeness: v.record_completeness.percent,
  }
}

export function chainDetail(ws: Workspace, v: ActionVerification) {
  const ix = indexOf(ws)
  const a = ix.action.get(v.action_id)!
  const ids = new Set<string>([a.actor_principal_id, v.chain.root_principal_id, ...v.chain.hops.flatMap((h) => [h.delegator_principal_id, h.delegatee_principal_id])].filter((x): x is string => !!x))
  return {
    row: chainRow(ws, v),
    action: a,
    verification: v,
    findings: v.finding_ids.map((id) => ix.finding.get(id)).filter((f): f is Finding => !!f).map((f) => findingView(ws, f)),
    principals: ws.bundle.principals.filter((p) => ids.has(p.principal_id)),
    delegations: ws.bundle.delegations.filter((d) => v.chain.hops.some((h) => h.delegation_id === d.delegation_id)),
    execution_identity: ws.bundle.execution_identities.find((e) => e.execution_identity_id === a.execution_identity_id) ?? null,
    credential: ws.bundle.credentials.find((c) => c.credential_id === a.credential_id) ?? null,
    tool: ws.bundle.tools.find((t) => t.tool_id === a.tool_id) ?? null,
    resource: ws.bundle.resources.find((r) => r.resource_id === a.resource_id) ?? null,
    policy: ws.bundle.policies.find((p) => p.policy_id === a.policy_id && p.policy_version === a.policy_version) ?? null,
    explanation: explainAction(ws.bundle, ws.run, v.action_id),
    replay: buildReplay(ws.bundle, ws.run, v.action_id),
  }
}

export function nameIndex(b: EvidenceBundle) {
  const p = new Map(b.principals.map((x) => [x.principal_id, x.display_name]))
  const t = new Map(b.tools.map((x) => [x.tool_id, x.display_name]))
  const r = new Map(b.resources.map((x) => [x.resource_id, x.display_name]))
  return { p: (id: string) => p.get(id) ?? id, t: (id: string) => t.get(id) ?? id, r: (id: string) => r.get(id) ?? id }
}

export function overview(ws: Workspace) {
  const s = ws.run.summary
  const actions = ws.run.actions
  // Hourly activity by health, for the activity timeline.
  const buckets = new Map<string, { verified: number; incomplete: number; violated: number; unknown: number }>()
  for (const a of actions) {
    if (!a.timestamp) continue
    const hour = `${a.timestamp.slice(0, 13)}:00:00.000Z`
    const b = buckets.get(hour) ?? { verified: 0, incomplete: 0, violated: 0, unknown: 0 }
    b[chainHealth(a)]++
    buckets.set(hour, b)
  }
  const timeline = [...buckets.entries()].sort((x, y) => compareStrings(x[0], y[0])).map(([hour, v]) => ({ hour, ...v }))
  const ix = indexOf(ws)
  const names = ix.names
  // Authority-risk distribution: worst finding severity per action.
  const risk: Record<Severity | 'none', number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0, none: 0 }
  for (const a of actions) {
    const sevs = a.finding_ids.map((id) => ix.finding.get(id)?.severity).filter((x): x is Severity => !!x)
    const worst = sevs.sort((x, y) => SEVERITY_ORDER[x] - SEVERITY_ORDER[y])[0]
    risk[worst ?? 'none']++
  }
  // Per-dimension pass rates, for chain health.
  const dims = ['attribution', 'chain_completeness', 'authority', 'scope', 'identity', 'credential_binding', 'temporal', 'policy', 'approval', 'evidence'] as const
  const dimension_health = dims.map((d) => {
    const counts = { PASS: 0, WARN: 0, FAIL: 0, UNKNOWN: 0, SKIPPED: 0 }
    let label = d as string
    for (const a of actions) {
      const c = a.checks.find((x) => x.dimension === d)
      if (c) {
        counts[c.result]++
        label = c.label
      }
    }
    return { dimension: d, label, ...counts }
  })
  const statusCounts: Record<FindingStatus, number> = { OPEN: 0, INVESTIGATING: 0, ACCEPTED: 0, RESOLVED: 0, SUPPRESSED: 0 }
  for (const f of ws.run.findings) statusCounts[statusOf(ws, f.finding_id)]++
  const active = new Set<string>()
  for (const a of ws.bundle.actions) if (a.actor_principal_id) active.add(a.actor_principal_id)
  const highRisk = actions.filter((a) => chainHealth(a) === 'violated').length
  const recent = [...actions].sort((x, y) => compareStrings(y.timestamp ?? '', x.timestamp ?? '')).slice(0, 8).map((v) => chainRow(ws, v))
  return {
    dataset: ws.dataset,
    run: { id: ws.run_id, created_at: ws.run_created_at, input_digest: ws.run.input_digest, ruleset_version: ws.run.ruleset_version, engine_version: ws.run.engine_version },
    summary: s,
    metrics: {
      total_actions: s.total_actions,
      attributable_actions: s.attributable_actions,
      unattributable_actions: s.unattributable_actions,
      authority_violations: s.authority_violations,
      amplification_events: s.amplification_events,
      broken_chains: s.broken_chains,
      missing_field_records: s.missing_field_records,
      active_identities: active.size,
      registered_identities: ws.bundle.principals.length,
      active_delegations: ws.bundle.delegations.length,
      high_risk_chains: highRisk,
      policy_violations: ws.run.findings.filter((f) => f.type === 'MISSING_POLICY_VERSION' || f.type === 'MISSING_APPROVAL' || f.type === 'SCOPE_VIOLATION').length,
      open_findings: statusCounts.OPEN + statusCounts.INVESTIGATING,
      authority_integrity: s.authority_integrity,
    },
    timeline,
    risk_distribution: risk,
    dimension_health,
    finding_status: statusCounts,
    recent_findings: ws.run.findings.slice(0, 6).map((f) => ({ ...findingView(ws, f), actor_name: f.affected_principal_ids[f.affected_principal_ids.length - 1] ? names.p(f.affected_principal_ids[f.affected_principal_ids.length - 1]!) : null })),
    recent_actions: recent,
  }
}

/** Fuzzy search: subsequence match with a score favouring prefix and contiguous runs. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx === 0) return 100 - Math.min(t.length - q.length, 50) * 0.1
  if (idx > 0) return 80 - idx * 0.5
  let ti = 0
  let score = 0
  let run = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    run = found === ti ? run + 1 : 0
    score += 1 + run
    ti = found + 1
  }
  return Math.min(60, (score / q.length) * 10)
}

export function search(ws: Workspace, query: string, limit = 30) {
  const q = query.trim().slice(0, 100)
  if (!q) return []
  type Hit = { kind: string; id: string; label: string; sublabel: string; href: string; score: number }
  const hits: Hit[] = []
  const add = (kind: string, id: string, label: string, sublabel: string, href: string) => {
    const score = Math.max(fuzzyScore(q, label), fuzzyScore(q, id) * 0.95)
    if (score > 8) hits.push({ kind, id, label, sublabel, href, score })
  }
  for (const p of ws.bundle.principals) add(p.principal_type === 'human' ? 'principal' : 'agent', p.principal_id, p.display_name, `${p.principal_type.replace('_', '-')} · ${p.principal_id}`, `/app/identities/${encodeURIComponent(p.principal_id)}`)
  for (const d of ws.bundle.delegations) add('delegation', d.delegation_id, d.delegation_id, `${d.delegator_principal_id ?? '?'} → ${d.delegatee_principal_id ?? '?'}`, `/app/delegations/${encodeURIComponent(d.delegation_id)}`)
  for (const a of ws.bundle.actions) add('event', a.event_id, a.event_id, `${a.operation ?? 'action'} · ${a.actor_principal_id ?? 'unknown actor'}`, `/app/chains/${encodeURIComponent(a.action_id)}`)
  for (const f of ws.run.findings) add('finding', f.finding_id, `${f.title}: ${f.summary}`, f.finding_id, `/app/findings/${encodeURIComponent(f.finding_id)}`)
  for (const c of ws.bundle.credentials) add('credential', c.credential_id, c.credential_id, `${c.credential_type} · bound to ${c.execution_identity_id ?? 'nothing'}`, `/app/credentials?focus=${encodeURIComponent(c.credential_id)}`)
  for (const e of ws.bundle.execution_identities) add('execution identity', e.execution_identity_id, e.execution_identity_id, `workload · issued to ${e.bound_principal_id ?? 'unrecorded'}`, `/app/credentials?focus=${encodeURIComponent(e.execution_identity_id)}`)
  for (const t of ws.bundle.tools) add('tool', t.tool_id, t.display_name, `${t.kind} · ${t.tool_id}`, `/app/chains?tool=${encodeURIComponent(t.tool_id)}`)
  for (const r of ws.bundle.resources) add('resource', r.resource_id, r.display_name, `${r.kind} · ${r.resource_id}`, `/app/chains?resource=${encodeURIComponent(r.resource_id)}`)
  return hits.sort((a, b) => b.score - a.score || compareStrings(a.label, b.label)).slice(0, limit).map(({ score: _s, ...h }) => h)
}
