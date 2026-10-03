import { createContext, memo, useContext } from 'react'
import type { CSSProperties } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position } from '@xyflow/react'
import type { EdgeProps, NodeProps } from '@xyflow/react'
import { IconAgent, IconCredential, IconHuman, IconResource, IconSubAgent, IconTool } from '../../brand/icons'
import { cx } from '../../ui/primitives'
import type { Finding } from '../../lib/types'
import { findingTone } from '../lab/findings'
import type { BEdge, BKind, BNode, Flags } from './model'
import { isPrincipal, KIND_LABEL } from './model'

/**
 * Canvas node and edge renderers for the Chain Builder. Colour is state only:
 * copper marks the current selection, crimson marks an element the engine
 * flagged in the last verification, and everything else stays neutral.
 */

export interface CanvasCtx {
  flags: Flags | null
  reduced: boolean
  select: (id: string) => void
}
export const BuilderCtx = createContext<CanvasCtx>({ flags: null, reduced: false, select: () => {} })

export const KIND_ICON: Record<BKind, typeof IconHuman> = {
  human: IconHuman,
  agent: IconAgent,
  sub_agent: IconSubAgent,
  tool: IconTool,
  credential: IconCredential,
  resource: IconResource,
}

const HANDLE: CSSProperties = {
  opacity: 1,
  pointerEvents: 'all',
  width: 10,
  height: 10,
  minWidth: 0,
  minHeight: 0,
  background: 'rgb(var(--s3))',
  border: '1.5px solid rgb(var(--copper) / 0.85)',
  borderRadius: 999,
}

export const NODE_W = 210

/** Crimson only when a flagged finding is a violation; findings about missing evidence stay amber. */
function flagTone(fs: Finding[] | undefined): 'crimson' | 'amber' | null {
  if (!fs || fs.length === 0) return null
  return fs.some((f) => findingTone(f.type) === 'crimson') ? 'crimson' : 'amber'
}

