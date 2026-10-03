import { formatScope } from './scope.ts'
import type { ActionVerification, EvidenceBundle, Finding, VerificationRun } from './types.ts'

/**
 * "Why did this happen?" — deterministic prose generated from the verification
 * result. The verdict comes from the engine; this module only phrases it. No
 * language model is involved, and nothing here can change a result.
 */

export interface Explanation {
  question: string
  verdict: 'allowed' | 'finding' | 'unverifiable' | 'refused'
  headline: string
  steps: { text: string; tone: 'neutral' | 'pass' | 'warn' | 'fail' }[]
  conclusion: string
  finding_ids: string[]
}

export interface Names {
  principal: (id: string | null | undefined) => string
  tool: (id: string | null | undefined) => string
  resource: (id: string | null | undefined) => string
}

export function namesFor(bundle: EvidenceBundle): Names {
  const p = new Map(bundle.principals.map((x) => [x.principal_id, x.display_name]))
  const t = new Map(bundle.tools.map((x) => [x.tool_id, x.display_name]))
  const r = new Map(bundle.resources.map((x) => [x.resource_id, x.display_name]))
  return {
    principal: (id) => (id ? (p.get(id) ?? id) : 'an unnamed principal'),
    tool: (id) => (id ? (t.get(id) ?? id) : 'an unrecorded tool'),
    resource: (id) => (id ? (r.get(id) ?? id) : 'an unrecorded resource'),
  }
}

export function explainAction(bundle: EvidenceBundle, run: VerificationRun, actionId: string): Explanation | null {
  const v = run.actions.find((a) => a.action_id === actionId || a.event_id === actionId)
  if (!v) return null
  const action = bundle.actions.find((a) => a.action_id === v.action_id)!
  const n = namesFor(bundle)
  const findings = v.finding_ids.map((id) => run.findings.find((f) => f.finding_id === id)).filter((f): f is Finding => f !== undefined)
  const steps: Explanation['steps'] = []

  if (v.chain.root_principal_id === null) {
    steps.push({ text: `No root principal can be established for ${v.event_id}.`, tone: 'fail' })
  } else if (v.chain.hops.length === 0) {
    steps.push({ text: `${n.principal(v.chain.root_principal_id)} acted directly as a root principal, with recorded authority {${formatScope(v.effective_scope)}}.`, tone: 'neutral' })
  }
  for (const h of v.chain.hops) {
    const verb = h.hop_index === 0 ? 'delegated' : 'passed'
    let text = `${n.principal(h.delegator_principal_id)} ${verb} {${formatScope(h.granted_scope)}} to ${n.principal(h.delegatee_principal_id)}`
    if (h.policy_id) text += ` under ${h.policy_id}${h.policy_version ? ` v${h.policy_version}` : ''}`
    text += '.'
    if (h.amplified.length > 0) {
      steps.push({ text: `${text} That includes {${formatScope(h.amplified)}}, which ${n.principal(h.delegator_principal_id)} did not hold.`, tone: 'fail' })
    } else if (h.result === 'FAIL') {
      steps.push({ text: `${text} ${h.reasons.join(' ')}`, tone: 'fail' })
    } else {
      steps.push({ text: `${text}${h.policy_restricted.length ? ` The policy ceiling removed {${formatScope(h.policy_restricted)}}.` : ''}`, tone: h.result === 'PASS' ? 'pass' : 'warn' })
    }
  }
  for (const b of v.chain.breaks) {
    if (b.kind === 'missing_delegation' || b.kind === 'no_root' || b.kind === 'no_delegation' || b.kind === 'ambiguous' || b.kind === 'cycle') {
      steps.push({ text: describe(b, n), tone: 'fail' })
    }
  }
  const actor = n.principal(action.actor_principal_id)
  if (action.requested_scope) steps.push({ text: `${actor} requested {${formatScope(action.requested_scope)}}.`, tone: 'neutral' })
  else steps.push({ text: `The record does not say what scope ${actor} requested.`, tone: 'warn' })
  steps.push({
    text: `${actor} exercised {${formatScope(action.exercised_scope)}} through ${n.tool(action.tool_id)} against ${n.resource(action.resource_id)}${action.execution_identity_id ? `, executing as ${action.execution_identity_id}` : ''}.`,
    tone: 'neutral',
  })
  const scope = v.checks.find((c) => c.dimension === 'scope')!
  if (scope.result === 'PASS') steps.push({ text: `The exercised scope remained within the effective scope {${formatScope(v.effective_scope)}}.`, tone: 'pass' })
  else if (scope.result === 'FAIL') steps.push({ text: scope.detail, tone: 'fail' })
  else steps.push({ text: scope.detail, tone: 'warn' })
  for (const c of v.checks) {
    if (['identity', 'credential_binding', 'temporal', 'approval'].includes(c.dimension) && c.result === 'FAIL') steps.push({ text: c.detail, tone: 'fail' })
  }

  const violating = findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
  let verdict: Explanation['verdict']
  let question: string
  let headline: string
  let conclusion: string
  if (findings.length === 0 && v.derived_decision === 'ALLOW') {
    verdict = 'allowed'
    question = 'Why was this action allowed?'
    headline = `${actor}'s action is attributable to ${n.principal(v.chain.root_principal_id)} and contained in its delegated authority.`
    conclusion = 'No authority amplification was detected, every hop was in force at action time, and the recorded decision matches the evidence.'
  } else if (v.derived_decision === 'UNKNOWN' && violating.every((f) => f.type === 'UNATTRIBUTABLE_ACTION' || f.type === 'ORPHANED_PRINCIPAL' || f.type === 'BROKEN_DELEGATION_CHAIN')) {
    verdict = 'unverifiable'
    question = 'Why can this action not be verified?'
    headline = `REGENT cannot establish who authorized ${v.event_id}.`
    conclusion = 'Missing or contradictory evidence is reported as such. It is not evidence of misuse, and REGENT does not fill the gap with an assumption.'
  } else if (!v.executed && findings.length === 0) {
    verdict = 'refused'
    question = 'Why was this action refused?'
    headline = `The system refused ${v.event_id}, and the evidence supports that.`
    conclusion = v.derived_decision_reasons.join(' ')
  } else {
    verdict = 'finding'
    question = 'Why is this a finding?'
    const top = findings[0]
    headline = top ? top.summary : `${v.event_id} did not satisfy every invariant.`
    conclusion = conclusionFor(findings)
  }
  return { question, verdict, headline, steps, conclusion, finding_ids: findings.map((f) => f.finding_id) }
}

