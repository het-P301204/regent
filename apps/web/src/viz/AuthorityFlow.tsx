import { useEffect, useId, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { FlowStage } from './model'
import { useReducedMotion } from '../lib/prefs'
import { cx } from '../ui/primitives'

/**
 * Authority Flow — REGENT's signature visual. Authority is a stream that should
 * only narrow as it passes from principal to principal. Band thickness is the
 * number of permissions held at each stage. Authority that appears from
 * nowhere is drawn as a crimson, hatched swell entering at the exact stage
 * where the engine located it.
 */
export function AuthorityFlow({ stages, height = 230, className, compact = false, onSelect, selected }: { stages: FlowStage[]; height?: number; className?: string; compact?: boolean; onSelect?: (id: string) => void; selected?: string | null }) {
  const uid = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const [hover, setHover] = useState<string | null>(null)
  // Draw in real pixels so labels stay legible at any container width.
  const box = useRef<HTMLElement>(null)
  const [W, setW] = useState(1000)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (stages.length === 0) return null
  const labelH = compact ? 34 : 58
  const H = height
  const plotH = H - labelH
  const mid = plotH / 2 + 6
  const counts = stages.map((s) => (s.scope?.length ?? 0) + s.excess.length)
  const maxCount = Math.max(1, ...counts)
  const unit = Math.min(26, (plotH - 34) / maxCount)
  const minT = 4
  const padX = Math.min(70, W / (stages.length * 2))
  const xs = stages.map((_, i) => (stages.length === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (stages.length - 1)))
  const legitT = stages.map((s) => (s.scope === null ? unit * 1.4 : Math.max(minT, s.scope.length * unit)))
  const exT = stages.map((s) => s.excess.length * unit)
  const colW = 10
  const ribbon = (x0: number, t0a: number, t0b: number, x1: number, t1a: number, t1b: number) => {
    const cx0 = x0 + (x1 - x0) * 0.5
    return `M${x0},${t0a} C${cx0},${t0a} ${cx0},${t1a} ${x1},${t1a} L${x1},${t1b} C${cx0},${t1b} ${cx0},${t0b} ${x0},${t0b} Z`
  }
  const anyExcess = stages.some((s) => s.excess.length > 0)

  return (
    <figure ref={box} className={cx('relative w-full', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Authority flow</title>
        <desc id={`${uid}-d`}>
          {stages.map((s) => `${s.role} ${s.label}: ${s.scope === null ? 'unknown authority' : `${s.scope.length} permission${s.scope.length === 1 ? '' : 's'}`}${s.excess.length ? `, plus ${s.excess.length} not granted (${s.excess.join(', ')})` : ''}`).join('. ')}
        </desc>
        <defs>
          <linearGradient id={`${uid}-g`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgb(var(--copper))" stopOpacity="0.55" />
            <stop offset="1" stopColor="rgb(var(--copper))" stopOpacity="0.28" />
          </linearGradient>
          <pattern id={`${uid}-h`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="7" height="7" fill="rgb(var(--crimson) / 0.22)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="rgb(var(--crimson-ink))" strokeWidth="2.4" />
          </pattern>
          <clipPath id={`${uid}-c`}>
            <motion.rect x="0" y="0" height={H} initial={{ width: reduced ? W : 0 }} animate={{ width: W }} transition={{ duration: reduced ? 0 : 1.15, ease: [0.22, 1, 0.36, 1] }} />
          </clipPath>
        </defs>

        <line x1={xs[0]} x2={xs[xs.length - 1]} y1={mid} y2={mid} stroke="rgb(var(--ink) / 0.08)" strokeDasharray="2 5" />

        <g clipPath={`url(#${uid}-c)`}>
          {stages.slice(0, -1).map((s, i) => {
            const n = stages[i + 1]!
            const a0 = mid - legitT[i]! / 2
            const b0 = mid + legitT[i]! / 2
            const a1 = mid - legitT[i + 1]! / 2
            const b1 = mid + legitT[i + 1]! / 2
            const unknown = s.scope === null || n.scope === null
            return (
              <g key={`r-${s.id}`}>
                <path d={ribbon(xs[i]! + colW / 2, a0, b0, xs[i + 1]! - colW / 2, a1, b1)} fill={unknown ? 'rgb(var(--fog) / 0.12)' : `url(#${uid}-g)`} stroke={unknown ? 'rgb(var(--fog) / 0.6)' : 'none'} strokeDasharray={unknown ? '4 4' : undefined} />
                {n.excess.length > 0 ? (
                  <path d={ribbon(xs[i]! + colW / 2, a0, a0, xs[i + 1]! - colW / 2, a1 - exT[i + 1]!, a1)} fill={`url(#${uid}-h)`} stroke="rgb(var(--crimson-ink))" strokeWidth="1.2" />
                ) : null}
              </g>
            )
          })}
          {stages.map((s, i) => {
            const t = legitT[i]!
            const top = mid - t / 2
            const active = hover === s.id || selected === s.id
            return (
              <g
                key={s.id}
                tabIndex={0}
                role="button"
                aria-label={`${s.role} ${s.label}`}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(s.id)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(s.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(s.id)}
                className="cursor-pointer outline-none"
              >
                <rect x={xs[i]! - colW / 2} y={top} width={colW} height={t} rx="2" fill={s.scope === null ? 'rgb(var(--fog) / 0.35)' : 'rgb(var(--copper))'} stroke={active ? 'rgb(var(--ink))' : 'none'} strokeWidth="1.5" />
                {s.excess.length > 0 ? (
                  <rect x={xs[i]! - colW / 2} y={top - exT[i]!} width={colW} height={exT[i]!} rx="2" fill={`url(#${uid}-h)`} stroke="rgb(var(--crimson-ink))" strokeWidth="1.2" />
                ) : null}
                <rect x={xs[i]! - 46} y={top - exT[i]! - 8} width={92} height={t + exT[i]! + 16} fill="transparent" />
              </g>
            )
          })}
        </g>

        {stages.map((s, i) => {
          const top = mid - legitT[i]! / 2 - exT[i]!
          return (
            <g key={`l-${s.id}`} className="pointer-events-none">
              <text x={xs[i]} y={top - 10} textAnchor="middle" className="font-mono" fontSize="13" fill={s.excess.length ? 'rgb(var(--crimson-ink))' : 'rgb(var(--ink-2))'}>
                {s.scope === null ? '?' : s.scope.length}
                {s.excess.length ? ` +${s.excess.length}` : ''}
              </text>
              <text x={xs[i]} y={plotH + 18} textAnchor="middle" fontSize="10" letterSpacing="1.2" className="font-mono uppercase" fill="rgb(var(--ink-3))">
                {W < 640 ? s.role.split(' ')[0] : s.role}
              </text>
              {compact ? null : (
                <text x={xs[i]} y={plotH + 38} textAnchor="middle" fontSize="13.5" fill="rgb(var(--ink))">
                  {truncate(s.label, Math.floor(W / stages.length / 8.2))}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover ? (
        <StageTooltip stage={stages.find((s) => s.id === hover)!} left={(xs[stages.findIndex((s) => s.id === hover)]! / W) * 100} />
      ) : null}
      {anyExcess ? (
        <figcaption className="mt-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-crimson-ink">
          <span className="hatch-crimson inline-block h-2.5 w-5 rounded-[2px] border border-crimson-ink" aria-hidden />
          Authority amplification: the stream widens where no delegation conveyed it
        </figcaption>
      ) : null}
    </figure>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(4, n - 1))}…` : s
}

function StageTooltip({ stage, left }: { stage: FlowStage; left: number }) {
  return (
    <div className="pointer-events-none absolute top-1 z-10 w-max max-w-[260px] -translate-x-1/2 rounded border border-[rgb(var(--line-strong)/0.18)] bg-s3 px-2.5 py-2 shadow-lift anim-fade-up" style={{ left: `${Math.min(88, Math.max(12, left))}%` }}>
      <div className="eyebrow">{stage.role}</div>
      <div className="text-[12.5px] text-ink">{stage.label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {stage.scope === null ? <span className="font-mono text-[11px] text-fog-ink">authority unknown</span> : stage.scope.map((p) => <span key={p} className="scope-chip border-[rgb(var(--line-strong)/0.16)] bg-s2 text-ink">{p}</span>)}
        {stage.excess.map((p) => (
          <span key={p} className="scope-chip border-crimson/60 bg-crimson/15 text-crimson-ink">+{p}</span>
        ))}
      </div>
    </div>
  )
}
