import { compareStrings, policyKey } from '@regent/core'
import type { Action, EvidenceBundle, IngestIssue } from '@regent/core'
import type { Db } from '../db/driver.ts'

/**
 * Normalized evidence <-> relational tables. Every statement is parameterized
 * and every read filters on organization_id as well as dataset_id, so a
 * dataset id from another tenant returns nothing.
 */

type Row = Record<string, unknown>
const CHUNK = 200

async function insertMany(db: Db, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params: unknown[] = []
    const tuples = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}` }).join(', ')})`)
    // Table and column names are compile-time constants from this module, never input.
    await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params)
  }
}

const arr = (s: readonly string[] | null) => (s === null ? null : [...s])

export async function storeBundle(db: Db, org: string, dataset: string, b: EvidenceBundle, issues: IngestIssue[]): Promise<void> {
  const base = [dataset, org]
  await insertMany(db, 'principals', ['dataset_id', 'organization_id', 'principal_id', 'principal_type', 'display_name', 'issuer', 'provisioned_scope', 'root_eligible', 'created_at', 'suspended_at', 'revoked_at', 'expires_at', 'recorded_status', 'event_id'],
    b.principals.map((p) => [...base, p.principal_id, p.principal_type, p.display_name, p.issuer, arr(p.provisioned_scope), p.root_eligible, p.created_at, p.suspended_at, p.revoked_at, p.expires_at, p.recorded_status, p.event_id]))
  await insertMany(db, 'execution_identities', ['dataset_id', 'organization_id', 'execution_identity_id', 'kind', 'bound_principal_id', 'spiffe_id', 'provisioned_scope', 'issued_at', 'revoked_at', 'expires_at', 'recorded_status', 'event_id'],
    b.execution_identities.map((e) => [...base, e.execution_identity_id, e.kind, e.bound_principal_id, e.spiffe_id, arr(e.provisioned_scope), e.issued_at, e.revoked_at, e.expires_at, e.recorded_status, e.event_id]))
  await insertMany(db, 'credentials', ['dataset_id', 'organization_id', 'credential_id', 'credential_type', 'execution_identity_id', 'issued_at', 'expires_at', 'revoked_at', 'recorded_status', 'event_id'],
    b.credentials.map((c) => [...base, c.credential_id, c.credential_type, c.execution_identity_id, c.issued_at, c.expires_at, c.revoked_at, c.recorded_status, c.event_id]))
  await insertMany(db, 'tools', ['dataset_id', 'organization_id', 'tool_id', 'display_name', 'kind', 'event_id'], b.tools.map((t) => [...base, t.tool_id, t.display_name, t.kind, t.event_id]))
  await insertMany(db, 'resources', ['dataset_id', 'organization_id', 'resource_id', 'display_name', 'kind', 'event_id'], b.resources.map((r) => [...base, r.resource_id, r.display_name, r.kind, r.event_id]))
  await insertMany(db, 'authz_policies', ['dataset_id', 'organization_id', 'policy_id', 'policy_version', 'display_name', 'scope_ceiling', 'approval_required_for', 'event_id'],
    b.policies.map((p) => [...base, p.policy_id, p.policy_version, p.display_name, arr(p.scope_ceiling), [...p.approval_required_for], p.event_id]))
  await insertMany(db, 'delegations', ['dataset_id', 'organization_id', 'delegation_id', 'parent_delegation_id', 'root_principal_id', 'delegator_principal_id', 'delegatee_principal_id', 'granted_scope', 'requested_scope', 'restrictions', 'policy_id', 'policy_version', 'created_at', 'expires_at', 'revoked_at', 'approval_state', 'recorded_status', 'event_id'],
    b.delegations.map((d) => [...base, d.delegation_id, d.parent_delegation_id, d.root_principal_id, d.delegator_principal_id, d.delegatee_principal_id, arr(d.granted_scope), arr(d.requested_scope), [...d.restrictions], d.policy_id, d.policy_version, d.created_at, d.expires_at, d.revoked_at, d.approval_state, d.recorded_status, d.event_id]))
  await insertMany(db, 'actions', ['dataset_id', 'organization_id', 'action_id', 'event_id', 'ts', 'root_principal_id', 'actor_principal_id', 'parent_principal_id', 'delegation_id', 'parent_event_id', 'execution_identity_id', 'credential_id', 'tool_id', 'resource_id', 'operation', 'parameters', 'requested_scope', 'exercised_scope', 'policy_id', 'policy_version', 'recorded_decision', 'decision_reason', 'authorization_evaluated_at', 'approval_state', 'downstream_result'],
    b.actions.map((a) => [...base, a.action_id, a.event_id, a.timestamp, a.root_principal_id, a.actor_principal_id, a.parent_principal_id, a.delegation_id, a.parent_event_id, a.execution_identity_id, a.credential_id, a.tool_id, a.resource_id, a.operation, a.parameters === null ? null : JSON.stringify(a.parameters), arr(a.requested_scope), arr(a.exercised_scope), a.policy_id, a.policy_version, a.recorded_decision, a.decision_reason, a.authorization_evaluated_at, a.approval_state, a.downstream_result]))
  await insertMany(db, 'ingest_issues', ['dataset_id', 'organization_id', 'seq', 'severity', 'code', 'message', 'record_index', 'record_type', 'record_id', 'field'],
    issues.map((i, n) => [...base, n, i.severity, i.code, i.message, i.record_index, i.record_type, i.record_id, i.field]))
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString())
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const scope = (v: unknown): string[] | null => (v === null || v === undefined ? null : (v as string[]).slice())

