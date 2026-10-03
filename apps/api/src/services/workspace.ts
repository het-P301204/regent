import { randomUUID } from 'node:crypto'
import {
  buildRuleSet,
  chainHealth,
  DEFAULT_RULES,
  normalizeRecords,
  normalizeText,
  sha256,
  verify,
} from '@regent/core'
import type { EvidenceBundle, FindingStatus, NormalizeResult, RuleConfig, RuleId, RuleSet, VerificationRun, Finding, ActionVerification } from '@regent/core'
import type { Db } from '../db/driver.ts'
import { loadBundle, loadIssues, storeBundle } from '../repo/evidence.ts'

export type DatasetSource = 'demo' | 'scenario' | 'import' | 'builder'

export interface DatasetRow {
  id: string
  organization_id: string
  name: string
  source: DatasetSource
  source_metadata: Record<string, unknown>
  input_sha256: string
  records_read: number
  records_accepted: number
  records_rejected: number
  created_by: string | null
  created_at: string
}

export interface Workspace {
  dataset: DatasetRow
  bundle: EvidenceBundle
  run: VerificationRun
  run_id: string
  run_created_at: string
  statuses: Map<string, { status: FindingStatus; note: string | null; updated_by: string | null; updated_at: string }>
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

/**
 * The service layer: everything the routes do goes through here, scoped by
 * organization. Verification always runs server-side through @regent/core.
 */
export class WorkspaceService {
  private readonly cache = new Map<string, { bundle: EvidenceBundle; run: VerificationRun; run_created_at: string }>()
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  // ------------------------------------------------------------ rule sets

  async ruleset(org: string): Promise<RuleSet> {
    const rows = await this.db.query<{ rule_id: RuleId; enabled: boolean; severity: RuleConfig['severity']; applies_to: string[]; remediation: string }>(
      'SELECT rule_id, enabled, severity, applies_to, remediation FROM rule_configs WHERE organization_id = $1', [org])
    const [o] = await this.db.query<{ ruleset_revision: number }>('SELECT ruleset_revision FROM organizations WHERE id = $1', [org])
    const overrides: Parameters<typeof buildRuleSet>[0] = {}
    for (const r of rows) overrides[r.rule_id] = { enabled: r.enabled, severity: r.severity, applies_to: r.applies_to as RuleConfig['applies_to'], remediation: r.remediation }
    const rev = o?.ruleset_revision ?? 0
    const rs = buildRuleSet(overrides, rev === 0 ? '2026.10.1' : `2026.10.1+org.${rev}`)
    return rev === 0 ? { ...rs, ruleset_id: 'regent-default' } : rs
  }

