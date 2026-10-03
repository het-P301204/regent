import { z } from 'zod'

/**
 * Input schemas for UNTRUSTED evidence. Everything imported is treated as a claim
 * made by the system under audit, never as truth. Shapes are checked here; meaning
 * (does that parent exist? was it valid then?) is checked by the verifier.
 *
 * Legacy field names from the original audit-record draft are accepted as aliases
 * and rewritten to the canonical names during normalization:
 *   delegated_user -> root_principal_id     agent_id      -> actor_principal_id
 *   parent_agent   -> parent_principal_id   tool          -> tool_id
 *   resource       -> resource_id           action        -> operation
 *   decision       -> recorded_decision     delegated_scope (delegation) -> granted_scope
 */

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/
export const MAX_TEXT = 4096
export const MAX_SCOPE_ITEMS = 256
export const MAX_RECORDS = 50_000
export const MAX_PARAMETERS_BYTES = 16_384

const id = z.string().min(1).max(192)
const optId = id.nullable().optional()
const text = z.string().max(MAX_TEXT)
const optText = text.nullable().optional()
const timestamp = z.string().max(64).nullable().optional()
const scope = z.array(z.string().max(256)).max(MAX_SCOPE_ITEMS).nullable().optional()

const lifecycle = z
  .string()
  .max(32)
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'UNKNOWN']))
  .nullable()
  .optional()

const approval = z
  .string()
  .max(32)
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'UNKNOWN']))
  .nullable()
  .optional()

const decision = z
  .string()
  .max(32)
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(['ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN']))
  .nullable()
  .optional()

export const PrincipalInput = z.object({
  record_type: z.literal('principal'),
  principal_id: id,
  principal_type: z.enum(['human', 'agent', 'sub_agent', 'workload', 'service']),
  display_name: optText,
  issuer: optText,
  provisioned_scope: scope,
  root_eligible: z.boolean().nullable().optional(),
  created_at: timestamp,
  suspended_at: timestamp,
  revoked_at: timestamp,
  expires_at: timestamp,
  status: lifecycle,
  event_id: optId,
})

export const ExecutionIdentityInput = z.object({
  record_type: z.literal('execution_identity'),
  execution_identity_id: id,
  kind: z.enum(['workload', 'service']).nullable().optional(),
  bound_principal_id: optId,
  spiffe_id: z.string().max(512).nullable().optional(),
  provisioned_scope: scope,
  issued_at: timestamp,
  revoked_at: timestamp,
  expires_at: timestamp,
  status: lifecycle,
  event_id: optId,
})

export const CredentialInput = z.object({
  record_type: z.literal('credential'),
  credential_id: id,
  credential_type: z
    .enum(['oauth_access_token', 'spiffe_svid', 'api_key', 'service_credential', 'other'])
    .nullable()
    .optional(),
  execution_identity_id: optId,
  issued_at: timestamp,
  expires_at: timestamp,
  revoked_at: timestamp,
  status: lifecycle,
  event_id: optId,
})

export const ToolInput = z.object({
  record_type: z.literal('tool'),
  tool_id: id,
  display_name: optText,
  kind: z.enum(['mcp', 'api', 'connector', 'function', 'service']).nullable().optional(),
  event_id: optId,
})

export const ResourceInput = z.object({
  record_type: z.literal('resource'),
  resource_id: id,
  display_name: optText,
  kind: z.enum(['database', 'file', 'api', 'object', 'application', 'service']).nullable().optional(),
  event_id: optId,
})

export const PolicyInput = z.object({
  record_type: z.literal('policy'),
  policy_id: id,
  policy_version: z.union([z.string().max(64), z.number()]).transform(String),
  display_name: optText,
  scope_ceiling: scope,
  approval_required_for: scope,
  event_id: optId,
})

export const DelegationInput = z.object({
  record_type: z.literal('delegation'),
  delegation_id: id,
  parent_delegation_id: optId,
  root_principal_id: optId,
  delegator_principal_id: optId,
  delegatee_principal_id: optId,
  granted_scope: scope,
  /** legacy alias for granted_scope */
  delegated_scope: scope,
  requested_scope: scope,
  restrictions: z.array(z.string().max(256)).max(64).nullable().optional(),
  policy_id: optId,
  policy_version: z.union([z.string().max(64), z.number()]).transform(String).nullable().optional(),
  created_at: timestamp,
  expires_at: timestamp,
  revoked_at: timestamp,
  approval_state: approval,
  status: lifecycle,
  event_id: optId,
})