/** Load a dataset back into the exact normalized form the engine consumes. */
export async function loadBundle(db: Db, org: string, dataset: string): Promise<EvidenceBundle> {
  const q = (table: string) => db.query<Row>(`SELECT * FROM ${table} WHERE organization_id = $1 AND dataset_id = $2`, [org, dataset])
  const [principals, execs, creds, tools, resources, policies, delegations, actions] = await Promise.all([
    q('principals'), q('execution_identities'), q('credentials'), q('tools'), q('resources'), q('authz_policies'), q('delegations'), q('actions'),
  ])
  const by = <T>(list: T[], key: (t: T) => string) => list.sort((a, b) => compareStrings(key(a), key(b)))
  return {
    principals: by(principals.map((r) => ({
      principal_id: String(r['principal_id']), principal_type: r['principal_type'] as never, display_name: String(r['display_name']), issuer: str(r['issuer']),
      provisioned_scope: scope(r['provisioned_scope']), root_eligible: Boolean(r['root_eligible']), created_at: iso(r['created_at']), suspended_at: iso(r['suspended_at']),
      revoked_at: iso(r['revoked_at']), expires_at: iso(r['expires_at']), recorded_status: r['recorded_status'] as never, event_id: str(r['event_id']),
    })), (p) => p.principal_id),
    execution_identities: by(execs.map((r) => ({
      execution_identity_id: String(r['execution_identity_id']), kind: r['kind'] as never, bound_principal_id: str(r['bound_principal_id']), spiffe_id: str(r['spiffe_id']),
      provisioned_scope: scope(r['provisioned_scope']), issued_at: iso(r['issued_at']), revoked_at: iso(r['revoked_at']), expires_at: iso(r['expires_at']),
      recorded_status: r['recorded_status'] as never, event_id: str(r['event_id']),
    })), (e) => e.execution_identity_id),
    credentials: by(creds.map((r) => ({
      credential_id: String(r['credential_id']), credential_type: r['credential_type'] as never, execution_identity_id: str(r['execution_identity_id']),
      issued_at: iso(r['issued_at']), expires_at: iso(r['expires_at']), revoked_at: iso(r['revoked_at']), recorded_status: r['recorded_status'] as never, event_id: str(r['event_id']),
    })), (c) => c.credential_id),
    tools: by(tools.map((r) => ({ tool_id: String(r['tool_id']), display_name: String(r['display_name']), kind: r['kind'] as never, event_id: str(r['event_id']) })), (t) => t.tool_id),
    resources: by(resources.map((r) => ({ resource_id: String(r['resource_id']), display_name: String(r['display_name']), kind: r['kind'] as never, event_id: str(r['event_id']) })), (r) => r.resource_id),
    policies: by(policies.map((r) => ({
      policy_id: String(r['policy_id']), policy_version: String(r['policy_version']), display_name: String(r['display_name']), scope_ceiling: scope(r['scope_ceiling']),
      approval_required_for: scope(r['approval_required_for']) ?? [], event_id: str(r['event_id']),
    })), (p) => policyKey(p.policy_id, p.policy_version)),
    delegations: by(delegations.map((r) => ({
      delegation_id: String(r['delegation_id']), parent_delegation_id: str(r['parent_delegation_id']), root_principal_id: str(r['root_principal_id']),
      delegator_principal_id: str(r['delegator_principal_id']), delegatee_principal_id: str(r['delegatee_principal_id']), granted_scope: scope(r['granted_scope']),
      requested_scope: scope(r['requested_scope']), restrictions: scope(r['restrictions']) ?? [], policy_id: str(r['policy_id']), policy_version: str(r['policy_version']),
      created_at: iso(r['created_at']), expires_at: iso(r['expires_at']), revoked_at: iso(r['revoked_at']), approval_state: r['approval_state'] as never,
      recorded_status: r['recorded_status'] as never, event_id: str(r['event_id']),
    })), (d) => d.delegation_id),
    actions: actions.map((r): Action => ({
      action_id: String(r['action_id']), event_id: String(r['event_id']), timestamp: iso(r['ts']), root_principal_id: str(r['root_principal_id']),
      actor_principal_id: str(r['actor_principal_id']), parent_principal_id: str(r['parent_principal_id']), delegation_id: str(r['delegation_id']),
      parent_event_id: str(r['parent_event_id']), execution_identity_id: str(r['execution_identity_id']), credential_id: str(r['credential_id']),
      tool_id: str(r['tool_id']), resource_id: str(r['resource_id']), operation: str(r['operation']),
      parameters: (typeof r['parameters'] === 'string' ? JSON.parse(r['parameters']) : r['parameters'] ?? null) as Record<string, unknown> | null,
      requested_scope: scope(r['requested_scope']), exercised_scope: scope(r['exercised_scope']), policy_id: str(r['policy_id']), policy_version: str(r['policy_version']),
      recorded_decision: (r['recorded_decision'] ?? null) as never, decision_reason: str(r['decision_reason']), authorization_evaluated_at: iso(r['authorization_evaluated_at']),
      approval_state: r['approval_state'] as never, downstream_result: (r['downstream_result'] ?? null) as never,
    })).sort((a, b) => compareStrings(a.timestamp ?? '', b.timestamp ?? '') || compareStrings(a.action_id, b.action_id)),
  }
}

export async function loadIssues(db: Db, org: string, dataset: string): Promise<IngestIssue[]> {
  const rows = await db.query<Row>('SELECT * FROM ingest_issues WHERE organization_id = $1 AND dataset_id = $2 ORDER BY seq', [org, dataset])
  return rows.map((r) => ({
    severity: r['severity'] as never, code: r['code'] as never, message: String(r['message']), record_index: (r['record_index'] ?? null) as number | null,
    record_type: str(r['record_type']), record_id: str(r['record_id']), field: str(r['field']),
  }))
}
