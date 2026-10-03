/**
 * REGENT canonical data model.
 *
 * Three structures are kept apart on purpose:
 *   - the DELEGATION CHAIN  (who delegated authority to whom)  -> Delegation
 *   - the EXECUTION PATH    (how the action reached the target) -> Action
 *   - the EVIDENCE CHAIN    (which records prove it)           -> EvidenceRef
 *
 * Tools, execution identities, credentials and resources are never principals
 * and never appear as delegation hops.
 */

/** A permission string such as `customer.read`, or a trailing wildcard such as `customer.*`. */
export type Permission = string
/** A scope is a set of permissions. Always held sorted and de-duplicated. */
export type Scope = readonly Permission[]

export type PrincipalType = 'human' | 'agent' | 'sub_agent' | 'workload' | 'service'
export type LifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED' | 'UNKNOWN'
export type ApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'UNKNOWN'
export type AuthorizationDecision = 'ALLOW' | 'DENY' | 'CONDITIONAL' | 'UNKNOWN'
export type CheckResult = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN' | 'SKIPPED'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** An authority-bearing identity. */
export interface Principal {
  principal_id: string
  principal_type: PrincipalType
  display_name: string
  issuer: string | null
  /**
   * Authority configured for the principal before runtime. For a root principal
   * this is the ceiling of everything it can delegate.
   */
  provisioned_scope: Scope | null
  /** Explicitly designated as able to originate a chain. Humans are root-eligible by default. */
  root_eligible: boolean
  created_at: string | null
  /** When the principal stopped being valid. Null means no recorded end. */
  suspended_at: string | null
  revoked_at: string | null
  expires_at: string | null
  /** Recorded status at the time the record was exported. Never used for action-time decisions. */
  recorded_status: LifecycleStatus
  event_id: string | null
}

/** The identity an action actually executes as (a workload/service identity, e.g. a SPIFFE ID). */
export interface ExecutionIdentity {
  execution_identity_id: string
  kind: 'workload' | 'service'
  /** The principal this execution identity is issued to act for. */
  bound_principal_id: string | null
  spiffe_id: string | null
  /** Standing permissions of the workload itself. Kept separate from delegated authority. */
  provisioned_scope: Scope | null
  issued_at: string | null
  revoked_at: string | null
  expires_at: string | null
  recorded_status: LifecycleStatus
  event_id: string | null
}

/** Authentication material metadata. REGENT never stores secret values. */
export interface Credential {
  credential_id: string
  credential_type: 'oauth_access_token' | 'spiffe_svid' | 'api_key' | 'service_credential' | 'other'
  /** Credential binding: the execution identity this credential authenticates. */
  execution_identity_id: string | null
  issued_at: string | null
  expires_at: string | null
  revoked_at: string | null
  recorded_status: LifecycleStatus
  event_id: string | null
}

export interface Tool {
  tool_id: string
  display_name: string
  kind: 'mcp' | 'api' | 'connector' | 'function' | 'service'
  event_id: string | null
}

export interface Resource {
  resource_id: string
  display_name: string
  kind: 'database' | 'file' | 'api' | 'object' | 'application' | 'service'
  event_id: string | null
}

/** An authorization policy recorded by the system under audit (not a REGENT verification rule). */
export interface AuthorizationPolicy {
  policy_id: string
  policy_version: string
  display_name: string
  /** If present, effective scope under this policy can never exceed this ceiling. */
  scope_ceiling: Scope | null
  /** Permissions whose exercise requires approval_state = APPROVED. */
  approval_required_for: Scope
  event_id: string | null
}

export interface Delegation {
  delegation_id: string
  /** The delegation under which the delegator held its own authority. Null for a root hop. */
  parent_delegation_id: string | null
  root_principal_id: string | null
  delegator_principal_id: string | null
  delegatee_principal_id: string | null
  granted_scope: Scope | null
  /** What the delegatee asked for, when recorded. Never itself authority. */
  requested_scope: Scope | null
  /** Additional restrictions written into the delegation, e.g. `region=EU`. Informational. */
  restrictions: readonly string[]
  policy_id: string | null
  policy_version: string | null
  created_at: string | null
  expires_at: string | null
  revoked_at: string | null
  approval_state: ApprovalState
  recorded_status: LifecycleStatus
  event_id: string | null
}

