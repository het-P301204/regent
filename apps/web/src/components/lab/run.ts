import type { ActionVerification, Explanation, Finding, IngestIssue, Replay, RunSummary, VerificationRun, DatasetRow, FindingType } from '../../lib/types'
import type { FlowStage } from '../../viz/model'

/** POST /api/builder/verify */
export interface BuilderVerifyResponse {
  run: VerificationRun
  explanations: (Explanation | null)[]
  replays: (Replay | null)[]
  names: Record<string, string>
  records: unknown[]
  issues: IngestIssue[]
}

/** POST /api/events, /api/events/generate */
export interface ImportResponse {
  dataset: DatasetRow
  run_id: string
  stats: { records_read: number; records_accepted: number; records_rejected: number; by_type: Record<string, number> }
  issues: IngestIssue[]
  summary: RunSummary
}

/** GET /api/scenarios */
export interface ScenarioCard {
  slug: string
  number: number
  title: string
  summary: string
  teaches: string
  focus_event: string
  expected: FindingType[]
  record_count: number
}

/** POST /api/scenarios */
export interface ScenarioLoadResponse {
  dataset: DatasetRow
  run_id: string
  focus_event: string
  summary: RunSummary
  expected: FindingType[]
  produced: FindingType[]
  matches_expected: boolean
}

export function totalFindings(s: RunSummary): number {
  return Object.values(s.findings_by_severity).reduce((a, b) => a + b, 0)
}

/**
 * Authority Flow stages for one verified action, read from the engine's
 * reconstructed chain. Mirrors viz/model.flowStages, but from a raw
 * VerificationRun (the builder endpoint) rather than a ChainDetail. Pure
 * reshaping: effective scopes, amplified permissions and excess are the
 * engine's own lists.
 */
export function flowStagesFromRun(v: ActionVerification, findings: Finding[], names: Record<string, string>, toolLabel: string): FlowStage[] {
  const pname = (id: string | null) => (id ? (names[id] ?? id) : 'Unknown')
  const stages: FlowStage[] = []
  const first = v.chain.hops[0]
  if (first) {
    stages.push({ id: 'root', label: pname(first.delegator_principal_id), role: v.chain.root_principal_id ? 'Human principal' : 'Unverified origin', scope: first.available_scope ?? first.granted_scope, excess: [], result: v.chain.root_principal_id ? 'PASS' : 'FAIL' })
  } else if (v.chain.root_principal_id) {
    stages.push({ id: 'root', label: pname(v.chain.root_principal_id), role: 'Human principal', scope: v.effective_scope, excess: [], result: 'PASS' })
  }
  for (const h of v.chain.hops) {
    stages.push({ id: `hop-${h.hop_index}`, label: pname(h.delegatee_principal_id), role: h.hop_index === 0 ? 'Agent' : 'Sub-agent', scope: h.effective_scope, excess: h.amplified, result: h.result })
  }
  const amp = findings.find((f) => (f.type === 'AUTHORITY_AMPLIFICATION' || f.type === 'SCOPE_VIOLATION') && f.action_id === v.action_id && (f.authority_delta?.excess.length ?? 0) > 0)
  const excess = amp?.authority_delta?.excess ?? []
  const exercised = v.exercised_scope
  stages.push({ id: 'action', label: toolLabel, role: 'Exercised', scope: exercised ? exercised.filter((p) => !excess.includes(p)) : null, excess, result: v.checks.find((c) => c.dimension === 'scope')?.result ?? 'UNKNOWN' })
  return stages
}
