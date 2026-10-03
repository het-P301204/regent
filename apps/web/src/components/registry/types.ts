/**
 * Response shapes for the registry endpoints (identities, delegations,
 * credentials, rules, policies). Types only: every field is produced by the
 * API from the engine's output.
 */
import type { ApprovalState, LifecycleStatus } from '@regent/core'
import type {
  AuthorizationPolicy,
  ChainRow,
  Credential,
  Delegation,
  ExecutionIdentity,
  FindingView,
  Health,
  Principal,
  ResolvedHop,
  Resource,
  Tool,
} from '../../lib/types'

export type { ApprovalState, LifecycleStatus }

export type RegistryPrincipal = Principal & {
  lifecycle: LifecycleStatus
  parents: (string | null)[]
  inbound_delegations: string[]
  execution_identities: string[]
  last_activity: string | null
  finding_count: number
}

export interface IdentitiesResponse {
  as_of: string | null
  principals: RegistryPrincipal[]
  unknown: { principal_id: string; lifecycle: LifecycleStatus }[]
  execution_identities: (ExecutionIdentity & { lifecycle: LifecycleStatus })[]
  credentials: (Credential & { lifecycle: LifecycleStatus })[]
  tools: Tool[]
  resources: Resource[]
}

export interface IdentityDetailResponse {
  principal: Principal | null
  known: boolean
  inbound: Delegation[]
  outbound: Delegation[]
  execution_identities: ExecutionIdentity[]
  actions: ChainRow[]
  findings: FindingView[]
}

export type ContractIntegrity = 'PASS' | 'WARN' | 'VIOLATION' | 'UNVERIFIED'

export type RegistryDelegation = Delegation & {
  delegator_name: string | null
  delegatee_name: string | null
  available_scope: string[] | null
  effective_scope: string[] | null
  amplified: string[]
  used_by: string[]
  finding_ids: string[]
  contract_integrity: ContractIntegrity
}

export interface DelegationsResponse {
  delegations: RegistryDelegation[]
}

export interface DelegationDetailResponse {
  delegation: Delegation
  delegator_name: string | null
  delegatee_name: string | null
  hop: ResolvedHop | null
  policy: AuthorizationPolicy | null
  parent: Delegation | null
  children: Delegation[]
  used_by: ChainRow[]
  findings: FindingView[]
  contract_integrity: ContractIntegrity
}

export type CredentialCondition =
  | 'BINDING_TO_UNKNOWN_IDENTITY'
  | 'NO_BINDING'
  | 'NO_PARENT_LINEAGE'
  | 'USED_OUTSIDE_BINDING'
  | 'REVOKED_CREDENTIAL_USED'
  | 'STALE_CREDENTIAL_USED'

export interface CredentialLineage {
  credential: Credential
  execution_identity: ExecutionIdentity | null
  bound_principal: { id: string; name: string } | null
  lineage: { id: string | null; name: string }[]
  used_by_actors: { id: string; name: string; matches_binding: boolean }[]
  uses: { event_id: string; timestamp: string | null; health: Health }[]
  conditions: CredentialCondition[]
  finding_ids: string[]
}

export interface CredentialsResponse {
  lineage: CredentialLineage[]
  unknown_credentials: string[]
}

export interface PoliciesResponse {
  policies: (AuthorizationPolicy & { decisions: number; delegations: number })[]
  unversioned_decisions: string[]
  completeness_schema: { schema_id: string; fields: { name: string; critical: boolean; why: string }[] }
}
