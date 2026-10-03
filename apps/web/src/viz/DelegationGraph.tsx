import { memo, useMemo } from 'react'
import { Background, Controls, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react'
import { IconAgent, IconCredential, IconExecution, IconHuman, IconPolicy, IconResource, IconSubAgent, IconTool, IconViolation } from '../brand/icons'
import { useReducedMotion } from '../lib/prefs'
import { RESULT_COLOR } from '../ui/status'
import { cx } from '../ui/primitives'
import type { GraphEdge, GraphNode, GraphNodeKind } from './model'

/**
 * The delegation graph. Principals run down the left spine (the delegation
 * chain); the execution path continues below the actor; the credential and
 * the governing policy sit beside the thing they bind. Edges are labelled by
 * relationship, coloured by the engine's result, and the first broken edge is
 * animated so it can be found at a glance.
 */

export type Selection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null

const ICON: Record<GraphNodeKind, typeof IconHuman> = {
  human: IconHuman,
  agent: IconAgent,
  sub_agent: IconSubAgent,
  unknown: IconViolation,
  tool: IconTool,
  execution: IconExecution,
  credential: IconCredential,
  resource: IconResource,
  policy: IconPolicy,
}

const NODE_W = 232

type RNode = Node<{ g: GraphNode; selected: boolean; order: number }, 'regent'>
type REdge = Edge<{ g: GraphEdge; order: number; reduced: boolean }, 'regent'>

const RegentNode = memo(function RegentNode({ data }: NodeProps<RNode>) {
  const g = data.g
  const Icon = ICON[g.kind]
  const principal = g.kind === 'human' || g.kind === 'agent' || g.kind === 'sub_agent' || g.kind === 'unknown'
  const bad = g.status === 'FAIL'
  return (
    <div
      className={cx(
        'group relative rounded-md border bg-s1 px-3 py-2.5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px',
        principal ? 'rounded-[10px]' : 'rounded-[3px]',
        data.selected ? 'border-copper shadow-glow' : bad ? 'border-crimson/60' : 'border-[rgb(var(--line-strong)/0.16)] hover:border-[rgb(var(--line-strong)/0.32)]',
      )}
      style={{ width: NODE_W, animation: `rg-fade-up 420ms cubic-bezier(0.22,1,0.36,1) ${data.order * 90}ms backwards` }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start gap-2.5">
        <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded', principal ? 'bg-copper/12 text-copper-ink' : 'bg-s3 text-ink-2', g.kind === 'unknown' && 'bg-crimson/15 text-crimson-ink')}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">{g.role}</span>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RESULT_COLOR[g.status] }} aria-label={g.status} />
          </div>
          <div className="truncate text-[13px] font-medium text-ink" title={g.label}>
            {g.label}
          </div>
          <div className="truncate font-mono text-[10.5px] text-ink-3" title={g.sublabel}>
            {g.sublabel}
          </div>
          {g.scope !== undefined && principal ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {g.scope === null ? <span className="font-mono text-[10px] italic text-fog-ink">authority unknown</span> : g.scope.slice(0, 3).map((p) => <span key={p} className="rounded-[2px] bg-s3 px-1 font-mono text-[10px] text-ink-2">{p}</span>)}
              {g.scope && g.scope.length > 3 ? <span className="font-mono text-[10px] text-ink-3">+{g.scope.length - 3}</span> : null}
              {(g.excess ?? []).map((p) => (
                <span key={p} className="rounded-[2px] bg-crimson/20 px-1 font-mono text-[10px] text-crimson-ink">+{p}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" id="r" position={Position.Right} />
      <Handle type="target" id="l" position={Position.Left} />
    </div>
  )
})

const LABEL: Record<GraphEdge['kind'], string> = {
  DELEGATES: 'DELEGATES',
  INVOKES: 'INVOKES',
  EXECUTES_AS: 'EXECUTES AS',
  AUTHENTICATES_WITH: 'AUTHENTICATES WITH',
  TARGETS: 'TARGETS',
  GOVERNED_BY: 'GOVERNED BY',
}

function RegentEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<REdge>) {
  const g = data!.g
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
  const color = RESULT_COLOR[g.result]
  const delay = data!.order * 0.12 + 0.15
  return (
    <>
      <path id={id} d={path} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={g.broken ? 2.6 : selected ? 2.4 : 1.6}
        strokeOpacity={g.result === 'SKIPPED' ? 0.4 : 0.95}
        pathLength={1}
        strokeDasharray={g.result === 'UNKNOWN' ? '0.02 0.02' : '1'}
        strokeDashoffset={data!.reduced || g.result === 'UNKNOWN' ? 0 : 1}
        style={data!.reduced || g.result === 'UNKNOWN' ? undefined : { animation: `rg-dash 700ms cubic-bezier(0.22,1,0.36,1) ${delay}s forwards` }}
        className="react-flow__edge-path"
      />
      {g.broken && !data!.reduced ? (
        <path d={path} fill="none" stroke="rgb(var(--crimson-ink))" strokeWidth={6} strokeOpacity={0.25} pathLength={1} strokeDasharray="0.08 0.06" style={{ animation: `rg-flow 1.4s linear infinite, rg-fade-up 400ms ${delay + 0.6}s backwards` }} />
      ) : null}
      <EdgeLabelRenderer>
        <div
          className={cx('nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] font-mono text-[9px] tracking-[0.12em]', g.broken ? 'border-crimson/70 bg-crimson/20 text-crimson-ink' : 'border-[rgb(var(--line-strong)/0.16)] bg-s1 text-ink-3')}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, animation: `rg-fade-up 300ms ${delay + 0.35}s backwards` }}
        >
          {g.broken ? <span aria-hidden>✕</span> : null}
          {LABEL[g.kind]}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { regent: RegentNode }
const edgeTypes = { regent: RegentEdge }

function layout(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  const principals = nodes.filter((n) => n.id.startsWith('p:'))
  const gap = 178
  principals.forEach((n, i) => (pos[n.id] = { x: 0, y: i * gap }))
  let y = principals.length * gap
  for (const id of ['tool', 'exec', 'res']) {
    if (nodes.some((n) => n.id === id)) {
      pos[id] = { x: 0, y }
      y += gap
    }
  }
  if (pos['exec']) pos['cred'] = { x: NODE_W + 150, y: pos['exec'].y }
  else if (nodes.some((n) => n.id === 'cred')) pos['cred'] = { x: NODE_W + 150, y: y - gap }
  if (pos['tool']) pos['pol'] = { x: NODE_W + 150, y: pos['tool'].y - gap * 0.55 }
  else if (nodes.some((n) => n.id === 'pol')) pos['pol'] = { x: NODE_W + 150, y: 0 }
  return pos
}

export function DelegationGraph({ nodes, edges, selection, onSelect, height = 640 }: { nodes: GraphNode[]; edges: GraphEdge[]; selection: Selection; onSelect: (s: Selection) => void; height?: number | string }) {
  const reduced = useReducedMotion()
  const pos = useMemo(() => layout(nodes), [nodes])
  const rNodes: RNode[] = useMemo(
    () => nodes.map((g, i) => ({ id: g.id, type: 'regent', position: pos[g.id] ?? { x: 0, y: 0 }, data: { g, selected: selection?.kind === 'node' && selection.node.id === g.id, order: i }, draggable: false, ariaLabel: `${g.role}: ${g.label}, ${g.status}` })),
    [nodes, pos, selection],
  )
  const rEdges: REdge[] = useMemo(
    () =>
      edges.map((g, i) => {
        const side = g.target === 'cred' || g.target === 'pol'
        return { id: g.id, source: g.source, target: g.target, sourceHandle: side ? 'r' : undefined, targetHandle: side ? 'l' : undefined, type: 'regent', data: { g, order: i, reduced }, selected: selection?.kind === 'edge' && selection.edge.id === g.id, ariaLabel: `${g.kind.replace('_', ' ')} ${g.result}` }
      }),
    [edges, reduced, selection],
  )
  return (
    <div className="rf-regent dotgrid relative w-full overflow-hidden rounded-md border hairline bg-canvas" style={{ height }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rNodes}
          edges={rEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
          minZoom={0.3}
          maxZoom={1.6}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable

          onNodeClick={(_, n) => onSelect({ kind: 'node', node: (n as RNode).data.g })}
          onEdgeClick={(_, e) => onSelect({ kind: 'edge', edge: (e as REdge).data!.g })}
          onPaneClick={() => onSelect(null)}
          aria-label="Delegation graph"
        >
          <Background gap={18} size={0} color="transparent" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
