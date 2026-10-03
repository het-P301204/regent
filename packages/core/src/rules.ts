import type { FindingType, RuleConfig, RuleId, RuleSet, Severity } from './types.ts'

/**
 * REGENT verification rules. These are REGENT's own invariants over the evidence;
 * they are distinct from the authorization policies recorded by the system under
 * audit (AuthorizationPolicy), which REGENT reads but does not own.
 *
 * A disabled rule produces no findings and its checks report SKIPPED. A disabled
 * rule never turns a check into PASS.
 */
export const DEFAULT_RULES: RuleConfig[] = [
  {
    rule_id: 'AUTH-001',
    title: 'Exercised authority must be contained in effective authority',
    description: 'An action may only exercise permissions covered by the effective scope of the principal that performed it: Exercised ⊆ Effective.',
    enabled: true,
    severity: 'critical',
    remediation: 'Enforce the delegated scope at the tool or gateway at action time, and do not let a tool fall back to the standing permissions of its workload identity.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-002',
    title: 'Every delegation must have a recorded delegator chain',
    description: 'Each delegation must name its delegator and, unless the delegator is a root principal, the delegation under which the delegator held its own authority.',
    enabled: true,
    severity: 'high',
    remediation: 'Record parent_delegation_id on every delegation issued by a non-root principal, and reject delegation records whose parent does not exist.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-003',
    title: 'Every action must resolve to a root principal',
    description: 'An action must be traceable through a complete delegation chain to the principal that originated the authority.',
    enabled: true,
    severity: 'high',
    remediation: 'Propagate the root principal and the delegation identifier into every agent and tool call, and log them in the action record.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-004',
    title: 'Sub-agents must receive explicit delegated authority',
    description: 'An agent may only act or delegate under a recorded delegation with an explicit granted scope. Spawning a sub-agent is a delegation event.',
    enabled: true,
    severity: 'high',
    remediation: 'Treat sub-agent creation as a delegation: issue a delegation record with an explicit granted scope before the sub-agent can act.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-005',
    title: 'Authorization must be valid at action time',
    description: 'Every delegation, principal, execution identity and credential an action relies on must be valid at the moment the action executes, and the decision must be evaluated then, not at provisioning.',
    enabled: true,
    severity: 'high',
    remediation: 'Evaluate authorization per action against current delegation and revocation state; do not cache decisions across revocation events.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-006',
    title: 'Execution identity and credential must bind to the acting principal',
    description: 'The execution identity must be issued to the principal recorded as acting, and the credential presented must be bound to that execution identity.',
    enabled: true,
    severity: 'critical',
    remediation: 'Issue one workload identity per agent, bind credentials to it, and reject actions whose credential is bound to a different identity.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-007',
    title: 'Decision evidence must be recorded',
    description: 'Every authorization decision must record the policy version used, and every action must record the scope it requested.',
    enabled: true,
    severity: 'medium',
    remediation: 'Log policy_id, policy_version and requested_scope with every decision.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-008',
    title: 'Privileged actions must record approval',
    description: 'Permissions the governing policy marks as requiring approval may only be exercised with approval_state = APPROVED.',
    enabled: true,
    severity: 'high',
    remediation: 'Gate privileged permissions on a recorded approval and include the approval state in the action record.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-009',
    title: 'Unknown identities cannot receive implicit authority',
    description: 'Every principal, execution identity, credential, tool and resource referenced by the evidence must be known. An unknown reference is never assumed legitimate.',
    enabled: true,
    severity: 'medium',
    remediation: 'Register every principal, workload identity and credential before use, and reject actions referencing unregistered identities.',
    applies_to: [],
  },
  {
    rule_id: 'AUTH-010',
    title: 'Delegation cannot increase authority',
    description: "A delegation may not grant more than the delegator's own effective scope: Granted ⊆ Effective(delegator).",
    enabled: true,
    severity: 'high',
    remediation: "Validate each delegation against the delegator's effective scope when it is issued, and reject grants that exceed it.",
    applies_to: [],
  },
]

