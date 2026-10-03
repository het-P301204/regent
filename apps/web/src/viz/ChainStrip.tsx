import { Fragment } from 'react'
import type { GraphEdge, GraphNode } from './model'
import { ResultBadge, RESULT_COLOR } from '../ui/status'
import { cx } from '../ui/primitives'

/**
 * Locate the Broken Edge. The same chain as the graph, as an ordered list:
 * each node, then the edge below it with its result. The first failing edge
 * is marked. Also the accessible, small-screen alternative to the graph.
 */
export function ChainStrip({ nodes, edges, onSelectEdge, onSelectNode, selectedId }: { nodes: GraphNode[]; edges: GraphEdge[]; onSelectEdge?: (e: GraphEdge) => void; onSelectNode?: (n: GraphNode) => void; selectedId?: string | null }) {
  const spine: GraphNode[] = []
  const order: { node: GraphNode; edgeIn?: GraphEdge }[] = []
  // Walk the main path: principals, then tool, execution, resource.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const main = nodes.filter((n) => n.id.startsWith('p:') || ['tool', 'exec', 'res'].includes(n.id))
  main.forEach((n) => spine.push(n))
  spine.forEach((n, i) => order.push({ node: n, edgeIn: i === 0 ? undefined : edges.find((e) => e.target === n.id) }))
  const firstBroken = order.findIndex((o) => o.edgeIn?.result === 'FAIL')
  const side = edges.filter((e) => e.target === 'cred' || e.target === 'pol')
  return (
    <ol className="relative" aria-label="Delegation chain, root to resource">
      {order.map(({ node, edgeIn }, i) => (
        <Fragment key={node.id}>
          {edgeIn ? (
            <li className="flex">
              <button
                type="button"
                onClick={() => onSelectEdge?.(edgeIn)}
                className={cx('group ml-[13px] flex w-full items-center gap-3 border-l-2 py-2 pl-5 text-left transition-colors hover:bg-s2', selectedId === edgeIn.id && 'bg-s2')}
                style={{ borderColor: RESULT_COLOR[edgeIn.result] }}
                aria-label={`${edgeIn.kind.replace('_', ' ')} edge: ${edgeIn.result}. ${edgeIn.reason}`}
              >
                <span className="w-[112px] shrink-0 font-mono text-[10px] tracking-[0.12em] text-ink-3">{edgeIn.kind.replace(/_/g, ' ')}</span>
                <ResultBadge result={edgeIn.result} />
                {i === firstBroken ? <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-crimson-ink">← FIRST BROKEN EDGE</span> : null}
                <span className="hidden min-w-0 flex-1 truncate text-[11.5px] text-ink-3 lg:block">{edgeIn.reason}</span>
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" onClick={() => onSelectNode?.(node)} className={cx('flex w-full items-center gap-3 rounded px-1 py-1.5 text-left hover:bg-s2', selectedId === node.id && 'bg-s2')}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-canvas" style={{ borderColor: RESULT_COLOR[node.status] }} aria-hidden>
                <span className="h-2 w-2 rounded-full" style={{ background: RESULT_COLOR[node.status] }} />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">{node.role}</span>
                <span className="block truncate text-[13px] text-ink">{node.label}</span>
              </span>
            </button>
          </li>
        </Fragment>
      ))}
      {side.map((e) => {
        const n = byId.get(e.target)
        if (!n) return null
        return (
          <li key={e.id} className="mt-2 flex items-center gap-3 border-t hairline pt-2">
            <button type="button" onClick={() => onSelectEdge?.(e)} className="flex w-full items-center gap-3 rounded px-1 py-1 text-left hover:bg-s2">
              <span className="w-[140px] shrink-0 font-mono text-[10px] tracking-[0.12em] text-ink-3">{e.kind.replace(/_/g, ' ')}</span>
              <ResultBadge result={e.result} />
              <span className="min-w-0 truncate text-[12.5px] text-ink">{n.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
