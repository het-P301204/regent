import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../../ui/primitives'

/**
 * Small static teaching diagrams. They illustrate concepts with the Acme demo
 * cast; they never compute a verdict. Results shown are labelled as taken from
 * the demo run, and every diagram links to the live view.
 */

export type Tone = 'neutral' | 'copper' | 'crimson' | 'sage' | 'amber' | 'fog'

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-[rgb(var(--line-strong)/0.18)]',
  copper: 'border-copper/55',
  crimson: 'border-crimson/60',
  sage: 'border-sage/50',
  amber: 'border-amber/55',
  fog: 'border-fog/55 border-dashed',
}
const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-3',
  copper: 'text-copper-ink',
  crimson: 'text-crimson-ink',
  sage: 'text-sage-ink',
  amber: 'text-amber-ink',
  fog: 'text-fog-ink',
}

export interface ChainNode {
  role: string
  label: string
  sub?: string
  tone?: Tone
  extra?: ReactNode
}

/** A left-to-right chain of nodes with labelled edges. Stacks vertically on narrow screens. */
export function NodeChain({ nodes, edges = [], label }: { nodes: ChainNode[]; edges?: string[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col items-stretch gap-0 md:flex-row md:items-stretch">
      {nodes.map((n, i) => (
        <Fragment key={`${n.label}-${i}`}>
          <li className={cx('min-w-0 flex-1 rounded border bg-s2 px-3 py-2.5', TONE_BORDER[n.tone ?? 'neutral'])}>
            <div className={cx('font-mono text-[10px] uppercase tracking-[0.12em]', TONE_TEXT[n.tone ?? 'neutral'])}>{n.role}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink [overflow-wrap:anywhere]">{n.label}</div>
            {n.sub ? <div className="mt-0.5 font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">{n.sub}</div> : null}
            {n.extra ? <div className="mt-2">{n.extra}</div> : null}
          </li>
          {i < nodes.length - 1 ? (
            <li aria-hidden className="flex shrink-0 items-center justify-center px-1 py-1 md:w-16 md:flex-col md:px-0 md:py-0">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 md:mb-1 md:text-center">{edges[i] ?? ''}</span>
              <span className="ml-2 text-ink-3 md:ml-0">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </span>
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  )
}

/** Present / missing evidence fields. Missing is amber (incomplete), never crimson. */
export function FieldChecklist({ present, missing, label }: { present: string[]; missing: string[]; label: string }) {
  const all = [...present.map((f) => [f, true] as const), ...missing.map((f) => [f, false] as const)]
  return (
    <div>
      <ul aria-label={label} className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {all.map(([f, ok]) => (
          <li key={f} className="flex items-center gap-2 font-mono text-[11.5px]">
            <span aria-hidden className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]', ok ? 'border-[rgb(var(--line-strong)/0.3)] text-ink-2' : 'border-amber/60 text-amber-ink')}>
              {ok ? '✓' : '!'}
            </span>
            <span className={ok ? 'text-ink-2' : 'text-amber-ink'}>{f}</span>
            <span className="sr-only">{ok ? 'recorded' : 'missing'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[11px] text-ink-3">
        {present.length} of {present.length + missing.length} fields recorded
      </p>
    </div>
  )
}

/** Two columns compared row by row. */
export function ComparePair({ left, right, rows, caption }: { left: string; right: string; rows: [string, ReactNode, ReactNode][]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b hairline-strong">
            <th scope="col" className="eyebrow py-2 pr-3 font-normal">
              <span className="sr-only">Property</span>
            </th>
            <th scope="col" className="eyebrow py-2 pr-3 font-normal">{left}</th>
            <th scope="col" className="eyebrow py-2 font-normal">{right}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-b hairline align-top last:border-b-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink-3">{k}</th>
              <td className="py-2 pr-3 text-ink">{a}</td>
              <td className="py-2 text-ink">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * evt-0901 on a time axis: delegation valid 08:30 to its 14:00 revocation, a
 * decision cached at 13:30, the action at 14:40. Drawn from the demo records.
 */
export function ActionTimeTimeline() {
  const x = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number]
    const mins = h * 60 + m
    return 40 + ((mins - 8 * 60) / (16 * 60 - 8 * 60)) * 620
  }
  const marks: { at: string; label: string; sub: string; tone: string; above: boolean; anchor: 'start' | 'middle' | 'end' }[] = [
    { at: '08:30', label: 'Delegated', sub: 'del-daniel-support', tone: 'rgb(var(--ink-2))', above: true, anchor: 'middle' },
    { at: '13:30', label: 'Decision evaluated', sub: 'cached', tone: 'rgb(var(--ink-2))', above: false, anchor: 'end' },
    { at: '14:00', label: 'Revoked', sub: 'by Daniel Okafor', tone: 'rgb(var(--amber-ink))', above: true, anchor: 'middle' },
    { at: '14:40', label: 'evt-0901', sub: 'ticket.write', tone: 'rgb(var(--crimson-ink))', above: false, anchor: 'start' },
  ]
  return (
    <figure>
      <svg viewBox="0 0 700 150" className="block h-auto w-full" role="img" aria-labelledby="att-t att-d">
        <title id="att-t">Action-time authorization timeline for evt-0901</title>
        <desc id="att-d">SupportAgent's delegation is valid from 08:30 until Daniel Okafor revokes it at 14:00. A decision was evaluated and cached at 13:30. The action at 14:40 relied on that cached decision after the revocation.</desc>
        <defs>
          <pattern id="att-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="6" height="6" fill="rgb(var(--crimson) / 0.15)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--crimson-ink))" strokeWidth="1.6" />
          </pattern>
        </defs>
        <line x1="40" x2="660" y1="75" y2="75" stroke="rgb(var(--ink) / 0.14)" />
        <rect x={x('08:30')} y="69" width={x('14:00') - x('08:30')} height="12" rx="2" fill="rgb(var(--sage) / 0.45)" />
        <rect x={x('14:00')} y="69" width={x('14:40') - x('14:00')} height="12" rx="2" fill="url(#att-hatch)" stroke="rgb(var(--crimson-ink))" strokeWidth="1" />
        {['08:00', '10:00', '12:00', '14:00', '16:00'].map((t) => (
          <text key={t} x={x(t)} y="98" textAnchor="middle" fontSize="10" className="font-mono" fill="rgb(var(--ink-3))">
            {t}
          </text>
        ))}
        {marks.map((m) => (
          <g key={m.at}>
            <line x1={x(m.at)} x2={x(m.at)} y1={m.above ? 30 : 81} y2={m.above ? 69 : 118} stroke={m.tone} strokeDasharray="2 3" />
            <circle cx={x(m.at)} cy="75" r="3.5" fill={m.tone} />
            <text x={x(m.at) + (m.anchor === 'end' ? 6 : m.anchor === 'start' ? -6 : 0)} y={m.above ? 16 : 132} textAnchor={m.anchor} fontSize="11.5" fill={m.tone}>
              {m.label}
            </text>
            <text x={x(m.at) + (m.anchor === 'end' ? 6 : m.anchor === 'start' ? -6 : 0)} y={m.above ? 28 : 145} textAnchor={m.anchor} fontSize="9.5" className="font-mono" fill="rgb(var(--ink-3))">
              {m.at} · {m.sub}
            </text>
          </g>
        ))}
      </svg>
      <ol aria-hidden className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:hidden">
        {marks.map((m) => (
          <li key={m.at} className="font-mono text-[11px]" style={{ color: m.tone }}>
            {m.at} {m.label}
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-5 rounded-[2px] bg-sage/45" /> delegation valid
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="hatch-crimson inline-block h-2.5 w-5 rounded-[2px] border border-crimson-ink" /> acting after revocation
        </span>
      </figcaption>
    </figure>
  )
}

/** A vertical walk from an action back to its root principal. */
export function ReconstructionSteps({ steps, label }: { steps: { kind: string; id: string; note: string; link?: string; tone?: Tone }[]; label: string }) {
  return (
    <ol aria-label={label} className="relative flex flex-col gap-0">
      {steps.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pb-3 last:pb-0">
          <div className="flex flex-col items-center">
            <span aria-hidden className={cx('mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2', s.tone === 'sage' ? 'border-sage bg-sage/40' : 'border-copper bg-copper/30')} />
            {i < steps.length - 1 ? <span aria-hidden className="mt-1 w-px flex-1 bg-[rgb(var(--line-strong)/0.2)]" /> : null}
          </div>
          <div className="min-w-0 pb-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{s.kind}</span>
              <span className="font-mono text-[12.5px] text-ink">{s.id}</span>
              {s.link ? <span className="font-mono text-[10.5px] text-copper-ink">{s.link}</span> : null}
            </div>
            <p className="text-[12px] leading-snug text-ink-2">{s.note}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
