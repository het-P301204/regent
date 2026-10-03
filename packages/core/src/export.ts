import type { FindingExport } from './schemas.ts'
import type { Finding, FindingStatus, VerificationRun } from './types.ts'
import { stripBidi } from './text.ts'

export { stripBidi }

/** Machine-readable findings, schema `regent.finding/v1`. Field order and names are stable. */
export function toFindingExports(run: VerificationRun, statuses: Map<string, FindingStatus> = new Map()): FindingExport[] {
  return run.findings.map((f) => ({
    schema: 'regent.finding/v1' as const,
    finding_id: f.finding_id,
    type: f.type,
    rule_id: f.rule_id,
    severity: f.severity,
    status: statuses.get(f.finding_id) ?? 'OPEN',
    title: f.title,
    summary: f.summary,
    root_cause: f.root_cause,
    remediation: f.remediation,
    action_id: f.action_id,
    delegation_id: f.delegation_id,
    broken_edge: f.broken_edge,
    affected_principal_ids: f.affected_principal_ids,
    affected_resource_ids: f.affected_resource_ids,
    authority_delta: f.authority_delta
      ? {
          available: f.authority_delta.available ? [...f.authority_delta.available] : null,
          granted: f.authority_delta.granted ? [...f.authority_delta.granted] : null,
          requested: f.authority_delta.requested ? [...f.authority_delta.requested] : null,
          effective: f.authority_delta.effective ? [...f.authority_delta.effective] : null,
          exercised: f.authority_delta.exercised ? [...f.authority_delta.exercised] : null,
          excess: [...f.authority_delta.excess],
        }
      : null,
    missing_fields: f.missing_fields,
    evidence: f.evidence,
    related_event_ids: f.related_event_ids,
    first_seen: f.first_seen,
    last_seen: f.last_seen,
    input_digest: run.input_digest,
    ruleset_version: run.ruleset_version,
    engine_version: run.engine_version,
  }))
}

/**
 * CSV cell. Imported evidence is attacker-controlled, so a value that a
 * spreadsheet would treat as a formula (= + - @, tab, CR) is prefixed with a
 * single quote, and bidirectional-override characters are removed so a cell
 * cannot visually reorder itself.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = Array.isArray(value) ? value.join(' ') : String(value)
  s = stripBidi(s)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}


export function findingsCsv(run: VerificationRun, statuses: Map<string, FindingStatus> = new Map()): string {
  const header = ['finding_id', 'type', 'rule_id', 'severity', 'status', 'title', 'summary', 'action_id', 'delegation_id', 'broken_edge_from', 'broken_edge_to', 'excess_authority', 'affected_principals', 'affected_resources', 'first_seen', 'last_seen', 'remediation']
  const rows = run.findings.map((f: Finding) => [
    f.finding_id, f.type, f.rule_id, f.severity, statuses.get(f.finding_id) ?? 'OPEN', f.title, f.summary, f.action_id, f.delegation_id,
    f.broken_edge?.from, f.broken_edge?.to, f.authority_delta?.excess ?? [], f.affected_principal_ids, f.affected_resource_ids, f.first_seen, f.last_seen, f.remediation,
  ])
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function actionsCsv(run: VerificationRun): string {
  const header = ['event_id', 'timestamp', 'root_principal_id', 'actor_principal_id', 'derived_decision', 'recorded_decision', 'decision_agreement', 'overall', 'attribution', 'authority', 'scope', 'identity', 'temporal', 'record_completeness_pct', 'effective_scope', 'exercised_scope', 'finding_ids']
  const rows = run.actions.map((a) => {
    const c = (d: string) => a.checks.find((x) => x.dimension === d)?.result ?? ''
    return [a.event_id, a.timestamp, a.chain.root_principal_id, a.chain.actor_principal_id, a.derived_decision, a.recorded_decision, a.decision_agreement, a.overall, c('attribution'), c('authority'), c('scope'), c('identity'), c('temporal'), a.record_completeness.percent, a.effective_scope ?? 'unknown', a.exercised_scope ?? 'unknown', a.finding_ids]
  })
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
