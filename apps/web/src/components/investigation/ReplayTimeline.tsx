import type { Explanation, Replay, ReplayStep } from '../../lib/types'
import { ResultBadge, RESULT_COLOR } from '../../ui/status'
import { cx } from '../../ui/primitives'
import { offsetText } from '../chains/ChainPath'

/**
 * Replay steps as a timeline. Order, timestamps and the first-violation index
 * all come from the engine's replay; steps without a recorded time are listed
 * apart rather than given an invented one.
 */
export function ReplayTimeline({ replay }: { replay: Replay }) {
  if (replay.steps.length === 0 && replay.untimed.length === 0) return <p className="text-[12.5px] text-ink-3">The replay has no steps for this event.</p>
  return (
    <div className="min-w-0">
      <ol className="flex min-w-0 flex-col" aria-label="Replay steps in recorded order">
        {replay.steps.map((s, i) => (
          <Step key={s.index} step={s} first={replay.violation_index === s.index} last={i === replay.steps.length - 1} delay={Math.min(i, 12) * 35} />
        ))}
      </ol>
      {replay.untimed.length > 0 ? (
        <div className="mt-4 border-t hairline pt-3">
          <h3 className="eyebrow mb-2 text-amber-ink">
            <span aria-hidden>! </span>Untimed: no recorded timestamp
          </h3>
          <ol className="flex min-w-0 flex-col">
            {replay.untimed.map((s, i) => (
              <Step key={s.index} step={s} first={false} last={i === replay.untimed.length - 1} delay={0} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

function Step({ step, first, last, delay }: { step: ReplayStep; first: boolean; last: boolean; delay: number }) {
  return (
    <li className="grid min-w-0 grid-cols-[66px_16px_minmax(0,1fr)] gap-x-3 anim-fade-up sm:grid-cols-[86px_16px_minmax(0,1fr)]" style={{ animationDelay: `${delay}ms` }}>
      <div className="pt-0.5 text-right">
        {step.at ? (
          <time dateTime={step.at} className="tnum block font-mono text-[11.5px] text-ink-2">
            {step.at.slice(11, 19)}
          </time>
        ) : (
          <span className="block font-mono text-[11px] italic text-fog-ink">untimed</span>
        )}
        {step.offset_ms !== null ? <span className="tnum block font-mono text-[10px] text-ink-3">{offsetText(step.offset_ms)}</span> : null}
      </div>
      <div className="relative flex flex-col items-center" aria-hidden>
        <span className={cx('relative z-[1] mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-full', first && 'anim-pulse-crimson')} style={{ background: RESULT_COLOR[step.status] }} />
        {!last ? <span className="w-px flex-1 bg-[rgb(var(--line-strong)/0.16)]" /> : null}
      </div>
      <div className={cx('min-w-0', last ? 'pb-0' : 'pb-4', first && '-ml-1 rounded border-l-2 border-crimson/70 bg-crimson/[0.06] pl-2.5 pr-2 pt-0.5')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12.5px] font-medium text-ink [overflow-wrap:anywhere]">{step.title}</span>
          <ResultBadge result={step.status} />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{step.kind}</span>
          {first ? (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-crimson-ink">
              <span aria-hidden>✕ </span>First violation
            </span>
          ) : null}
        </div>
        {step.detail ? <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{step.detail}</p> : null}
      </div>
    </li>
  )
}

const TONE: Record<Explanation['steps'][number]['tone'], { glyph: string; cls: string; word: string }> = {
  pass: { glyph: '✓', cls: 'border-sage/45 text-sage-ink', word: 'holds' },
  warn: { glyph: '!', cls: 'border-amber/50 text-amber-ink', word: 'warning' },
  fail: { glyph: '✕', cls: 'border-crimson/55 text-crimson-ink', word: 'breaks' },
  neutral: { glyph: '·', cls: 'border-[rgb(var(--line-strong)/0.2)] text-ink-3', word: 'context' },
}

/** The engine's deterministic explanation, phrased step by step. */
export function ExplanationView({ ex }: { ex: Explanation }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">{ex.question}</h3>
      <p className="mt-1.5 text-[14px] leading-snug text-ink">{ex.headline}</p>
      <ol className="mt-3 flex flex-col gap-2">
        {ex.steps.map((s, i) => {
          const t = TONE[s.tone]
          return (
            <li key={i} className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-2.5">
              <span className={cx('mt-[1px] inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[9.5px] font-semibold', t.cls)}>
                <span aria-hidden>{t.glyph}</span>
                <span className="sr-only">{t.word}</span>
              </span>
              <span className="text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{s.text}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 border-t hairline pt-3 text-[12.5px] leading-relaxed text-ink">{ex.conclusion}</p>
      <p className="mt-2 text-[11px] text-ink-3">Generated deterministically from the verification result. No language model is involved.</p>
    </div>
  )
}
