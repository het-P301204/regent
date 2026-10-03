import type { FindingType, RuleId, VerificationDimension, VerificationRun } from './types.ts'

/**
 * Auditor view. Each control is a REGENT verification question phrased as a
 * control statement and evaluated from the same run, never separately. The
 * mapping is REGENT's own; it does not claim compliance with any framework.
 */

export type ControlResult = 'SATISFIED' | 'PARTIALLY_SATISFIED' | 'NOT_SATISFIED' | 'NOT_EVALUATED'

export interface ControlDefinition {
  control_id: string
  title: string
  requirement: string
  dimensions: VerificationDimension[]
  finding_types: FindingType[]
  rule_ids: RuleId[]
  owner: string
}

export interface ControlEvaluation extends ControlDefinition {
  result: ControlResult
  actions_evaluated: number
  actions_passing: number
  actions_unknown: number
  finding_ids: string[]
  evidence_event_ids: string[]
  rationale: string
}

export const CONTROLS: ControlDefinition[] = [
  { control_id: 'RGT-C1', title: 'Agent action attribution', requirement: 'Every agent action can be traced to a root principal through a complete delegation chain.', dimensions: ['attribution', 'chain_completeness'], finding_types: ['UNATTRIBUTABLE_ACTION', 'BROKEN_DELEGATION_CHAIN', 'ORPHANED_PRINCIPAL'], rule_ids: ['AUTH-002', 'AUTH-003', 'AUTH-004'], owner: 'AI Platform' },
  { control_id: 'RGT-C2', title: 'Delegated authority contracts', requirement: 'No delegation grants more than its delegator holds, and no action exercises more than its effective scope.', dimensions: ['authority', 'scope'], finding_types: ['AUTHORITY_AMPLIFICATION', 'SCOPE_VIOLATION'], rule_ids: ['AUTH-001', 'AUTH-010'], owner: 'IAM' },
  { control_id: 'RGT-C3', title: 'Execution identity binding', requirement: 'Actions execute under an identity issued to the acting agent, authenticated by a credential bound to that identity.', dimensions: ['identity', 'credential_binding'], finding_types: ['EXECUTION_IDENTITY_MISMATCH', 'CREDENTIAL_BINDING_MISMATCH', 'UNKNOWN_REFERENCE'], rule_ids: ['AUTH-006', 'AUTH-009'], owner: 'Cloud Security' },
  { control_id: 'RGT-C4', title: 'Action-time authorization', requirement: 'Authorization is evaluated when the action executes, against current delegation and revocation state.', dimensions: ['temporal'], finding_types: ['ACTION_TIME_AUTHORIZATION_FAILURE', 'STALE_DELEGATION', 'REVOKED_IDENTITY', 'REVOKED_CREDENTIAL'], rule_ids: ['AUTH-005'], owner: 'Security Engineering' },
  { control_id: 'RGT-C5', title: 'Policy traceability', requirement: 'Every authorization decision records the exact policy version that made it.', dimensions: ['policy'], finding_types: ['MISSING_POLICY_VERSION'], rule_ids: ['AUTH-007'], owner: 'GRC' },
  { control_id: 'RGT-C6', title: 'Approval for privileged actions', requirement: 'Permissions marked privileged by policy are exercised only with recorded approval.', dimensions: ['approval'], finding_types: ['MISSING_APPROVAL'], rule_ids: ['AUTH-008'], owner: 'GRC' },
  { control_id: 'RGT-C7', title: 'Audit record completeness', requirement: 'Agent action records contain every field needed to reconstruct the decision.', dimensions: ['evidence'], finding_types: ['MISSING_REQUESTED_SCOPE'], rule_ids: ['AUTH-007', 'AUTH-003'], owner: 'Security Operations' },
]

export function evaluateControls(run: VerificationRun): ControlEvaluation[] {
  return CONTROLS.map((c) => {
    let evaluated = 0
    let passing = 0
    let unknown = 0
    let skipped = 0
    const events: string[] = []
    for (const a of run.actions) {
      const results = c.dimensions.map((d) => a.checks.find((x) => x.dimension === d)?.result ?? 'UNKNOWN')
      if (results.every((r) => r === 'SKIPPED')) {
        skipped++
        continue
      }
      events.push(a.event_id)
      if (results.some((r) => r === 'FAIL')) evaluated++
      else if (results.some((r) => r === 'UNKNOWN')) unknown++
      else {
        evaluated++
        passing++
      }
    }
    const findingIds = run.findings.filter((f) => c.finding_types.includes(f.type)).map((f) => f.finding_id)
    let result: ControlResult
    let rationale: string
    const total = run.actions.length
    if (total === 0 || skipped === total) {
      result = 'NOT_EVALUATED'
      rationale = total === 0 ? 'No actions in the dataset.' : `All mapped rules (${c.rule_ids.join(', ')}) are disabled.`
    } else if (evaluated === 0) {
      result = 'NOT_EVALUATED'
      rationale = `None of the ${total} actions carry enough evidence to evaluate this control.`
    } else if (passing === evaluated && unknown === 0 && findingIds.length === 0) {
      result = 'SATISFIED'
      rationale = `All ${evaluated} actions satisfy the control and no related findings are open.`
    } else if (passing === 0) {
      result = 'NOT_SATISFIED'
      rationale = `None of the ${evaluated} evaluable actions satisfy the control.`
    } else {
      result = 'PARTIALLY_SATISFIED'
      rationale = `${passing} of ${evaluated} evaluable actions satisfy the control${unknown ? `; ${unknown} could not be evaluated` : ''}; ${findingIds.length} related finding${findingIds.length === 1 ? '' : 's'}.`
    }
    return { ...c, result, actions_evaluated: evaluated, actions_passing: passing, actions_unknown: unknown, finding_ids: findingIds, evidence_event_ids: events, rationale }
  })
}