function conclusionFor(findings: Finding[]): string {
  const types = new Set(findings.map((f) => f.type))
  const parts: string[] = []
  if (types.has('AUTHORITY_AMPLIFICATION')) parts.push('No delegation conveyed all of the authority that was used, so the chain contains an authority amplification event.')
  if (types.has('SCOPE_VIOLATION')) parts.push('The action used authority outside its effective scope.')
  if (types.has('ACTION_TIME_AUTHORIZATION_FAILURE')) parts.push('The decision was made before the authority ended and was never re-evaluated at action time.')
  if (types.has('STALE_DELEGATION')) parts.push('The delegation the action relied on had already ended.')
  if (types.has('REVOKED_IDENTITY') || types.has('REVOKED_CREDENTIAL')) parts.push('An identity or credential the action depended on was not valid when it ran.')
  if (types.has('EXECUTION_IDENTITY_MISMATCH') || types.has('CREDENTIAL_BINDING_MISMATCH')) parts.push('The identity that executed is not the one the delegation chain authorized.')
  if (types.has('MISSING_APPROVAL')) parts.push('A privileged permission was used without the approval its policy requires.')
  if (types.has('UNATTRIBUTABLE_ACTION')) parts.push('The action cannot be traced to a root principal.')
  if (types.has('MISSING_POLICY_VERSION') || types.has('MISSING_REQUESTED_SCOPE')) parts.push('Part of the decision evidence is missing, so the decision cannot be fully reconstructed.')
  if (parts.length === 0) parts.push('See the findings for the specific conditions.')
  return `Therefore: ${parts.join(' ')}`
}

function describe(b: ActionVerification['chain']['breaks'][number], n: Names): string {
  switch (b.kind) {
    case 'missing_delegation':
      return `${b.referenced_by} cites delegation ${b.delegation_id}, which is not in the evidence.`
    case 'no_root':
      return b.principal_id ? `${n.principal(b.principal_id)} delegated authority it was never given: no delegation to it is recorded.` : 'A delegation in the chain names no delegator.'
    case 'no_delegation':
      return b.principal_id ? `${n.principal(b.principal_id)} acted with no recorded delegation.` : 'The action does not name who performed it.'
    case 'ambiguous':
      return `${n.principal(b.principal_id)} holds ${b.candidates.length} delegations and the record does not say which it used.`
    case 'cycle':
      return `Delegation ${b.delegation_id} is part of a cycle.`
    default:
      return ''
  }
}
