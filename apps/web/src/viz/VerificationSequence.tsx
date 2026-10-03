import { useEffect, useState } from 'react'
import { useReducedMotion } from '../lib/prefs'
import { cx } from '../ui/primitives'

/**
 * The verification pipeline as it runs. Stages advance while the request is in
 * flight and settle to COMPLETE only when the server has answered; the
 * animation never claims a result the engine has not returned.
 */
export const STAGES = ['COLLECTING', 'RECONSTRUCTING', 'VERIFYING', 'CHECKING AUTHORITY', 'CHECKING ATTRIBUTION', 'COMPLETE'] as const

export function VerificationSequence({ running, done, failed, className }: { running: boolean; done: boolean; failed?: boolean; className?: string }) {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!running) return
    setI(0)
    const t = setInterval(() => setI((x) => Math.min(x + 1, STAGES.length - 2)), reduced ? 60 : 260)
    return () => clearInterval(t)
  }, [running, reduced])
  useEffect(() => {
    if (done) setI(STAGES.length - 1)
  }, [done])
  if (!running && !done && !failed) return null
  return (
    <ol className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', className)} aria-live="polite" aria-label="Verification progress">
      {STAGES.map((s, k) => {
        const state = failed && k === i ? 'failed' : k < i || (done && k === i) ? 'done' : k === i ? 'active' : 'pending'
        return (
          <li key={s} className="flex items-center gap-2">
            <span className={cx('font-mono text-[10px] tracking-[0.14em] transition-colors duration-300', state === 'done' ? (s === 'COMPLETE' ? 'text-sage-ink' : 'text-ink-2') : state === 'active' ? 'text-copper-ink' : state === 'failed' ? 'text-crimson-ink' : 'text-ink-4')}>
              {state === 'active' ? <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-copper align-middle" aria-hidden /> : null}
              {failed && k === i ? 'FAILED' : s}
            </span>
            {k < STAGES.length - 1 ? <span className={cx('h-px w-3', k < i ? 'bg-ink-3' : 'bg-ink-4/40')} aria-hidden /> : null}
          </li>
        )
      })}
    </ol>
  )
}