  async updateRule(org: string, user: string, ruleId: RuleId, patch: Partial<Pick<RuleConfig, 'enabled' | 'severity' | 'applies_to' | 'remediation'>>): Promise<RuleSet> {
    const current = (await this.ruleset(org)).rules.find((r) => r.rule_id === ruleId)
    if (!current) throw new Error('unknown rule')
    const next = { ...current, ...patch }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO rule_configs (organization_id, rule_id, enabled, severity, applies_to, remediation, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (organization_id, rule_id) DO UPDATE SET enabled = $3, severity = $4, applies_to = $5, remediation = $6, updated_by = $7, updated_at = now()`,
        [org, ruleId, next.enabled, next.severity, [...next.applies_to], next.remediation, user])
      await tx.query('UPDATE organizations SET ruleset_revision = ruleset_revision + 1 WHERE id = $1', [org])
    })
    return this.ruleset(org)
  }

  async resetRules(org: string): Promise<void> {
    await this.db.query('DELETE FROM rule_configs WHERE organization_id = $1', [org])
    await this.db.query('UPDATE organizations SET ruleset_revision = ruleset_revision + 1 WHERE id = $1', [org])
  }

  // ------------------------------------------------------------- datasets

  async createDataset(org: string, user: string | null, input: { name: string; source: DatasetSource; metadata: Record<string, unknown>; text?: string; records?: unknown[] }): Promise<{ dataset: DatasetRow; normalized: NormalizeResult; run_id: string; run: VerificationRun }> {
    const normalized = input.text !== undefined ? normalizeText(input.text) : normalizeRecords(input.records ?? [])
    const rawDigest = sha256(input.text ?? JSON.stringify(input.records ?? []))
    const id = `ds_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO datasets (id, organization_id, name, source, source_metadata, input_sha256, records_read, records_accepted, records_rejected, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, org, input.name, input.source, JSON.stringify(input.metadata), rawDigest, normalized.stats.records_read, normalized.stats.records_accepted, normalized.stats.records_rejected, user])
      await storeBundle(tx, org, id, normalized.bundle, normalized.issues)
    })
    const { run_id, run } = await this.runVerification(org, id, user)
    const dataset = (await this.getDataset(org, id))!
    return { dataset, normalized, run_id, run }
  }

  async listDatasets(org: string): Promise<(DatasetRow & { latest_run: { id: string; created_at: string; summary: unknown } | null })[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT d.*, r.id AS run_id, r.created_at AS run_created_at, r.summary AS run_summary
         FROM datasets d
         LEFT JOIN LATERAL (SELECT id, created_at, summary FROM verification_runs v WHERE v.dataset_id = d.id AND v.organization_id = d.organization_id ORDER BY created_at DESC LIMIT 1) r ON true
        WHERE d.organization_id = $1
        ORDER BY d.created_at DESC`, [org])
    return rows.map((r) => ({ ...toDataset(r), latest_run: r['run_id'] ? { id: String(r['run_id']), created_at: iso(r['run_created_at']), summary: r['run_summary'] } : null }))
  }

  async getDataset(org: string, id: string): Promise<DatasetRow | null> {
    const [r] = await this.db.query<Record<string, unknown>>('SELECT * FROM datasets WHERE organization_id = $1 AND id = $2', [org, id])
    return r ? toDataset(r) : null
  }

  async deleteDataset(org: string, id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>("DELETE FROM datasets WHERE organization_id = $1 AND id = $2 AND source <> 'demo' RETURNING id", [org, id])
    for (const k of this.cache.keys()) if (k.startsWith(`${id}:`)) this.cache.delete(k)
    return rows.length > 0
  }

  async demoDatasetId(org: string): Promise<string | null> {
    const [r] = await this.db.query<{ id: string }>("SELECT id FROM datasets WHERE organization_id = $1 AND source = 'demo' ORDER BY created_at ASC LIMIT 1", [org])
    return r?.id ?? null
  }

  // ---------------------------------------------------------- verification

  async runVerification(org: string, dataset: string, user: string | null): Promise<{ run_id: string; run: VerificationRun }> {
    const bundle = await loadBundle(this.db, org, dataset)
    const ruleset = await this.ruleset(org)
    const started = performance.now()
    const run = verify(bundle, { ruleset })
    const duration = Math.round(performance.now() - started)
    const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO verification_runs (id, organization_id, dataset_id, input_digest, ruleset_version, engine_version, summary, duration_ms, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runId, org, dataset, run.input_digest, run.ruleset_version, run.engine_version, JSON.stringify(run.summary), duration, user])
      const actionRows = run.actions.map((a) => [runId, org, a.action_id, a.event_id, a.timestamp, a.chain.actor_principal_id, a.chain.root_principal_id, bundle.actions.find((x) => x.action_id === a.action_id)?.resource_id ?? null, a.overall, chainHealth(a), a.derived_decision, a.recorded_decision, a.finding_ids.length, JSON.stringify(a)])
      await insertRows(tx, 'action_results', ['run_id', 'organization_id', 'action_id', 'event_id', 'ts', 'actor_principal_id', 'root_principal_id', 'resource_id', 'overall', 'health', 'derived_decision', 'recorded_decision', 'finding_count', 'result'], actionRows)
      const findingRows = run.findings.map((f) => [runId, org, dataset, f.finding_id, f.type, f.rule_id, f.severity, f.title, f.summary, f.action_id, f.delegation_id, f.first_seen, f.last_seen, JSON.stringify(f)])
      await insertRows(tx, 'findings', ['run_id', 'organization_id', 'dataset_id', 'finding_id', 'type', 'rule_id', 'severity', 'title', 'summary', 'action_id', 'delegation_id', 'first_seen', 'last_seen', 'body'], findingRows)
    })
    return { run_id: runId, run }
  }

  /** The dataset's latest run together with its evidence. Cached per run id. */
  async workspace(org: string, dataset: string): Promise<Workspace | null> {
    const ds = await this.getDataset(org, dataset)
    if (!ds) return null
    const [runRow] = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM verification_runs WHERE organization_id = $1 AND dataset_id = $2 ORDER BY created_at DESC LIMIT 1', [org, dataset])
    if (!runRow) return null
    const runId = String(runRow['id'])
    const key = `${dataset}:${runId}`
    let cached = this.cache.get(key)
    if (!cached) {
      const bundle = await loadBundle(this.db, org, dataset)
      const actions = await this.db.query<{ result: unknown }>('SELECT result FROM action_results WHERE organization_id = $1 AND run_id = $2', [org, runId])
      const findings = await this.db.query<{ body: unknown }>('SELECT body FROM findings WHERE organization_id = $1 AND run_id = $2', [org, runId])
      const parse = <T>(v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as T
      const order = new Map(bundle.actions.map((a, i) => [a.action_id, i]))
      const run: VerificationRun = {
        input_digest: String(runRow['input_digest']),
        ruleset_version: String(runRow['ruleset_version']),
        engine_version: String(runRow['engine_version']),
        actions: actions.map((r) => parse<ActionVerification>(r.result)).sort((a, b) => (order.get(a.action_id) ?? 0) - (order.get(b.action_id) ?? 0)),
        findings: sortFindings(findings.map((r) => parse<Finding>(r.body))),
        summary: parse(runRow['summary']),
      }
      cached = { bundle, run, run_created_at: iso(runRow['created_at']) }
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(key, cached)
    }
    const states = await this.db.query<Record<string, unknown>>('SELECT finding_id, status, note, updated_by, updated_at FROM finding_states WHERE organization_id = $1 AND dataset_id = $2', [org, dataset])
    const statuses = new Map(states.map((s) => [String(s['finding_id']), { status: s['status'] as FindingStatus, note: (s['note'] ?? null) as string | null, updated_by: (s['updated_by'] ?? null) as string | null, updated_at: iso(s['updated_at']) }]))
    return { dataset: ds, bundle: cached.bundle, run: cached.run, run_id: runId, run_created_at: cached.run_created_at, statuses }
  }

  async issues(org: string, dataset: string) {
    return loadIssues(this.db, org, dataset)
  }

  async setFindingStatus(org: string, dataset: string, findingId: string, status: FindingStatus, note: string | null, user: string): Promise<void> {
    await this.db.query(
      `INSERT INTO finding_states (organization_id, dataset_id, finding_id, status, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (organization_id, dataset_id, finding_id) DO UPDATE SET status = $4, note = $5, updated_by = $6, updated_at = now()`,
      [org, dataset, findingId, status, note, user])
  }

  async runHistory(org: string, dataset: string) {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT id, input_digest, ruleset_version, engine_version, duration_ms, created_at, created_by, summary FROM verification_runs WHERE organization_id = $1 AND dataset_id = $2 ORDER BY created_at DESC LIMIT 50', [org, dataset])
    return rows.map((r) => ({ id: r['id'], input_digest: r['input_digest'], ruleset_version: r['ruleset_version'], engine_version: r['engine_version'], duration_ms: r['duration_ms'], created_at: iso(r['created_at']), created_by: r['created_by'], summary: r['summary'] }))
  }
}

export const DEFAULT_RULE_IDS = DEFAULT_RULES.map((r) => r.rule_id)

function sortFindings(f: Finding[]): Finding[] {
  const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const
  return f.sort((a, b) => sev[a.severity] - sev[b.severity] || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.finding_id < b.finding_id ? -1 : 1))
}

async function insertRows(db: Db, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const params: unknown[] = []
    const tuples = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}` }).join(', ')})`)
    await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params)
  }
}

function toDataset(r: Record<string, unknown>): DatasetRow {
  return {
    id: String(r['id']),
    organization_id: String(r['organization_id']),
    name: String(r['name']),
    source: r['source'] as DatasetSource,
    source_metadata: (typeof r['source_metadata'] === 'string' ? JSON.parse(r['source_metadata']) : r['source_metadata']) as Record<string, unknown>,
    input_sha256: String(r['input_sha256']),
    records_read: Number(r['records_read']),
    records_accepted: Number(r['records_accepted']),
    records_rejected: Number(r['records_rejected']),
    created_by: (r['created_by'] ?? null) as string | null,
    created_at: iso(r['created_at']),
  }
}
