import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Copy } from 'lucide-react'
import { animate, useInView } from 'motion/react'
import { prefersReducedMotion } from '../lib/prefs'
import { cx } from './primitives'

/** Smoothly counts to a value once it scrolls into view. */
export function Counter({ value, className, format = (n) => String(Math.round(n)) }: { value: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (!inView) return
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    const c = animate(from.current, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(v) })
    from.current = value
    return () => c.stop()
  }, [value, inView])
  return (
    <span ref={ref} className={cx('tnum', className)}>
      {format(shown)}
    </span>
  )
}

export function Sparkline({ values, color = 'rgb(var(--copper))', height = 28, width = 96, label }: { values: number[]; color?: string; height?: number; width?: number; label: string }) {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(values.length - 1) * step} cy={height - 2 - (values[values.length - 1]! / max) * (height - 4)} r="2" fill={color} />
    </svg>
  )
}

/** A compact metric: label, value, optional context line and visual. */
export function Metric({ label, value, sub, tone = 'neutral', visual, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'crimson' | 'sage' | 'amber'; visual?: ReactNode; className?: string }) {
  const toneCls = tone === 'crimson' ? 'text-crimson-ink' : tone === 'sage' ? 'text-sage-ink' : tone === 'amber' ? 'text-amber-ink' : 'text-ink'
  return (
    <div className={cx('flex min-w-0 items-end justify-between gap-3 px-4 py-3.5', className)}>
      <div className="min-w-0">
        <div className="eyebrow truncate">{label}</div>
        <div className={cx('mt-1.5 font-sans text-[24px] font-light leading-none tracking-[-0.02em]', toneCls)}>{value}</div>
        {sub ? <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div> : null}
      </div>
      {visual ? <div className="shrink-0">{visual}</div> : null}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-ink-3 transition-colors hover:bg-s3 hover:text-ink"
      aria-label={done ? 'Copied' : `${label}: ${text}`}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied' : label}
    </button>
  )
}

export function CodeBlock({ value, className, maxHeight = 360 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className={cx('relative rounded border hairline bg-s2', className)}>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton text={text} />
      </div>
      <pre className="overflow-auto p-3 pr-16 font-mono text-[11.5px] leading-relaxed text-ink-2" style={{ maxHeight }}>
        {text}
      </pre>
    </div>
  )
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

export interface Column<T> {
  key: string
  header: ReactNode
  width?: string
  cell: (row: T) => ReactNode
  className?: string
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

/**
 * Accessible data table. Above `virtualizeAt` rows it virtualizes the body so
 * thousands of events never become thousands of DOM rows.
 */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, caption, virtualizeAt = 120, height = 560, selectedKey, empty }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; caption: string; virtualizeAt?: number; height?: number; selectedKey?: string | null; empty?: ReactNode }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtual = rows.length > virtualizeAt
  // Hidden columns are removed from the grid entirely, so visible cells keep their tracks.
  const width = useViewportWidth()
  const MIN = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const
  columns = columns.filter((c) => !c.hideBelow || width >= MIN[c.hideBelow])
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 12, enabled: virtual, measureElement: (el) => el.getBoundingClientRect().height })
  const grid = columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')
  const hide = (_c: Column<T>) => ''
  const renderRow = (r: T, i: number, style?: React.CSSProperties) => {
    const k = rowKey(r)
    return (
      <div
        key={k}
        data-index={i}
        ref={virtual ? v.measureElement : undefined}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={selectedKey === k || undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onClick={onRowClick ? () => onRowClick(r) : undefined}
        onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
        style={{ ...style, gridTemplateColumns: grid }}
        className={cx('grid min-h-[44px] items-center gap-3 border-b hairline px-4 text-[12.5px] transition-colors', onRowClick && 'cursor-pointer hover:bg-s2 focus-visible:bg-s2', selectedKey === k && 'bg-copper/[0.07]')}
      >
        {columns.map((c) => (
          <div key={c.key} role="cell" className={cx('min-w-0', hide(c), c.className)}>
            {c.cell(r)}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div role="table" aria-label={caption} aria-rowcount={rows.length + 1} className="min-w-0">
      <div role="rowgroup">
        <div role="row" className="grid items-center gap-3 border-b hairline-strong px-4 py-2" style={{ gridTemplateColumns: grid }}>
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={cx('eyebrow truncate', hide(c), c.className)}>
              {c.header}
            </div>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div role="rowgroup">{empty}</div>
      ) : virtual ? (
        <div ref={parentRef} role="rowgroup" className="overflow-y-auto" style={{ height }}>
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((item) => renderRow(rows[item.index]!, item.index, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }))}
          </div>
        </div>
      ) : (
        <div role="rowgroup">{rows.map((r, i) => renderRow(r, i))}</div>
      )}
    </div>
  )
}