export const ActionInput = z.object({
  record_type: z.literal('action'),
  event_id: id,
  action_id: optId,
  timestamp: timestamp,
  root_principal_id: optId,
  delegated_user: optId,
  actor_principal_id: optId,
  agent_id: optId,
  agent_type: z.string().max(64).nullable().optional(),
  parent_principal_id: optId,
  parent_agent: optId,
  delegation_id: optId,
  parent_event_id: optId,
  execution_identity_id: optId,
  credential_id: optId,
  tool_id: optId,
  tool: optId,
  resource_id: optId,
  resource: optId,
  operation: z.string().max(128).nullable().optional(),
  action: z.string().max(128).nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).nullable().optional(),
  requested_scope: scope,
  /** Accepted for compatibility; ignored for authority (see normalize.ts). */
  delegated_scope: scope,
  exercised_scope: scope,
  policy_id: optId,
  policy_version: z.union([z.string().max(64), z.number()]).transform(String).nullable().optional(),
  recorded_decision: decision,
  decision: decision,
  authorization_decision: decision,
  decision_reason: optText,
  authorization_evaluated_at: timestamp,
  approval_state: approval,
  downstream_result: z.enum(['success', 'failure', 'partial']).nullable().optional(),
})

export const RevocationInput = z.object({
  record_type: z.literal('revocation'),
  target_type: z.enum(['principal', 'execution_identity', 'credential', 'delegation']),
  target_id: id,
  timestamp: z.string().max(64),
  reason: optText,
  event_id: optId,
})

export const RecordInput = z.discriminatedUnion('record_type', [
  PrincipalInput,
  ExecutionIdentityInput,
  CredentialInput,
  ToolInput,
  ResourceInput,
  PolicyInput,
  DelegationInput,
  ActionInput,
  RevocationInput,
])

export type RecordInputT = z.infer<typeof RecordInput>
export type ActionInputT = z.infer<typeof ActionInput>
export type DelegationInputT = z.infer<typeof DelegationInput>

/** A bundle groups records by kind. Each array may omit `record_type`. */
export const BundleKeys = {
  principals: 'principal',
  execution_identities: 'execution_identity',
  credentials: 'credential',
  tools: 'tool',
  resources: 'resource',
  policies: 'policy',
  delegations: 'delegation',
  events: 'action',
  actions: 'action',
  revocations: 'revocation',
} as const

/** Machine-readable finding format, version 1. Stable for integration. */
export const FindingExportSchema = z.object({
  schema: z.literal('regent.finding/v1'),
  finding_id: z.string(),
  type: z.string(),
  rule_id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  status: z.enum(['OPEN', 'INVESTIGATING', 'ACCEPTED', 'RESOLVED', 'SUPPRESSED']),
  title: z.string(),
  summary: z.string(),
  root_cause: z.string(),
  remediation: z.string(),
  action_id: z.string().nullable(),
  delegation_id: z.string().nullable(),
  broken_edge: z
    .object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      hop_index: z.number().nullable(),
      delegation_id: z.string().nullable(),
    })
    .nullable(),
  affected_principal_ids: z.array(z.string()),
  affected_resource_ids: z.array(z.string()),
  authority_delta: z
    .object({
      available: z.array(z.string()).nullable(),
      granted: z.array(z.string()).nullable(),
      requested: z.array(z.string()).nullable(),
      effective: z.array(z.string()).nullable(),
      exercised: z.array(z.string()).nullable(),
      excess: z.array(z.string()),
    })
    .nullable(),
  missing_fields: z.array(z.string()),
  evidence: z.array(
    z.object({
      kind: z.string(),
      id: z.string(),
      event_id: z.string().nullable(),
      digest: z.string().nullable(),
      note: z.string(),
    }),
  ),
  related_event_ids: z.array(z.string()),
  first_seen: z.string().nullable(),
  last_seen: z.string().nullable(),
  input_digest: z.string(),
  ruleset_version: z.string(),
  engine_version: z.string(),
})
export type FindingExport = z.infer<typeof FindingExportSchema>
