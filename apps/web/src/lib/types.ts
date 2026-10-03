/**
 * Types only. The console imports the engine's TYPES so it renders exactly what
 * the API returns; it never imports engine functions. Every verdict shown in
 * the UI is computed server-side.
 */
import type {
  Action,
  ActionVerification,
  AuthorizationPolicy,
  CheckResult,
  Credential,
  Delegation,
  ExecutionIdentity,
  Explanation,
  Finding,
  FindingStatus,
  Principal,
  Replay,
  Resource,
  Severity,
  Tool,
} from '@regent/core'

export type {
  Action,
  ActionVerification,
  AuthorizationDecision,
  AuthorizationPolicy,
  CheckResult,
  Credential,
  Delegation,
  DimensionCheck,
  EvidenceRef,
  ExecutionEdge,
  ExecutionIdentity,
  Finding,
  FindingStatus,
  FindingType,
  Principal,
  PrincipalType,
  ResolvedHop,
  Resource,
  RuleConfig,
  RuleSet,
  RunSummary,
  Scope,
  Severity,
  Tool,
  VerificationRun,
  Explanation,
  Replay,
  ReplayStep,
  Scenario,
  ChainSpec,
  DiffEntry,
  ControlEvaluation,
  IngestIssue,
  AuthorityAtTime,
  Investigation,
} from '@regent/core'

export type Health = 'verified' | 'incomplete' | 'violated' | 'unknown'
export type Decision = 'ALLOW' | 'DENY' | 'CONDITIONAL' | 'UNKNOWN'
export type Role = 'viewer' | 'auditor' | 'analyst' | 'admin'

export interface ChainRow {
  action_id: string
  event_id: string
  timestamp: string | null
  root_principal_id: string | null
  root_name: string | null
  actor_principal_id: string | null
  actor_name: string | null
  path: { id: string; name: string }[]
  hop_count: number
  tool_id: string | null
  tool_name: string | null
  resource_id: string | null
  resource_name: string | null
  operation: string | null
  exercised_scope: string[] | null
  effective_scope: string[] | null
  derived_decision: Decision
  recorded_decision: Decision | null
  decision_agreement: 'AGREE' | 'DISAGREE' | 'UNVERIFIABLE'
  health: Health
  overall: CheckResult
  checks: Record<string, CheckResult>
  finding_count: number
  worst_severity: Severity | null
  record_completeness: number
}

export type FindingView = Finding & {
  status: FindingStatus
  status_note: string | null
  status_updated_by: string | null
  status_updated_at: string | null
}

export interface DatasetRow {
  id: string
  name: string
  source: 'demo' | 'scenario' | 'import' | 'builder'
  source_metadata: Record<string, unknown>
  input_sha256: string
  records_read: number
  records_accepted: number
  records_rejected: number
  created_by: string | null
  created_at: string
  latest_run?: { id: string; created_at: string; summary: unknown } | null
}

export interface SessionInfo {
  authenticated: boolean
  demo_mode: boolean
  personas?: { email: string; display_name: string; role: Role; title: string }[]
  user?: { id: string; email: string; display_name: string; role: Role; is_demo_persona: boolean }
  organization?: { id: string; name: string }
  csrf_token?: string | null
  active_dataset_id?: string | null
}

export interface ChainDetail {
  row: ChainRow
  action: Action
  verification: ActionVerification
  findings: FindingView[]
  principals: Principal[]
  delegations: Delegation[]
  execution_identity: ExecutionIdentity | null
  credential: Credential | null
  tool: Tool | null
  resource: Resource | null
  policy: AuthorizationPolicy | null
  explanation: Explanation | null
  replay: Replay | null
}