export const BuilderNode = memo(function BuilderNode({ id, data, selected }: NodeProps<BNode>) {
  const { flags } = useContext(BuilderCtx)
  const flagged = flags?.nodes.get(id)
  const tone = flagTone(flagged)
  const Icon = KIND_ICON[data.kind]
  const principal = isPrincipal(data.kind)
  const canReceive = data.kind !== 'human'
  const canSend = data.kind !== 'resource'
  return (
    <div
      className={cx(
        'relative border bg-s1 px-3 py-2.5 transition-[border-color,box-shadow] duration-200',
        principal ? 'rounded-[10px]' : 'rounded-[3px]',
        selected ? 'border-copper shadow-glow' : tone === 'crimson' ? 'border-crimson/70' : tone === 'amber' ? 'border-amber/70' : 'border-[rgb(var(--line-strong)/0.18)] hover:border-[rgb(var(--line-strong)/0.34)]',
      )}
      style={{ width: NODE_W }}
    >
      {canReceive ? (
        <>
          <Handle type="target" position={Position.Top} id="t" style={HANDLE} />
          <Handle type="target" position={Position.Left} id="l" style={HANDLE} />
        </>
      ) : null}
      <div className="flex items-start gap-2.5">
        <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded', principal ? 'bg-copper/12 text-copper-ink' : 'bg-s3 text-ink-2')}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">{KIND_LABEL[data.kind]}</span>
            {flagged ? (
              <span className={cx('inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold tracking-[0.1em]', tone === 'crimson' ? 'text-crimson-ink' : 'text-amber-ink')} title={flagged.map((f) => f.title).join('\n')}>
                <span aria-hidden>{tone === 'crimson' ? '✕' : '!'}</span>
                {flagged.length > 1 ? `${flagged.length} FINDINGS` : 'FLAGGED'}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[13px] font-medium text-ink" title={data.kind === 'credential' ? data.ref : data.name}>
            {data.kind === 'credential' ? data.ref || 'credential' : data.name || 'Unnamed'}
          </div>
          {principal ? (
            <div className="truncate font-mono text-[10.5px] text-ink-3" title={data.ref}>
              {data.ref}
            </div>
          ) : data.kind === 'credential' ? (
            <div className="truncate font-mono text-[10.5px] text-ink-3">{data.binding === 'execution' ? 'bound to execution identity' : data.binding === 'none' ? 'binding not recorded' : `bound to ${data.bindingOther || '?'}`}</div>
          ) : null}
          {data.kind === 'human' ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {data.scope.length === 0 ? <span className="font-mono text-[10px] text-ink-3">no authority</span> : null}
              {data.scope.slice(0, 3).map((p) => (
                <span key={p} className="rounded-[2px] bg-s3 px-1 font-mono text-[10px] text-ink-2">
                  {p}
                </span>
              ))}
              {data.scope.length > 3 ? <span className="font-mono text-[10px] text-ink-3">+{data.scope.length - 3}</span> : null}
            </div>
          ) : null}
          {data.revoked ? <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-ink-2">REVOKED 09:25</div> : null}
        </div>
      </div>
      {canSend ? (
        <>
          <Handle type="source" position={Position.Bottom} id="b" style={HANDLE} />
          <Handle type="source" position={Position.Right} id="r" style={HANDLE} />
        </>
      ) : null}
    </div>
  )
})

export function BuilderEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<BEdge>) {
  const { flags, reduced, select } = useContext(BuilderCtx)
  const flagged = flags?.edges.get(id)
  const tone = flagTone(flagged)
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 })
  const stroke = tone === 'crimson' ? 'rgb(var(--crimson-ink))' : tone === 'amber' ? 'rgb(var(--amber-ink))' : selected ? 'rgb(var(--copper-ink))' : 'rgb(var(--ink-3))'
  const marker = tone === 'crimson' ? 'url(#bm-arrow-flag)' : tone === 'amber' ? 'url(#bm-arrow-warn)' : selected ? 'url(#bm-arrow-sel)' : 'url(#bm-arrow)'
  let label = ''
  let detail = ''
  if (data?.kind === 'delegation') {
    label = 'DELEGATES'
    detail = data.granted === null ? 'unrecorded' : data.granted.length === 0 ? 'empty' : data.granted.length <= 2 ? data.granted.join(', ') : `${data.granted.length} permissions`
    if (data.revoked) detail += ' · revoked'
    else if (data.expired) detail += ' · expired'
  } else if (data?.kind === 'action') {
    label = 'ACTS'
    detail = data.operation || 'invoke'
    if (data.cached) detail += ' · cached decision'
  } else if (data?.kind === 'link') {
    label = data.rel
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={marker} style={{ stroke, strokeWidth: flagged ? 2.4 : selected ? 2.2 : 1.5, strokeDasharray: data?.kind === 'link' ? '5 4' : undefined }} interactionWidth={20} />
      {tone === 'crimson' && !reduced ? <path d={path} fill="none" stroke="rgb(var(--crimson-ink))" strokeWidth={7} strokeOpacity={0.22} pathLength={1} strokeDasharray="0.08 0.06" style={{ animation: 'rg-flow 1.4s linear infinite' }} className="pointer-events-none" /> : null}
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => select(id)}
          className={cx(
            'nodrag nopan pointer-events-auto absolute flex max-w-[190px] items-center gap-1 rounded-[3px] border px-1.5 py-[1px] font-mono text-[9px] tracking-[0.1em]',
            tone === 'crimson' ? 'border-crimson/70 bg-crimson/20 text-crimson-ink' : tone === 'amber' ? 'border-amber/70 bg-amber/15 text-amber-ink' : selected ? 'border-copper/60 bg-s2 text-copper-ink' : 'border-[rgb(var(--line-strong)/0.16)] bg-s1 text-ink-3 hover:text-ink',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          aria-label={`Select ${label.toLowerCase()} connection${flagged ? ', flagged by the engine' : ''}`}
        >
          {tone ? <span aria-hidden>{tone === 'crimson' ? '✕' : '!'}</span> : null}
          <span>{label}</span>
          {detail ? <span className="truncate normal-case tracking-normal opacity-80">{detail}</span> : null}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

/** Arrowheads, referenced by id from every builder edge. Fill via style so CSS variables resolve. */
export function EdgeMarkers() {
  const m = (id: string, color: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" style={{ fill: color }} />
    </marker>
  )
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {m('bm-arrow', 'rgb(var(--ink-3))')}
        {m('bm-arrow-sel', 'rgb(var(--copper-ink))')}
        {m('bm-arrow-flag', 'rgb(var(--crimson-ink))')}
        {m('bm-arrow-warn', 'rgb(var(--amber-ink))')}
      </defs>
    </svg>
  )
}

export const nodeTypes = { b: BuilderNode }
export const edgeTypes = { b: BuilderEdge }
