import { Fragment } from 'react'
import { cx } from '../../ui/primitives'

export interface PathNode {
  id: string
  name: string
}

/**
 * A delegation path, root first, as names with thin separators. Long paths
 * collapse the middle into "+n" so the root principal and the acting agent
 * stay visible. `rootKnown={false}` marks a path whose root principal the
 * engine could not establish (the path then starts at the first delegatee).
 */
export function ChainPath({ path, rootKnown = true, max = 4, nowrap = false, className }: { path: readonly PathNode[]; rootKnown?: boolean; max?: number; nowrap?: boolean; className?: string }) {
  const full = `${rootKnown ? '' : 'No root principal, then '}${path.map((p) => p.name).join(' to ') || 'no principal recorded'}`
  const items: (PathNode | null)[] = path.length <= max ? [...path] : [path[0]!, null, ...path.slice(-(max - 2))]
  const hidden = path.length - (max - 1)
  return (
    <span className={cx('flex min-w-0 items-center gap-x-1 gap-y-0.5 text-[12.5px]', nowrap ? 'overflow-hidden whitespace-nowrap' : 'flex-wrap', className)}>
      <span className="sr-only">{full}</span>
      {!rootKnown ? (
        <span aria-hidden className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-fog-ink" title="The engine could not establish a root principal for this action">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-dashed border-current text-[8px]">?</span>
          no root
        </span>
      ) : null}
      {path.length === 0 ? (
        <span aria-hidden className="italic text-fog-ink">
          no principal recorded
        </span>
      ) : null}
      {items.map((p, i) => (
        <Fragment key={p ? `${p.id}-${i}` : 'gap'}>
          {i > 0 || !rootKnown ? (
            <span aria-hidden className="shrink-0 text-[10px] text-ink-4">
              ›
            </span>
          ) : null}
          {p ? (
            <span aria-hidden title={p.id} className={cx('min-w-0', nowrap ? 'truncate' : '[overflow-wrap:anywhere]', i === 0 && rootKnown ? 'text-ink' : i === items.length - 1 ? 'text-ink' : 'text-ink-2')}>
              {p.name}
            </span>
          ) : (
            <span aria-hidden className="shrink-0 rounded-[3px] border border-[rgb(var(--line-strong)/0.16)] px-1 font-mono text-[10px] text-ink-3" title={`${hidden} more delegation hops`}>
              +{hidden}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  )
}

/** `2026-10-03T13:30:12Z` -> `10-03 13:30`, mono; a missing time is said, not invented. */
export function TimeCell({ ts, seconds = false }: { ts: string | null; seconds?: boolean }) {
  if (!ts) return <span className="font-mono text-[11px] italic text-fog-ink">untimed</span>
  return (
    <time dateTime={ts} className="tnum whitespace-nowrap font-mono text-[11.5px] text-ink-3">
      {ts.slice(5, 10)} <span className="text-ink-2">{ts.slice(11, seconds ? 19 : 16)}</span>
    </time>
  )
}

/** sha256:0123456789abcdef… -> 0123456789ab…cdef01 */
export function shortDigest(d: string | null | undefined, head = 12, tail = 6): string {
  if (!d) return '—'
  const bare = d.replace(/^sha256:/, '')
  return bare.length <= head + tail + 1 ? bare : `${bare.slice(0, head)}…${bare.slice(-tail)}`
}

/** Elapsed time since the first replay step, compact. */
export function offsetText(ms: number | null): string {
  if (ms === null) return ''
  if (ms === 0) return 'T+0'
  const s = ms / 1000
  if (Math.abs(s) < 60) return `T+${s % 1 === 0 ? s : s.toFixed(1)}s`
  const m = s / 60
  if (Math.abs(m) < 60) return `T+${Math.round(m)}m`
  const h = m / 60
  if (Math.abs(h) < 48) return `T+${Math.round(h)}h`
  return `T+${Math.round(h / 24)}d`
}
