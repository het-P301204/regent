import type { ReactNode } from 'react'
import { cx } from './primitives'

type Tone = 'neutral' | 'granted' | 'excess' | 'restricted' | 'muted'

const TONE: Record<Tone, string> = {
  neutral: 'border-[rgb(var(--line-strong)/0.18)] bg-s2 text-ink',
  granted: 'border-sage/40 bg-sage/[0.08] text-ink',
  excess: 'border-crimson/60 bg-crimson/15 text-crimson-ink',
  restricted: 'border-dashed border-[rgb(var(--line-strong)/0.3)] bg-transparent text-ink-3 line-through',
  muted: 'border-[rgb(var(--line-strong)/0.12)] bg-transparent text-ink-3',
}

export function ScopeChip({ perm, tone = 'neutral', note }: { perm: string; tone?: Tone; note?: string }) {
  return (
    <span className={cx('scope-chip', TONE[tone])} title={note}>
      {tone === 'excess' ? <span aria-hidden>+</span> : null}
      {perm}
      {tone === 'excess' ? <span className="sr-only"> (not granted)</span> : null}
    </span>
  )
}

/** A scope as chips. `null` means unknown, which is never shown as empty. */
export function ScopeChips({ scope, highlight = [], tone = 'neutral', empty = 'none', className }: { scope: readonly string[] | null | undefined; highlight?: readonly string[]; tone?: Tone; empty?: ReactNode; className?: string }) {
  if (scope === null || scope === undefined) return <span className="font-mono text-[11.5px] italic text-fog-ink">unknown — not recorded</span>
  if (scope.length === 0) return <span className="font-mono text-[11.5px] text-ink-3">{empty}</span>
  return (
    <span className={cx('inline-flex flex-wrap gap-1', className)}>
      {scope.map((p) => (
        <ScopeChip key={p} perm={p} tone={highlight.includes(p) ? 'excess' : tone} />
      ))}
    </span>
  )
}

/**
 * Authority Diff: granted vs requested vs effective vs exercised, aligned by
 * permission so an ungranted permission stands out on its own row. The excess
 * list comes from the engine; this component does not compute containment.
 */
export function AuthorityDiff({ granted, requested, effective, exercised, excess, available }: { granted: readonly string[] | null; requested: readonly string[] | null; effective: readonly string[] | null; exercised: readonly string[] | null; excess: readonly string[]; available?: readonly string[] | null }) {
  const all = [...new Set([...(available ?? []), ...(granted ?? []), ...(requested ?? []), ...(effective ?? []), ...(exercised ?? []), ...excess])].sort()
  const cols: { key: string; label: string; set: readonly string[] | null | undefined }[] = [
    ...(available !== undefined ? [{ key: 'available', label: 'Delegator held', set: available }] : []),
    { key: 'granted', label: 'Granted', set: granted },
    { key: 'requested', label: 'Requested', set: requested },
    { key: 'effective', label: 'Effective', set: effective },
    { key: 'exercised', label: 'Exercised', set: exercised },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] border-collapse text-left">
        <caption className="sr-only">Authority diff: for each permission, whether it was held, granted, requested, effective and exercised.</caption>
        <thead>
          <tr>
            <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Permission</th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className="eyebrow pb-2 pr-3 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((p) => {
            const bad = excess.includes(p)
            return (
              <tr key={p} className={cx('border-t hairline', bad && 'bg-crimson/[0.07]')}>
                <th scope="row" className="py-1.5 pr-4 font-normal">
                  <span className={cx('font-mono text-[12px]', bad ? 'text-crimson-ink' : 'text-ink')}>{p}</span>
                  {bad ? <span className="ml-2 font-mono text-[10px] font-semibold tracking-[0.1em] text-crimson-ink">← UNGRANTED</span> : null}
                </th>
                {cols.map((c) => {
                  const unknown = c.set === null || c.set === undefined
                  const has = !unknown && c.set!.includes(p)
                  return (
                    <td key={c.key} className="py-1.5 pr-3 text-center font-mono text-[12px]">
                      {unknown ? <span className="text-fog-ink" title="Not recorded">?</span> : has ? <span className={bad && c.key === 'exercised' ? 'text-crimson-ink' : 'text-ink'} aria-label="present">●</span> : <span className="text-ink-4" aria-label="absent">·</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {all.length === 0 ? <p className="py-3 text-[12.5px] text-ink-3">No permissions recorded.</p> : null}
    </div>
  )
}
