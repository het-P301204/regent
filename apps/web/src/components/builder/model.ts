import type { Edge, Node } from '@xyflow/react'
import type { ChainSpec, Finding, VerificationRun } from '../../lib/types'

/**
 * Chain Builder model. The canvas is a drawing; the ChainSpec compiled from it
 * is what the engine verifies. This module only translates between the two
 * and maps engine-reported ids back onto canvas elements. It never decides
 * whether a chain is valid.
 */

export type PrincipalKind = 'human' | 'agent' | 'sub_agent'
export type BKind = PrincipalKind | 'tool' | 'credential' | 'resource'
export type Approval = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'UNKNOWN'
export const APPROVALS: Approval[] = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'UNKNOWN']

export type BNodeData = {
  kind: BKind
  /** Principal / tool / resource display name. */
  name: string
  /** Principal id or credential id. Unused for tools and resources. */
  ref: string
  /** A human's authority. */
  scope: string[]
  /** Principal or credential revoked (synthetic time: 09:25, before the first action). */
  revoked: boolean
  /** Credential binding to the action's execution identity. */
  binding: 'execution' | 'none' | 'other'
  bindingOther: string
}

export type DelegationData = {
  kind: 'delegation'
  granted: string[] | null
  expired: boolean
  revoked: boolean
  approval: Approval
  policyRecorded: boolean
  citeParent: boolean
}

export type ActionData = {
  kind: 'action'
  operation: string
  requested: string[] | null
  exercised: string[] | null
  /** Execution identity id; blank uses a generated one. */
  execId: string
  /** 'actor' (default), 'none' (no binding recorded) or a canvas node id of another principal. */
  execBoundTo: string
  standing: string[]
  execRevoked: boolean
  approval: Approval
  requiresApproval: string[]
  policyRecorded: boolean
  citeDelegation: boolean
  cached: boolean
}

export type LinkData = { kind: 'link'; rel: 'AUTHENTICATES WITH' | 'TARGETS' }

export type BEdgeData = DelegationData | ActionData | LinkData

export type BNode = Node<BNodeData, 'b'>
export type BEdge = Edge<BEdgeData, 'b'>

export const KIND_LABEL: Record<BKind, string> = {
  human: 'Human principal',
  agent: 'Agent',
  sub_agent: 'Sub-agent',
  tool: 'Tool',
  credential: 'Credential',
  resource: 'Resource',
}

export const isPrincipal = (k: BKind): k is PrincipalKind => k === 'human' || k === 'agent' || k === 'sub_agent'

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,95}$/

/** Same slug rule chainspec.ts uses to derive tool, resource and delegation ids. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'x'

// --------------------------------------------------------------- connections

export function connectionKind(s: BKind, t: BKind): BEdgeData['kind'] | null {
  if (isPrincipal(s) && (t === 'agent' || t === 'sub_agent')) return 'delegation'
  if (isPrincipal(s) && t === 'tool') return 'action'
  if (s === 'tool' && (t === 'credential' || t === 'resource')) return 'link'
  if (s === 'credential' && t === 'resource') return 'link'
  return null
}

export function connectionRule(s: BKind, t: BKind): string {
  if (t === 'human') return 'A human principal is a root: nothing delegates to it here.'
  if (isPrincipal(s) && !isPrincipal(t) && t !== 'tool') return 'A principal acts through a tool. Connect it to a tool, then the tool to a credential or resource.'
  if (!isPrincipal(s) && isPrincipal(t)) return 'Tools, credentials and resources are never principals and cannot receive delegated authority.'
  if (s === 'resource') return 'A resource is the end of the execution path.'
  if (s === 'credential' && t !== 'resource') return 'A credential connects onward to a resource only.'
  if (s === 'tool' && t === 'tool') return 'A tool connects to a credential or a resource.'
  return 'That connection has no meaning in a delegation chain.'
}

export function defaultEdgeData(kind: BEdgeData['kind'], source: BNode, target: BNode, nodes: BNode[], edges: BEdge[]): BEdgeData {
  const inheritedFrom = (n: BNode): string[] => {
    if (n.data.kind === 'human') return [...n.data.scope]
    const inbound = edges.find((e) => e.target === n.id && e.data?.kind === 'delegation')
    const g = inbound?.data?.kind === 'delegation' ? inbound.data.granted : null
    return g ? [...g] : []
  }
  if (kind === 'delegation') return { kind, granted: inheritedFrom(source), expired: false, revoked: false, approval: 'APPROVED', policyRecorded: true, citeParent: true }
  if (kind === 'action') {
    const held = inheritedFrom(source)
    return { kind, operation: 'read', requested: held.slice(0, 1), exercised: held.slice(0, 1), execId: '', execBoundTo: 'actor', standing: [], execRevoked: false, approval: 'NOT_REQUIRED', requiresApproval: [], policyRecorded: true, citeDelegation: true, cached: false }
  }
  void nodes
  return { kind: 'link', rel: target.data.kind === 'resource' ? 'TARGETS' : 'AUTHENTICATES WITH' }
}

/** Pick handles so an edge leaves and enters on the sides facing each other. */
export function handlesFor(source: BNode, target: BNode): { sourceHandle: string; targetHandle: string } {
  const dx = target.position.x - source.position.x
  const dy = target.position.y - source.position.y
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? { sourceHandle: 'r', targetHandle: 'l' } : { sourceHandle: 'b', targetHandle: 't' }
}

