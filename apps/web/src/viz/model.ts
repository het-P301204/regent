import type { ChainDetail, CheckResult, ExecutionEdge, ResolvedHop } from '../lib/types'

/**
 * Turns an engine verification into display primitives: nodes and edges for
 * the delegation graph, stages for the authority flow. Pure reshaping; every
 * result and every excess list is read from the API response.
 */

export type GraphNodeKind = 'human' | 'agent' | 'sub_agent' | 'unknown' | 'tool' | 'execution' | 'credential' | 'resource' | 'policy'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  sublabel: string
  role: string
  status: CheckResult
  scope?: readonly string[] | null
  excess?: readonly string[]
  meta: [string, string][]
}

export type EdgeKind = 'DELEGATES' | 'INVOKES' | 'EXECUTES_AS' | 'AUTHENTICATES_WITH' | 'TARGETS' | 'GOVERNED_BY'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  result: CheckResult
  reason: string
  hop?: ResolvedHop
  exec?: ExecutionEdge
  broken: boolean
}

export function chainGraph(d: ChainDetail): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const v = d.verification
  const a = d.action
  const pname = (id: string | null) => d.principals.find((p) => p.principal_id === id)?.display_name ?? id ?? 'unknown'
  const ptype = (id: string | null): GraphNodeKind => (d.principals.find((p) => p.principal_id === id)?.principal_type as GraphNodeKind | undefined) ?? 'unknown'
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const firstBreak = v.chain.hops.find((h) => h.result === 'FAIL')
  const execBroken = v.execution_edges.find((e) => e.result === 'FAIL')

  const rootId = v.chain.root_principal_id ?? v.chain.hops[0]?.delegator_principal_id ?? null
  const principalIds: string[] = []
  if (v.chain.hops.length > 0) {
    principalIds.push(v.chain.hops[0]!.delegator_principal_id ?? 'unknown-root')
    for (const h of v.chain.hops) principalIds.push(h.delegatee_principal_id ?? `unknown-${h.hop_index}`)
  } else {
    if (!rootId && a.actor_principal_id) principalIds.push('unknown-root')
    if (a.actor_principal_id) principalIds.push(a.actor_principal_id)
  }
  principalIds.forEach((pid, i) => {
    const hopIn = i > 0 ? v.chain.hops[i - 1] : undefined
    const isRoot = i === 0
    const kind = pid.startsWith('unknown-') ? 'unknown' : ptype(pid)
    const p = d.principals.find((x) => x.principal_id === pid)
    nodes.push({
      id: `p:${pid}`,
      kind,
      label: pid.startsWith('unknown-') ? (isRoot ? 'No root principal' : 'Unknown principal') : pname(pid),
      sublabel: pid.startsWith('unknown-') ? 'not in evidence' : pid,
      role: isRoot ? (v.chain.root_principal_id ? 'Root principal' : 'Unverified origin') : pid === a.actor_principal_id ? 'Actor principal' : 'Delegatee',
      status: pid.startsWith('unknown-') ? 'FAIL' : hopIn ? hopIn.result : v.chain.root_principal_id ? 'PASS' : 'FAIL',
      scope: hopIn ? hopIn.effective_scope : (p?.provisioned_scope ?? null),
      excess: hopIn?.amplified ?? [],
      meta: [
        ['Type', kind.replace('_', '-')],
        ['Issuer', p?.issuer ?? '—'],
        ['Status', p?.recorded_status ?? 'UNKNOWN'],
        ...(hopIn ? ([['Granted', (hopIn.granted_scope ?? ['unknown']).join(', ')], ['Effective', (hopIn.effective_scope ?? ['unknown']).join(', ')], ['Policy', hopIn.policy_id ? `${hopIn.policy_id} v${hopIn.policy_version ?? '?'}` : '—'], ['Delegated', hopIn.created_at ?? '—']] as [string, string][]) : ([['Provisioned', p?.provisioned_scope ? p.provisioned_scope.join(', ') : 'not recorded']] as [string, string][])),
      ],
    })
    if (hopIn) {
      edges.push({ id: `e:hop:${hopIn.hop_index}`, source: `p:${principalIds[i - 1]}`, target: `p:${pid}`, kind: 'DELEGATES', result: hopIn.result, reason: hopIn.reasons.join(' '), hop: hopIn, broken: firstBreak?.hop_index === hopIn.hop_index })
    }
  })
  if (v.chain.hops.length === 0 && principalIds.length === 2) {
    edges.push({ id: 'e:orphan', source: `p:${principalIds[0]}`, target: `p:${principalIds[1]}`, kind: 'DELEGATES', result: 'FAIL', reason: 'No delegation to the actor is recorded.', broken: true })
  }

  const actorNode = `p:${principalIds[principalIds.length - 1] ?? 'unknown-actor'}`
  const ex = (k: ExecutionEdge['kind']) => v.execution_edges.find((e) => e.kind === k)
  if (a.tool_id) {
    nodes.push({ id: 'tool', kind: 'tool', label: d.tool?.display_name ?? a.tool_id, sublabel: a.tool_id, role: 'Tool', status: ex('INVOKES')?.result ?? 'UNKNOWN', scope: a.exercised_scope, excess: [], meta: [['Kind', d.tool?.kind ?? 'unregistered'], ['Operation', a.operation ?? '—'], ['Requested', (a.requested_scope ?? ['not recorded']).join(', ')], ['Exercised', (a.exercised_scope ?? ['not recorded']).join(', ')]] })
    const e = ex('INVOKES')!
    edges.push({ id: 'e:invokes', source: actorNode, target: 'tool', kind: 'INVOKES', result: e.result, reason: e.reason, exec: e, broken: !firstBreak && execBroken?.kind === 'INVOKES' })
  }
  if (a.execution_identity_id) {
    nodes.push({ id: 'exec', kind: 'execution', label: a.execution_identity_id, sublabel: d.execution_identity?.spiffe_id ?? 'execution identity', role: 'Execution identity', status: ex('EXECUTES_AS')?.result ?? 'UNKNOWN', meta: [['Issued to', d.execution_identity?.bound_principal_id ? pname(d.execution_identity.bound_principal_id) : 'not recorded'], ['Standing scope', d.execution_identity?.provisioned_scope?.join(', ') || 'none recorded'], ['Revoked', d.execution_identity?.revoked_at ?? '—']] })
    const e = ex('EXECUTES_AS')!
    edges.push({ id: 'e:executes', source: a.tool_id ? 'tool' : actorNode, target: 'exec', kind: 'EXECUTES_AS', result: e.result, reason: e.reason, exec: e, broken: !firstBreak && execBroken?.kind === 'EXECUTES_AS' })
  }
  if (a.credential_id) {
    const e = ex('AUTHENTICATES_WITH')!
    nodes.push({ id: 'cred', kind: 'credential', label: a.credential_id, sublabel: d.credential?.credential_type?.replace(/_/g, ' ') ?? 'unregistered credential', role: 'Credential', status: e.result, meta: [['Bound to', d.credential?.execution_identity_id ?? 'not recorded'], ['Issued', d.credential?.issued_at ?? '—'], ['Expires', d.credential?.expires_at ?? '—'], ['Revoked', d.credential?.revoked_at ?? '—']] })
    edges.push({ id: 'e:auth', source: a.execution_identity_id ? 'exec' : actorNode, target: 'cred', kind: 'AUTHENTICATES_WITH', result: e.result, reason: e.reason, exec: e, broken: !firstBreak && execBroken?.kind === 'AUTHENTICATES_WITH' })
  }
  if (a.resource_id) {
    const e = ex('TARGETS')!
    nodes.push({ id: 'res', kind: 'resource', label: d.resource?.display_name ?? a.resource_id, sublabel: a.resource_id, role: 'Resource', status: v.checks.find((c) => c.dimension === 'scope')?.result ?? 'UNKNOWN', meta: [['Kind', d.resource?.kind ?? 'unregistered'], ['Operation', a.operation ?? '—'], ['Result', a.downstream_result ?? 'not recorded']] })
    edges.push({ id: 'e:targets', source: a.execution_identity_id ? 'exec' : a.tool_id ? 'tool' : actorNode, target: 'res', kind: 'TARGETS', result: e.result, reason: e.reason, exec: e, broken: false })
  }
  if (a.policy_id) {
    const e = ex('GOVERNED_BY')!
    nodes.push({ id: 'pol', kind: 'policy', label: d.policy?.display_name ?? a.policy_id, sublabel: `${a.policy_id} v${a.policy_version ?? '?'}`, role: 'Policy', status: e.result, meta: [['Version', a.policy_version ?? 'not recorded'], ['Ceiling', d.policy?.scope_ceiling?.join(', ') ?? 'none'], ['Approval for', d.policy?.approval_required_for.join(', ') || 'none'], ['Recorded decision', a.recorded_decision ?? '—']] })
    edges.push({ id: 'e:policy', source: a.tool_id ? 'tool' : actorNode, target: 'pol', kind: 'GOVERNED_BY', result: e.result, reason: e.reason, exec: e, broken: false })
  }
  return { nodes, edges }
}