export const RULE_FOR_FINDING: Record<FindingType, RuleId> = {
  AUTHORITY_AMPLIFICATION: 'AUTH-001',
  SCOPE_VIOLATION: 'AUTH-001',
  BROKEN_DELEGATION_CHAIN: 'AUTH-002',
  UNATTRIBUTABLE_ACTION: 'AUTH-003',
  ORPHANED_PRINCIPAL: 'AUTH-004',
  MISSING_DELEGATED_SCOPE: 'AUTH-004',
  ACTION_TIME_AUTHORIZATION_FAILURE: 'AUTH-005',
  STALE_DELEGATION: 'AUTH-005',
  REVOKED_IDENTITY: 'AUTH-005',
  REVOKED_CREDENTIAL: 'AUTH-005',
  CREDENTIAL_BINDING_MISMATCH: 'AUTH-006',
  EXECUTION_IDENTITY_MISMATCH: 'AUTH-006',
  MISSING_POLICY_VERSION: 'AUTH-007',
  MISSING_REQUESTED_SCOPE: 'AUTH-007',
  MISSING_APPROVAL: 'AUTH-008',
  UNKNOWN_REFERENCE: 'AUTH-009',
}

/** Short code used in human-facing finding ids, e.g. REG-AMP-3f9a1c20be. */
export const FINDING_CODE: Record<FindingType, string> = {
  AUTHORITY_AMPLIFICATION: 'AMP',
  SCOPE_VIOLATION: 'SCOPE',
  UNATTRIBUTABLE_ACTION: 'ATTR',
  BROKEN_DELEGATION_CHAIN: 'CHAIN',
  ORPHANED_PRINCIPAL: 'ORPHAN',
  MISSING_DELEGATED_SCOPE: 'GRANT',
  MISSING_REQUESTED_SCOPE: 'REQ',
  MISSING_POLICY_VERSION: 'POLV',
  CREDENTIAL_BINDING_MISMATCH: 'CRED',
  EXECUTION_IDENTITY_MISMATCH: 'EXID',
  STALE_DELEGATION: 'STALE',
  REVOKED_IDENTITY: 'REVID',
  REVOKED_CREDENTIAL: 'REVCRED',
  MISSING_APPROVAL: 'APPR',
  ACTION_TIME_AUTHORIZATION_FAILURE: 'ATA',
  UNKNOWN_REFERENCE: 'UNK',
}

export const FINDING_TITLE: Record<FindingType, string> = {
  AUTHORITY_AMPLIFICATION: 'Authority amplification',
  SCOPE_VIOLATION: 'Scope violation',
  UNATTRIBUTABLE_ACTION: 'Unattributable action',
  BROKEN_DELEGATION_CHAIN: 'Broken delegation chain',
  ORPHANED_PRINCIPAL: 'Orphaned principal',
  MISSING_DELEGATED_SCOPE: 'Missing granted scope',
  MISSING_REQUESTED_SCOPE: 'Missing requested scope',
  MISSING_POLICY_VERSION: 'Missing policy version',
  CREDENTIAL_BINDING_MISMATCH: 'Credential binding mismatch',
  EXECUTION_IDENTITY_MISMATCH: 'Execution identity mismatch',
  STALE_DELEGATION: 'Stale delegation',
  REVOKED_IDENTITY: 'Identity not valid at action time',
  REVOKED_CREDENTIAL: 'Credential not valid at action time',
  MISSING_APPROVAL: 'Missing approval',
  ACTION_TIME_AUTHORIZATION_FAILURE: 'Action-time authorization failure',
  UNKNOWN_REFERENCE: 'Unknown identity or reference',
}

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

export const DEFAULT_RULESET: RuleSet = {
  ruleset_id: 'regent-default',
  version: '2026.10.1',
  rules: DEFAULT_RULES,
}

/** Merge partial overrides onto the defaults. Unknown rule ids are ignored. */
export function buildRuleSet(overrides: Partial<Record<RuleId, Partial<Pick<RuleConfig, 'enabled' | 'severity' | 'applies_to' | 'remediation'>>>>, version: string): RuleSet {
  return {
    ruleset_id: 'regent-custom',
    version,
    rules: DEFAULT_RULES.map((r) => {
      const o = overrides[r.rule_id]
      return o ? { ...r, ...o } : r
    }),
  }
}
