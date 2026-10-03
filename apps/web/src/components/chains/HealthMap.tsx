import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ChainRow, Health } from '../../lib/types'
import { HealthBadge } from '../../ui/status'
import { cx } from '../../ui/primitives'
import { IconHuman } from '../../brand/icons'
import { ChainPath, TimeCell } from './ChainPath'

/**
 * Chain Health Map: every chain in the dataset as one cell, grouped by root
 * principal. Health is the engine's verdict per action; the map only draws it.
 * Cells outside the current filter stay in place, dimmed, so the shape of the
 * dataset never jumps while filtering.
 */

export const HEALTH_ORDER: Health[] = ['violated', 'incomplete', 'unknown', 'verified']

export const HEALTH_GLYPH: Record<Health, string> = { verified: '✓', incomplete: '!', violated: '✕', unknown: '?' }

const CELL: Record<Health, string> = {
  verified: 'border-sage/45 bg-sage/20 text-sage-ink',
  incomplete: 'border-amber/50 bg-amber/20 text-amber-ink',
  violated: 'border-crimson/80 bg-crimson/35 text-crimson-ink',
  unknown: 'border-dashed border-fog/55 bg-fog/10 text-fog-ink',
}

const NO_ROOT = '__no_root__'

interface Group {
  key: string
  label: string
  rows: ChainRow[]
}

export function HealthMap({ rows, matched, onOpen }: { rows: ChainRow[]; matched: Set<string> | null; onOpen: (r: ChainRow) => void }) {
  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Group>()
    for (const r of rows) {
      const key = r.root_principal_id ?? NO_ROOT
      const g = by.get(key) ?? { key, label: r.root_principal_id ? (r.root_name ?? r.root_principal_id) : 'No root principal established', rows: [] }
      g.rows.push(r)
      by.set(key, g)
    }
    for (const g of by.values()) g.rows.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '') || a.event_id.localeCompare(b.event_id))
    return [...by.values()].sort((a, b) => (a.key === NO_ROOT ? 1 : b.key === NO_ROOT ? -1 : a.label.localeCompare(b.label)))
  }, [rows])

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const counts = useMemo(() => {
    const c: Record<Health, number> = { verified: 0, incomplete: 0, violated: 0, unknown: 0 }
    for (const r of rows) c[r.health]++
    return c
  }, [rows])

  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<ChainRow | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(flat.length - 1, i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = flat.length - 1
    else return
    e.preventDefault()
    setActive(next)
    refs.current[next]?.focus()
  }

  let index = -1
  return (
    <section className="panel min-w-0" aria-labelledby="health-map-title">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b hairline px-4 py-2.5">
        <div className="min-w-0">
          <div className="eyebrow mb-0.5">Chain health map</div>
          <h2 id="health-map-title" className="text-[13px] font-medium text-ink">
            {rows.length} {rows.length === 1 ? 'chain' : 'chains'} by root principal
          </h2>
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Health legend">
          {HEALTH_ORDER.map((h) => (
            <li key={h} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <span aria-hidden className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border text-[8px] font-semibold', CELL[h])}>
                {HEALTH_GLYPH[h]}
              </span>
              <span className="capitalize">{h}</span>
              <span className="tnum font-mono text-ink-3">{counts[h]}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="max-h-[320px] overflow-y-auto px-4 py-3" onMouseLeave={() => setHover(null)}>
        <div role="group" aria-label="Chains grouped by root principal. Use arrow keys to move between chains and Enter to open one." className="flex flex-col gap-2.5">
          {groups.map((g) => (
            <div key={g.key} className="grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-start">
              <div className="flex min-w-0 items-center gap-1.5 pt-px">
                {g.key === NO_ROOT ? (
                  <span aria-hidden className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-dashed border-fog/60 text-[8px] text-fog-ink">
                    ?
                  </span>
                ) : (
                  <IconHuman size={13} className="shrink-0 text-ink-3" />
                )}
                <span className={cx('truncate text-[12px]', g.key === NO_ROOT ? 'italic text-fog-ink' : 'text-ink-2')} title={g.key === NO_ROOT ? undefined : g.key}>
                  {g.label}
                </span>
                <span className="tnum ml-auto shrink-0 font-mono text-[10.5px] text-ink-3 sm:ml-1">{g.rows.length}</span>
              </div>
              <div className="flex min-w-0 flex-wrap gap-[3px]">
                {g.rows.map((r) => {
                  index++
                  const i = index
                  const dim = matched !== null && !matched.has(r.action_id)
                  return (
                    <button
                      key={r.action_id}
                      ref={(el) => {
                        refs.current[i] = el
                      }}
                      type="button"
                      tabIndex={i === Math.min(active, flat.length - 1) ? 0 : -1}
                      aria-label={`${r.event_id}: ${r.health}. ${r.path.map((p) => p.name).join(' to ') || 'no principal recorded'}${dim ? '. Outside current filter' : ''}`}
                      onClick={() => onOpen(r)}
                      onKeyDown={(e) => move(e, i)}
                      onFocus={() => {
                        setActive(i)
                        setHover(r)
                      }}
                      onMouseEnter={() => setHover(r)}
                      className={cx(
                        'inline-flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border font-mono text-[9px] font-semibold leading-none transition-[transform,opacity,box-shadow] duration-150 ease-out hover:scale-[1.18] focus-visible:scale-[1.18]',
                        CELL[r.health],
                        dim && 'opacity-25 hover:opacity-80',
                        hover?.action_id === r.action_id && 'shadow-glow',
                      )}
                    >
                      <span aria-hidden>{HEALTH_GLYPH[r.health]}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-h-[40px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t hairline bg-s2/40 px-4 py-2" aria-live="polite">
        {hover ? (
          <>
            <HealthBadge health={hover.health} className="shrink-0" />
            <span className="id shrink-0">{hover.event_id}</span>
            <TimeCell ts={hover.timestamp} />
            <ChainPath path={hover.path} rootKnown={hover.root_principal_id !== null} max={6} className="min-w-0 flex-1" />
          </>
        ) : (
          <span className="text-[11.5px] text-ink-3">Hover or focus a cell to read its event and delegation path. Select it to open the chain.</span>
        )}
      </div>
    </section>
  )
}