export interface FlowStage {
  id: string
  label: string
  role: string
  scope: readonly string[] | null
  excess: readonly string[]
  result: CheckResult
}

/** Authority Flow stages: what each principal could legitimately hold, then what the action used. */
export function flowStages(d: ChainDetail): FlowStage[] {
  const v = d.verification
  const pname = (id: string | null) => d.principals.find((p) => p.principal_id === id)?.display_name ?? id ?? 'Unknown'
  const stages: FlowStage[] = []
  const first = v.chain.hops[0]
  if (first) {
    stages.push({ id: 'root', label: pname(first.delegator_principal_id), role: v.chain.root_principal_id ? 'Human principal' : 'Unverified origin', scope: first.available_scope ?? first.granted_scope, excess: [], result: v.chain.root_principal_id ? 'PASS' : 'FAIL' })
  } else if (v.chain.root_principal_id) {
    stages.push({ id: 'root', label: pname(v.chain.root_principal_id), role: 'Human principal', scope: v.effective_scope, excess: [], result: 'PASS' })
  }
  for (const h of v.chain.hops) {
    stages.push({ id: `hop-${h.hop_index}`, label: pname(h.delegatee_principal_id), role: h.hop_index === 0 ? 'Agent' : 'Sub-agent', scope: h.effective_scope, excess: h.amplified, result: h.result })
  }
  const amp = d.findings.find((f) => (f.type === 'AUTHORITY_AMPLIFICATION' || f.type === 'SCOPE_VIOLATION') && f.action_id === v.action_id)
  const excess = amp?.authority_delta?.excess ?? []
  const exercised = v.exercised_scope
  stages.push({ id: 'action', label: d.tool?.display_name ?? d.action.tool_id ?? 'Action', role: 'Exercised', scope: exercised ? exercised.filter((p) => !excess.includes(p)) : null, excess, result: v.checks.find((c) => c.dimension === 'scope')?.result ?? 'UNKNOWN' })
  return stages
}
