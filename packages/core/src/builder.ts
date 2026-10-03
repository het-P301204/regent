/**
 * A small builder for SYNTHETIC evidence. Scenarios, the demo environment,
 * the chain builder and the tests all produce raw input records through it,
 * so every synthetic dataset goes through the same normalization as an import.
 *
 * No real identities, credentials or secrets: every id is invented and every
 * credential is metadata only.
 */

export type RawRecord = Record<string, unknown> & { record_type: string }

export interface DelegateSpec {
  id: string
  from: string
  to: string
  parent?: string | null
  root?: string | null
  granted?: string[] | null
  requested?: string[] | null
  restrictions?: string[]
  at: string
  expires?: string | null
  revoked?: string | null
  policy?: string | null
  version?: string | null
  approval?: string
  event?: string
}

export interface ActSpec {
  event: string
  actor: string | null
  at: string | null
  delegation?: string | null
  root?: string | null
  parent?: string | null
  parentEvent?: string | null
  tool?: string | null
  resource?: string | null
  operation?: string | null
  parameters?: Record<string, unknown> | null
  exec?: string | null
  credential?: string | null
  requested?: string[] | null
  exercised?: string[] | null
  policy?: string | null
  version?: string | null
  decision?: 'ALLOW' | 'DENY' | 'CONDITIONAL' | 'UNKNOWN' | null
  reason?: string | null
  evaluatedAt?: string | null
  approval?: string
  result?: 'success' | 'failure' | 'partial' | null
}

export class EvidenceBuilder {
  readonly records: RawRecord[] = []

  human(id: string, name: string, provisioned: string[] | null, opts: { revoked?: string; created?: string } = {}): this {
    this.records.push({ record_type: 'principal', principal_id: id, principal_type: 'human', display_name: name, issuer: 'https://idp.example.test', provisioned_scope: provisioned, created_at: opts.created ?? '2026-01-05T09:00:00Z', revoked_at: opts.revoked ?? null, status: opts.revoked ? 'REVOKED' : 'ACTIVE' })
    return this
  }

  agent(id: string, name: string, type: 'agent' | 'sub_agent' = 'agent', opts: { revoked?: string; created?: string; root?: boolean } = {}): this {
    this.records.push({ record_type: 'principal', principal_id: id, principal_type: type, display_name: name, issuer: 'https://agents.example.test', provisioned_scope: null, root_eligible: opts.root ?? false, created_at: opts.created ?? '2026-06-01T00:00:00Z', revoked_at: opts.revoked ?? null, status: opts.revoked ? 'REVOKED' : 'ACTIVE' })
    return this
  }

  workload(id: string, boundTo: string | null, opts: { provisioned?: string[]; revoked?: string; issued?: string } = {}): this {
    this.records.push({ record_type: 'execution_identity', execution_identity_id: id, kind: 'workload', bound_principal_id: boundTo, spiffe_id: `spiffe://acme.example.test/workload/${id}`, provisioned_scope: opts.provisioned ?? null, issued_at: opts.issued ?? '2026-06-01T00:00:00Z', revoked_at: opts.revoked ?? null, status: opts.revoked ? 'REVOKED' : 'ACTIVE' })
    return this
  }

  credential(id: string, execId: string | null, opts: { type?: string; issued?: string; expires?: string; revoked?: string } = {}): this {
    this.records.push({ record_type: 'credential', credential_id: id, credential_type: opts.type ?? 'spiffe_svid', execution_identity_id: execId, issued_at: opts.issued ?? '2026-10-03T00:00:00Z', expires_at: opts.expires ?? '2026-10-04T00:00:00Z', revoked_at: opts.revoked ?? null, status: opts.revoked ? 'REVOKED' : 'ACTIVE' })
    return this
  }

  tool(id: string, name: string, kind = 'mcp'): this {
    this.records.push({ record_type: 'tool', tool_id: id, display_name: name, kind })
    return this
  }

  resource(id: string, name: string, kind = 'database'): this {
    this.records.push({ record_type: 'resource', resource_id: id, display_name: name, kind })
    return this
  }