// ----------------------------------------------------------------- new nodes

let seq = 0
export const newId = (p: string) => `${p}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function newNode(kind: BKind, position: { x: number; y: number }, nodes: BNode[]): BNode {
  const count = nodes.filter((n) => n.data.kind === kind).length + 1
  const taken = new Set(nodes.map((n) => n.data.ref))
  const uniq = (base: string) => {
    let r = base
    let i = 2
    while (taken.has(r)) r = `${base}-${i++}`
    return r
  }
  const base: Record<BKind, { name: string; ref: string; scope: string[] }> = {
    human: { name: `Human ${count}`, ref: uniq(`human-${count}`), scope: ['customer.read'] },
    agent: { name: `Agent ${count}`, ref: uniq(`agent-${count}`), scope: [] },
    sub_agent: { name: `SubAgent ${count}`, ref: uniq(`sub-agent-${count}`), scope: [] },
    tool: { name: `Tool${count}`, ref: '', scope: [] },
    credential: { name: '', ref: uniq(`cred-${count}`), scope: [] },
    resource: { name: `Resource${count}`, ref: '', scope: [] },
  }
  const b = base[kind]
  return { id: newId('n'), type: 'b', position, data: { kind, name: b.name, ref: b.ref, scope: b.scope, revoked: false, binding: 'execution', bindingOther: '' } }
}

export function nodeTitle(n: BNode): string {
  return n.data.kind === 'credential' ? n.data.ref || 'credential' : n.data.name || KIND_LABEL[n.data.kind]
}

// ------------------------------------------------------------------- compile

export interface CanvasNote {
  level: 'warn' | 'info'
  text: string
  target?: string
}

/** Engine ids produced by the spec, mapped back to canvas element ids. */
export interface SpecMap {
  principal: Record<string, string>
  /** `${fromPid}->${toPid}` → edge id */
  delegationPair: Record<string, string>
  /** engine delegation id → edge id */
  delegationId: Record<string, string>
  /** action index → action edge id */
  action: string[]
  /** engine tool id → action edge ids */
  tool: Record<string, string[]>
  /** execution identity id → action edge ids */
  exec: Record<string, string[]>
  /** credential id → canvas credential node id, or action edge id when generated */
  credential: Record<string, string>
  /** action index → tool node label */
  toolLabel: string[]
}

export interface Compiled {
  spec: ChainSpec
  notes: CanvasNote[]
  map: SpecMap
}

export function compile(nodes: BNode[], edges: BEdge[], name: string): Compiled {
  const notes: CanvasNote[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const principals = nodes.filter((n) => isPrincipal(n.data.kind))
  const map: SpecMap = { principal: {}, delegationPair: {}, delegationId: {}, action: [], tool: {}, exec: {}, credential: {}, toolLabel: [] }

  const seen = new Set<string>()
  for (const p of principals) {
    const r = p.data.ref.trim()
    if (!ID_RE.test(r)) notes.push({ level: 'warn', text: `${nodeTitle(p)}: id "${r}" may contain only letters, digits and . _ : @ -`, target: p.id })
    if (seen.has(r)) notes.push({ level: 'warn', text: `Two principals share the id "${r}". Give each principal its own id.`, target: p.id })
    seen.add(r)
    map.principal[r] = p.id
  }
  if (principals.length === 0) notes.push({ level: 'warn', text: 'Add at least one principal. A chain starts with a human principal.' })
  else if (!principals.some((p) => p.data.kind === 'human')) notes.push({ level: 'info', text: 'No human principal on the canvas. The engine will report the chain as having no root.' })

  // Delegations in root-first order, so each one can cite the delegation its
  // delegator received (chainspec.ts records the parent from earlier entries).
  const dEdges = edges.filter((e) => e.data?.kind === 'delegation')
  const depth = new Map<string, number>()
  for (const p of principals) if (p.data.kind === 'human') depth.set(p.id, 0)
  for (let pass = 0; pass < principals.length + 1; pass++) {
    for (const e of dEdges) {
      const d = depth.get(e.source)
      if (d !== undefined && (depth.get(e.target) ?? Infinity) > d + 1) depth.set(e.target, d + 1)
    }
  }
  const ordered = [...dEdges].sort((a, b) => (depth.get(a.source) ?? 99) - (depth.get(b.source) ?? 99))
  const delegations: ChainSpec['delegations'] = []
  ordered.forEach((e) => {
    const d = e.data as DelegationData
    const from = byId.get(e.source)!.data.ref.trim()
    const to = byId.get(e.target)!.data.ref.trim()
    const i = delegations.length
    delegations.push({
      from,
      to,
      granted: d.granted,
      ...(d.expired ? { expired: true } : {}),
      ...(d.revoked ? { revoked: true } : {}),
      ...(d.approval !== 'APPROVED' ? { approval: d.approval } : {}),
      ...(d.policyRecorded ? {} : { policy_version: null }),
      ...(d.citeParent ? {} : { cite_parent: false }),
    })
    map.delegationPair[`${from}->${to}`] ??= e.id
    map.delegationId[`del-${String(i + 1).padStart(2, '0')}-${slug(from)}-${slug(to)}`.slice(0, 120)] = e.id
  })

  const actions: ChainSpec['actions'] = []
  for (const e of edges.filter((x) => x.data?.kind === 'action')) {
    const d = e.data as ActionData
    const actor = byId.get(e.source)
    const tool = byId.get(e.target)
    if (!actor || !tool) continue
    const out = (id: string, kind: BKind) => edges.filter((x) => x.source === id && byId.get(x.target)?.data.kind === kind).map((x) => byId.get(x.target)!)
    const cred = out(tool.id, 'credential')[0]
    const resource = (cred ? out(cred.id, 'resource')[0] : undefined) ?? out(tool.id, 'resource')[0]
    if (!resource) {
      notes.push({ level: 'warn', text: `${actor.data.name} → ${tool.data.name}: connect the tool to a resource (directly or through a credential) to include this action.`, target: e.id })
      continue
    }
    const i = actions.length
    const pid = actor.data.ref.trim()
    const execId = d.execId.trim() || `wl-${slug(pid)}-${i + 1}`
    if (!ID_RE.test(execId)) notes.push({ level: 'warn', text: `Execution identity id "${execId}" may contain only letters, digits and . _ : @ -`, target: e.id })
    const boundTo = d.execBoundTo === 'actor' ? pid : d.execBoundTo === 'none' ? null : (byId.get(d.execBoundTo)?.data.ref.trim() ?? pid)
    const credential = cred
      ? {
          id: cred.data.ref.trim(),
          ...(cred.data.binding === 'none' ? { bound_to_execution_identity: null } : cred.data.binding === 'other' ? { bound_to_execution_identity: cred.data.bindingOther.trim() || 'wl-unbound' } : {}),
          ...(cred.data.revoked ? { revoked: true } : {}),
        }
      : undefined
    actions.push({
      actor: pid,
      tool: tool.data.name.trim() || 'Tool',
      resource: resource.data.name.trim() || 'Resource',
      operation: d.operation.trim() || 'invoke',
      requested: d.requested,
      exercised: d.exercised,
      execution_identity: { id: execId, bound_to: boundTo, ...(d.standing.length ? { standing_scope: d.standing } : {}), ...(d.execRevoked ? { revoked: true } : {}) },
      ...(credential ? { credential } : {}),
      ...(d.approval !== 'NOT_REQUIRED' ? { approval: d.approval } : {}),
      ...(d.requiresApproval.length ? { requires_approval: d.requiresApproval } : {}),
      ...(d.policyRecorded ? {} : { policy_version: null }),
      ...(d.citeDelegation ? {} : { cite_delegation: false }),
      ...(d.cached ? { decision_cached_before_revocation: true } : {}),
    })
    map.action[i] = e.id
    map.toolLabel[i] = tool.data.name || 'Tool'
    ;(map.tool[`tool-${slug(tool.data.name.trim() || 'Tool')}`] ??= []).push(e.id)
    ;(map.exec[execId] ??= []).push(e.id)
    if (cred) map.credential[cred.data.ref.trim()] = cred.id
    else map.credential[`cred-${slug(execId)}`] = e.id
  }
  if (principals.length > 0 && actions.length === 0) notes.push({ level: 'info', text: 'No complete action yet. Connect a principal to a tool and the tool to a resource; delegations alone are verified without an action.' })

  const spec: ChainSpec = {
    ...(name.trim() ? { name: name.trim().slice(0, 120) } : {}),
    principals: principals.map((p) => ({
      id: p.data.ref.trim(),
      type: p.data.kind as PrincipalKind,
      name: p.data.name.trim() || p.data.ref.trim() || 'Unnamed',
      ...(p.data.kind === 'human' ? { scope: p.data.scope } : {}),
      ...(p.data.revoked ? { revoked: true } : {}),
    })),
    delegations,
    actions,
  }
  return { spec, notes, map }
}

// --------------------------------------------------------------------- flags

export interface Flags {
  nodes: Map<string, Finding[]>
  edges: Map<string, Finding[]>
}

const push = (m: Map<string, Finding[]>, id: string | undefined, f: Finding) => {
  if (!id) return false
  m.set(id, [...(m.get(id) ?? []), f])
  return true
}

/** Canvas element(s) for one finding, from the ids the engine put in it. */
export function locate(f: Finding, run: VerificationRun, map: SpecMap): { nodes: string[]; edges: string[] } {
  const res = { nodes: [] as string[], edges: [] as string[] }
  const ev = run.actions.find((a) => a.action_id === f.action_id)?.event_id ?? f.action_id ?? ''
  const m = /evt-builder-(\d+)/.exec(ev)
  const actionEdge = m ? map.action[Number(m[1]) - 1] : undefined
  const be = f.broken_edge
  if (be) {
    const from = be.from ?? null
    const to = be.to ?? null
    if (from && to && map.principal[from] && map.principal[to]) {
      const e = map.delegationPair[`${from}->${to}`]
      if (e) res.edges.push(e)
    } else if (from && map.principal[from] && to && map.tool[to]) {
      res.edges.push(actionEdge ?? map.tool[to]![0]!)
    } else if (from && map.tool[from]) {
      res.edges.push(actionEdge ?? map.tool[from]![0]!)
    } else if (to && map.credential[to]) {
      const c = map.credential[to]!
      if (c.startsWith('n-')) res.nodes.push(c)
      else res.edges.push(c)
    } else if (!from && to && map.principal[to]) {
      res.nodes.push(map.principal[to]!)
    }
  }
  if (res.nodes.length === 0 && res.edges.length === 0 && (f.type === 'REVOKED_IDENTITY' || f.type === 'ORPHANED_PRINCIPAL')) {
    const p = f.affected_principal_ids.map((id) => map.principal[id]).find((x) => x !== undefined)
    if (p) res.nodes.push(p)
  }
  if (res.nodes.length === 0 && res.edges.length === 0) {
    if (f.delegation_id && map.delegationId[f.delegation_id]) res.edges.push(map.delegationId[f.delegation_id]!)
    else if (actionEdge) res.edges.push(actionEdge)
  }
  return res
}

export function flagsFor(run: VerificationRun, map: SpecMap): Flags {
  const flags: Flags = { nodes: new Map(), edges: new Map() }
  for (const f of run.findings) {
    const l = locate(f, run, map)
    l.nodes.forEach((id) => push(flags.nodes, id, f))
    l.edges.forEach((id) => push(flags.edges, id, f))
  }
  return flags
}

/** Map an API validation path (e.g. `principals.2.id`) to a canvas element. */
export function elementForPath(path: string, spec: ChainSpec, map: SpecMap): string | undefined {
  const [list, idx] = path.split('.')
  const i = Number(idx)
  if (!Number.isInteger(i)) return undefined
  if (list === 'principals') return map.principal[spec.principals[i]?.id ?? '']
  if (list === 'delegations') {
    const d = spec.delegations[i]
    return d ? map.delegationPair[`${d.from}->${d.to}`] : undefined
  }
  if (list === 'actions') return map.action[i]
  return undefined
}

// ----------------------------------------------------------------- templates

export interface Template {
  id: string
  title: string
  blurb: string
  name: string
  build: () => { nodes: BNode[]; edges: BEdge[] }
}

type Draft = { k: string; kind: BKind; name: string; ref?: string; scope?: string[]; x: number; y: number; revoked?: boolean }
type DraftEdge = { from: string; to: string; data?: Partial<DelegationData> | Partial<ActionData> }

function materialize(drafts: Draft[], links: DraftEdge[]): { nodes: BNode[]; edges: BEdge[] } {
  const ids = new Map<string, string>()
  const nodes: BNode[] = drafts.map((d) => {
    const id = newId('n')
    ids.set(d.k, id)
    return { id, type: 'b', position: { x: d.x, y: d.y }, data: { kind: d.kind, name: d.name, ref: d.ref ?? '', scope: d.scope ?? [], revoked: d.revoked ?? false, binding: 'execution', bindingOther: '' } }
  })
  const edges: BEdge[] = []
  for (const l of links) {
    const s = nodes.find((n) => n.id === ids.get(l.from))!
    const t = nodes.find((n) => n.id === ids.get(l.to))!
    const kind = connectionKind(s.data.kind, t.data.kind)!
    const base = defaultEdgeData(kind, s, t, nodes, edges)
    edges.push({ id: newId('e'), source: s.id, target: t.id, type: 'b', ...handlesFor(s, t), data: { ...base, ...(l.data ?? {}) } as BEdgeData })
  }
  return { nodes, edges }
}

const COL = 0
const SIDE = 300

export const TEMPLATES: Template[] = [
  {
    id: 'valid',
    title: 'Valid narrowing chain',
    blurb: 'Authority narrows at every hop; the sub-agent reads only what it was given.',
    name: 'Valid narrowing chain',
    build: () =>
      materialize(
        [
          { k: 'h', kind: 'human', name: 'Alice', ref: 'human-alice', scope: ['customer.read', 'customer.write'], x: COL, y: 0 },
          { k: 'a', kind: 'agent', name: 'ResearchAgent', ref: 'agent-research', x: COL, y: 140 },
          { k: 's', kind: 'sub_agent', name: 'CustomerAgent', ref: 'agent-customer', x: COL, y: 280 },
          { k: 't', kind: 'tool', name: 'CustomerSearch', x: COL, y: 420 },
          { k: 'c', kind: 'credential', name: '', ref: 'svid-customer-02', x: SIDE, y: 420 },
          { k: 'r', kind: 'resource', name: 'CustomerDB', x: SIDE, y: 560 },
        ],
        [
          { from: 'h', to: 'a', data: { granted: ['customer.read', 'customer.write'] } },
          { from: 'a', to: 's', data: { granted: ['customer.read'] } },
          { from: 's', to: 't', data: { operation: 'read', requested: ['customer.read'], exercised: ['customer.read'] } },
          { from: 't', to: 'c' },
          { from: 'c', to: 'r' },
        ],
      ),
  },
  {
    id: 'amplify',
    title: 'Sub-agent amplifies',
    blurb: 'ResearchAgent passes on write authority it never held, and CustomerAgent uses it.',
    name: 'Sub-agent amplifies',
    build: () =>
      materialize(
        [
          { k: 'h', kind: 'human', name: 'Alice', ref: 'human-alice', scope: ['customer.read'], x: COL, y: 0 },
          { k: 'a', kind: 'agent', name: 'ResearchAgent', ref: 'agent-research', x: COL, y: 140 },
          { k: 's', kind: 'sub_agent', name: 'CustomerAgent', ref: 'agent-customer', x: COL, y: 280 },
          { k: 't', kind: 'tool', name: 'CustomerUpdate', x: COL, y: 420 },
          { k: 'r', kind: 'resource', name: 'CustomerDB', x: SIDE, y: 420 },
        ],
        [
          { from: 'h', to: 'a', data: { granted: ['customer.read'] } },
          { from: 'a', to: 's', data: { granted: ['customer.read', 'customer.write'] } },
          { from: 's', to: 't', data: { operation: 'update', requested: ['customer.read', 'customer.write'], exercised: ['customer.read', 'customer.write'] } },
          { from: 't', to: 'r' },
        ],
      ),
  },
  {
    id: 'deputy',
    title: 'Workload confused deputy',
    blurb: 'Every grant is read-only, but the tool runs as a workload with standing write access.',
    name: 'Workload confused deputy',
    build: () =>
      materialize(
        [
          { k: 'h', kind: 'human', name: 'Alice', ref: 'human-alice', scope: ['customer.read', 'customer.write'], x: COL, y: 0 },
          { k: 'a', kind: 'agent', name: 'ResearchAgent', ref: 'agent-research', x: COL, y: 140 },
          { k: 's', kind: 'sub_agent', name: 'CustomerAgent', ref: 'agent-customer', x: COL, y: 280 },
          { k: 't', kind: 'tool', name: 'CustomerSearch', x: COL, y: 420 },
          { k: 'r', kind: 'resource', name: 'CustomerDB', x: SIDE, y: 420 },
        ],
        [
          { from: 'h', to: 'a', data: { granted: ['customer.read'] } },
          { from: 'a', to: 's', data: { granted: ['customer.read'] } },
          { from: 's', to: 't', data: { operation: 'update', requested: ['customer.read'], exercised: ['customer.read', 'customer.write'], execId: 'workload-042', standing: ['customer.read', 'customer.write'] } },
          { from: 't', to: 'r' },
        ],
      ),
  },
  {
    id: 'cached',
    title: 'Cached decision after revocation',
    blurb: 'The delegation is revoked before the action, but the decision was cached at provisioning.',
    name: 'Cached decision after revocation',
    build: () =>
      materialize(
        [
          { k: 'h', kind: 'human', name: 'Alice', ref: 'human-alice', scope: ['customer.read'], x: COL, y: 0 },
          { k: 'a', kind: 'agent', name: 'ResearchAgent', ref: 'agent-research', x: COL, y: 140 },
          { k: 't', kind: 'tool', name: 'CustomerSearch', x: COL, y: 280 },
          { k: 'r', kind: 'resource', name: 'CustomerDB', x: SIDE, y: 280 },
        ],
        [
          { from: 'h', to: 'a', data: { granted: ['customer.read'], revoked: true } },
          { from: 'a', to: 't', data: { operation: 'read', requested: ['customer.read'], exercised: ['customer.read'], cached: true } },
          { from: 't', to: 'r' },
        ],
      ),
  },
]