export interface Action {
  action_id: string
  event_id: string
  timestamp: string | null
  /** Declared root principal, if the record carries one. Checked, never trusted. */
  root_principal_id: string | null
  actor_principal_id: string | null
  /** Declared delegator of the actor (legacy `parent_agent`). Checked, never trusted. */
  parent_principal_id: string | null
  /** The delegation under which the actor claims to act. */
  delegation_id: string | null
  parent_event_id: string | null
  execution_identity_id: string | null
  credential_id: string | null
  tool_id: string | null
  resource_id: string | null
  operation: string | null
  parameters: Record<string, unknown> | null
  requested_scope: Scope | null
  exercised_scope: Scope | null
  policy_id: string | null
  policy_version: string | null
  /** The decision the system under audit recorded. REGENT re-derives its own. */
  recorded_decision: AuthorizationDecision | null
  decision_reason: string | null
  /** When the system under audit evaluated its decision. Missing means unknown. */
  authorization_evaluated_at: string | null
  approval_state: ApprovalState
  downstream_result: 'success' | 'failure' | 'partial' | null
}

/** A normalized dataset: what the verifier consumes. */
export interface EvidenceBundle {
  principals: Principal[]
  execution_identities: ExecutionIdentity[]
  credentials: Credential[]
  tools: Tool[]
  resources: Resource[]
  policies: AuthorizationPolicy[]
  delegations: Delegation[]
  actions: Action[]
}

// ---------------------------------------------------------------------------
// Verification output
// ---------------------------------------------------------------------------

export type FindingType =
  | 'AUTHORITY_AMPLIFICATION'
  | 'SCOPE_VIOLATION'
  | 'UNATTRIBUTABLE_ACTION'
  | 'BROKEN_DELEGATION_CHAIN'
  | 'ORPHANED_PRINCIPAL'
  | 'MISSING_DELEGATED_SCOPE'
  | 'MISSING_REQUESTED_SCOPE'
  | 'MISSING_POLICY_VERSION'
  | 'CREDENTIAL_BINDING_MISMATCH'
  | 'EXECUTION_IDENTITY_MISMATCH'
  | 'STALE_DELEGATION'
  | 'REVOKED_IDENTITY'
  | 'REVOKED_CREDENTIAL'
  | 'MISSING_APPROVAL'
  | 'ACTION_TIME_AUTHORIZATION_FAILURE'
  | 'UNKNOWN_REFERENCE'

export type RuleId =
  | 'AUTH-001' | 'AUTH-002' | 'AUTH-003' | 'AUTH-004' | 'AUTH-005'
  | 'AUTH-006' | 'AUTH-007' | 'AUTH-008' | 'AUTH-009' | 'AUTH-010'

export type FindingStatus = 'OPEN' | 'INVESTIGATING' | 'ACCEPTED' | 'RESOLVED' | 'SUPPRESSED'

export type EvidenceKind =
  | 'action' | 'delegation' | 'principal' | 'execution_identity' | 'credential'
  | 'policy' | 'tool' | 'resource'

/** A pointer into the evidence. `digest` is a content hash of the normalized record. */
export interface EvidenceRef {
  kind: EvidenceKind
  id: string
  event_id: string | null
  digest: string | null
  note: string
}

/** A scope comparison rendered as a diff. */
export interface AuthorityDelta {
  /** What the delegator could legitimately pass on (its effective scope). */
  available: Scope | null
  granted: Scope | null
  requested: Scope | null
  effective: Scope | null
  exercised: Scope | null
  /** Permissions that exceeded what was available, with where they came from. */
  excess: Scope
}

export interface Finding {
  /** Deterministic: the same evidence always produces the same id. */
  finding_id: string
  type: FindingType
  rule_id: RuleId
  title: string
  severity: Severity
  /** One sentence: what is wrong. */
  summary: string
  /** Why it is a security problem, derived from the evidence. */
  root_cause: string
  remediation: string
  action_id: string | null
  delegation_id: string | null
  /** The first hop at which the invariant broke, if the finding is located on an edge. */
  broken_edge: { from: string | null; to: string | null; hop_index: number | null; delegation_id: string | null } | null
  affected_principal_ids: string[]
  affected_resource_ids: string[]
  authority_delta: AuthorityDelta | null
  missing_fields: string[]
  evidence: EvidenceRef[]
  related_event_ids: string[]
  first_seen: string | null
  last_seen: string | null
}

export interface ResolvedHop {
  hop_index: number
  delegation_id: string
  /** How this hop was linked to the next one: by a recorded reference, or by a unique registry lookup. */
  link: 'explicit' | 'lookup'
  delegator_principal_id: string | null
  delegatee_principal_id: string | null
  granted_scope: Scope | null
  /** The delegator's effective scope: what it could legitimately pass on. Null when unknown. */
  available_scope: Scope | null
  /** granted ∩ available ∩ policy ceiling. Null when unknown. */
  effective_scope: Scope | null
  /** granted \ available: authority that appeared from nowhere at this hop. */
  amplified: Scope
  /** Authority amplified at an earlier hop and carried through this one. */
  inherited_amplified: Scope
  /** Scope removed by the governing policy ceiling at this hop. */
  policy_restricted: Scope
  policy_id: string | null
  policy_version: string | null
  approval_state: ApprovalState
  created_at: string | null
  expires_at: string | null
  revoked_at: string | null
  /** Validity of this delegation at the action timestamp. */
  temporal: 'VALID' | 'NOT_YET_VALID' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN'
  result: CheckResult
  reasons: string[]
}