  policy(id: string, version: string, name: string, opts: { ceiling?: string[] | null; approval?: string[] } = {}): this {
    this.records.push({ record_type: 'policy', policy_id: id, policy_version: version, display_name: name, scope_ceiling: opts.ceiling ?? null, approval_required_for: opts.approval ?? [] })
    return this
  }

  delegate(s: DelegateSpec): this {
    this.records.push({
      record_type: 'delegation',
      delegation_id: s.id,
      parent_delegation_id: s.parent ?? null,
      root_principal_id: s.root ?? null,
      delegator_principal_id: s.from,
      delegatee_principal_id: s.to,
      granted_scope: s.granted === undefined ? [] : s.granted,
      requested_scope: s.requested ?? null,
      restrictions: s.restrictions ?? [],
      policy_id: s.policy === undefined ? 'pol-agent-delegation' : s.policy,
      policy_version: s.version === undefined ? '4' : s.version,
      created_at: s.at,
      expires_at: s.expires ?? null,
      revoked_at: s.revoked ?? null,
      approval_state: s.approval ?? 'APPROVED',
      status: s.revoked ? 'REVOKED' : 'ACTIVE',
      event_id: s.event ?? `evt-${s.id}`,
    })
    return this
  }

  act(s: ActSpec): this {
    this.records.push({
      record_type: 'action',
      event_id: s.event,
      timestamp: s.at,
      root_principal_id: s.root ?? null,
      actor_principal_id: s.actor,
      parent_principal_id: s.parent ?? null,
      delegation_id: s.delegation ?? null,
      parent_event_id: s.parentEvent ?? null,
      execution_identity_id: s.exec ?? null,
      credential_id: s.credential ?? null,
      tool_id: s.tool ?? null,
      resource_id: s.resource ?? null,
      operation: s.operation ?? null,
      parameters: s.parameters ?? null,
      requested_scope: s.requested === undefined ? null : s.requested,
      exercised_scope: s.exercised === undefined ? null : s.exercised,
      policy_id: s.policy === undefined ? 'pol-agent-runtime' : s.policy,
      policy_version: s.version === undefined ? '7' : s.version,
      recorded_decision: s.decision === undefined ? 'ALLOW' : s.decision,
      decision_reason: s.reason === undefined ? defaultReason(s.decision) : s.reason,
      authorization_evaluated_at: s.evaluatedAt === undefined ? s.at : s.evaluatedAt,
      approval_state: s.approval ?? 'NOT_REQUIRED',
      downstream_result: s.result === undefined ? 'success' : s.result,
    })
    return this
  }

  revoke(targetType: 'principal' | 'execution_identity' | 'credential' | 'delegation', id: string, at: string, reason?: string): this {
    this.records.push({ record_type: 'revocation', target_type: targetType, target_id: id, timestamp: at, reason: reason ?? null })
    return this
  }

  build(): RawRecord[] {
    return this.records.map((r) => ({ ...r }))
  }
}

function defaultReason(decision: ActSpec['decision']): string {
  if (decision === 'DENY') return 'requested scope not granted'
  return 'requested scope within delegated scope'
}

/** Shared registry for the small scenarios: one human, a few agents, their workloads and the common policies. */
export function baseline(b = new EvidenceBuilder()): EvidenceBuilder {
  return b
    .human('human-alice', 'Alice Romero', ['customer.read', 'customer.write', 'invoice.read', 'invoice.write', 'invoice.approve'])
    .agent('agent-research', 'ResearchAgent')
    .agent('agent-customer', 'CustomerAgent', 'sub_agent')
    .workload('wl-research-01', 'agent-research', { provisioned: ['customer.read'] })
    .workload('wl-customer-02', 'agent-customer', { provisioned: ['customer.read', 'customer.write'] })
    .credential('svid-research-01', 'wl-research-01')
    .credential('svid-customer-02', 'wl-customer-02')
    .tool('tool-customer-search', 'CustomerSearch')
    .tool('tool-customer-update', 'CustomerUpdate')
    .resource('res-customer-db', 'CustomerDB')
    .policy('pol-agent-delegation', '4', 'Agent delegation policy')
    .policy('pol-agent-runtime', '7', 'Agent runtime policy', { approval: ['customer.delete', 'invoice.approve'] })
}