export type ChainBreak =
  | { kind: 'missing_delegation'; delegation_id: string; referenced_by: string }
  | { kind: 'delegatee_mismatch'; delegation_id: string; expected: string | null; recorded: string | null }
  | { kind: 'cycle'; delegation_id: string }
  | { kind: 'too_deep'; depth: number }
  | { kind: 'no_root'; principal_id: string | null; delegation_id: string | null }
  | { kind: 'no_delegation'; principal_id: string | null }
  | { kind: 'ambiguous'; principal_id: string; candidates: string[] }
  | { kind: 'unknown_principal'; principal_id: string; role: 'delegator' | 'delegatee' | 'actor' }
  | { kind: 'root_mismatch'; declared: string; reconstructed: string | null; where: string }
  | { kind: 'parent_mismatch'; declared: string; reconstructed: string | null }

export interface ReconstructedChain {
  action_id: string
  /** Hops ordered from the root outward: hops[0] is the root delegation. */
  hops: ResolvedHop[]
  root_principal_id: string | null
  actor_principal_id: string | null
  /** How the actor's delegation was located. */
  resolution: 'explicit' | 'lookup' | 'direct' | 'none'
  complete: boolean
  breaks: ChainBreak[]
}

export type VerificationDimension =
  | 'attribution'
  | 'chain_completeness'
  | 'authority'
  | 'scope'
  | 'identity'
  | 'credential_binding'
  | 'policy'
  | 'approval'
  | 'temporal'
  | 'evidence'

export interface DimensionCheck {
  dimension: VerificationDimension
  label: string
  result: CheckResult
  detail: string
  rule_ids: RuleId[]
}

export interface ActionVerification {
  action_id: string
  event_id: string
  timestamp: string | null
  chain: ReconstructedChain
  /** Authority available to the actor at the action timestamp. Null when it cannot be established. */
  effective_scope: Scope | null
  exercised_scope: Scope | null
  requested_scope: Scope | null
  /** REGENT's action-time decision, derived from the evidence. */
  derived_decision: AuthorizationDecision
  derived_decision_reasons: string[]
  recorded_decision: AuthorizationDecision | null
  /** Whether the recorded decision matches REGENT's derived one. */
  decision_agreement: 'AGREE' | 'DISAGREE' | 'UNVERIFIABLE'
  /** Whether the action actually ran (allowed, or a downstream result recorded). */
  executed: boolean
  /** Edges of the execution path with their health, for the chain health map. */
  execution_edges: ExecutionEdge[]
  checks: DimensionCheck[]
  finding_ids: string[]
  record_completeness: RecordCompleteness
  /** Worst result across checks, used for chain health colouring. */
  overall: CheckResult
}

export interface ExecutionEdge {
  kind: 'INVOKES' | 'EXECUTES_AS' | 'AUTHENTICATES_WITH' | 'TARGETS' | 'GOVERNED_BY'
  from: string | null
  to: string | null
  result: CheckResult
  reason: string
}

export interface RecordCompleteness {
  schema_id: string
  present: string[]
  missing: string[]
  critical_missing: string[]
  required_count: number
  /** present / required, rounded to whole percent. Formula shown alongside in every UI. */
  percent: number
}

export interface RuleConfig {
  rule_id: RuleId
  title: string
  description: string
  enabled: boolean
  severity: Severity
  remediation: string
  /** Principal types the rule applies to. Empty = all. */
  applies_to: PrincipalType[]
}

export interface RuleSet {
  ruleset_id: string
  version: string
  rules: RuleConfig[]
}

export interface VerificationRun {
  /** sha256 over the normalized bundle and the rule set: identical input, identical run. */
  input_digest: string
  ruleset_version: string
  engine_version: string
  actions: ActionVerification[]
  findings: Finding[]
  summary: RunSummary
}

export interface RunSummary {
  total_actions: number
  attributable_actions: number
  unattributable_actions: number
  unknown_attribution_actions: number
  authority_violations: number
  amplification_events: number
  broken_chains: number
  missing_field_records: number
  /** Actions whose authority checks passed, over actions whose authority could be evaluated. */
  authority_integrity: { passing: number; evaluated: number; unknown: number }
  findings_by_severity: Record<Severity, number>
  findings_by_type: Partial<Record<FindingType, number>>
  decisions: Record<AuthorizationDecision, number>
  chain_health: Record<'verified' | 'incomplete' | 'violated' | 'unknown', number>
}
