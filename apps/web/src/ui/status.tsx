import type { ReactNode } from 'react'
import type { CheckResult, FindingStatus, Health, Severity, Decision } from '../lib/types'
import { cx } from './primitives'

/**
 * Status vocabulary. Every state has a glyph AND a word, so nothing is
 * conveyed by colour alone:
 *   PASS ✓  WARN !  FAIL ✕  UNKNOWN ?  SKIPPED –
 */

const RESULT: Record<CheckResult, { glyph: string; cls: string; label: string }> = {
  PASS: { glyph: '✓', cls: 'text-sage-ink border-sage/40 bg-sage/10', label: 'Pass' },
  WARN: { glyph: '!', cls: 'text-amber-ink border-amber/45 bg-amber/10', label: 'Warn' },
  FAIL: { glyph: '✕', cls: 'text-crimson-ink border-crimson/50 bg-crimson/12', label: 'Fail' },
  UNKNOWN: { glyph: '?', cls: 'text-fog-ink border-fog/45 bg-fog/10', label: 'Unknown' },
  SKIPPED: { glyph: '–', cls: 'text-ink-3 border-[rgb(var(--line-strong)/0.16)] bg-transparent', label: 'Skipped' },
}

export function ResultBadge({ result, compact, className }: { result: CheckResult; compact?: boolean; className?: string }) {
  const r = RESULT[result]
  return (
    <span className={cx('inline-flex h-[20px] items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]', r.cls, className)} title={r.label}>
      <span aria-hidden>{r.glyph}</span>
      {compact ? <span className="sr-only">{result}</span> : result}
    </span>
  )
}

export const RESULT_COLOR: Record<CheckResult, string> = {
  PASS: 'rgb(var(--sage))',
  WARN: 'rgb(var(--amber))',
  FAIL: 'rgb(var(--crimson))',
  UNKNOWN: 'rgb(var(--fog))',
  SKIPPED: 'rgb(var(--ink-4))',
}

const SEV: Record<Severity, { cls: string; bars: number }> = {
  critical: { cls: 'text-crimson-ink border-crimson/55 bg-crimson/15', bars: 4 },
  high: { cls: 'text-copper-ink border-copper/50 bg-copper/12', bars: 3 },
  medium: { cls: 'text-amber-ink border-amber/45 bg-amber/10', bars: 2 },
  low: { cls: 'text-fog-ink border-fog/45 bg-fog/10', bars: 1 },
  info: { cls: 'text-ink-3 border-[rgb(var(--line-strong)/0.16)]', bars: 0 },
}

/** Severity: label plus a 4-step bar meter, readable without colour. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEV[severity]
  return (
    <span className={cx('inline-flex h-[20px] items-center gap-1.5 rounded-[3px] border px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]', s.cls, className)}>
      <span className="flex items-end gap-[1.5px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('w-[2.5px] rounded-[1px]', i < s.bars ? 'bg-current' : 'bg-current opacity-20')} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {severity}
    </span>
  )
}

const HEALTH: Record<Health, { label: string; glyph: string; cls: string; color: string }> = {
  verified: { label: 'Verified', glyph: '✓', cls: 'text-sage-ink', color: 'rgb(var(--sage))' },
  incomplete: { label: 'Incomplete', glyph: '!', cls: 'text-amber-ink', color: 'rgb(var(--amber))' },
  violated: { label: 'Violated', glyph: '✕', cls: 'text-crimson-ink', color: 'rgb(var(--crimson))' },
  unknown: { label: 'Unknown', glyph: '?', cls: 'text-fog-ink', color: 'rgb(var(--fog))' },
}
export const HEALTH_COLOR = Object.fromEntries(Object.entries(HEALTH).map(([k, v]) => [k, v.color])) as Record<Health, string>

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const h = HEALTH[health]
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', h.cls, className)}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]" aria-hidden>
        {h.glyph}
      </span>
      {h.label}
    </span>
  )
}

export function DecisionBadge({ decision, recorded, className }: { decision: Decision; recorded?: Decision | null; className?: string }) {
  const tone = decision === 'ALLOW' ? 'text-sage-ink border-sage/40' : decision === 'DENY' ? 'text-crimson-ink border-crimson/50' : decision === 'CONDITIONAL' ? 'text-amber-ink border-amber/45' : 'text-fog-ink border-fog/45'
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <span className={cx('inline-flex h-[20px] items-center rounded-[3px] border px-1.5 font-mono text-[10.5px] font-semibold tracking-[0.08em]', tone)}>{decision}</span>
      {recorded && recorded !== decision ? <span className="font-mono text-[10.5px] text-ink-3" title="The system under audit recorded a different decision">rec. {recorded}</span> : null}
    </span>
  )
}

const FSTATUS: Record<FindingStatus, string> = {
  OPEN: 'text-ink border-[rgb(var(--line-strong)/0.3)]',
  INVESTIGATING: 'text-copper-ink border-copper/45',
  ACCEPTED: 'text-amber-ink border-amber/40',
  RESOLVED: 'text-sage-ink border-sage/40',
  SUPPRESSED: 'text-ink-3 border-[rgb(var(--line-strong)/0.16)] line-through decoration-ink-4',
}
export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <span className={cx('inline-flex h-[20px] items-center rounded-[3px] border px-1.5 font-mono text-[10.5px] tracking-[0.06em]', FSTATUS[status])}>{status}</span>
}

export function LifecycleBadge({ state }: { state: string }) {
  const tone = state === 'ACTIVE' || state === 'VALID' ? 'text-sage-ink border-sage/40' : state === 'REVOKED' || state === 'SUSPENDED' ? 'text-crimson-ink border-crimson/45' : state === 'EXPIRED' || state === 'NOT_YET_VALID' ? 'text-amber-ink border-amber/40' : 'text-fog-ink border-fog/40'
  return <span className={cx('inline-flex h-[20px] items-center rounded-[3px] border px-1.5 font-mono text-[10.5px] tracking-[0.06em]', tone)}>{state.replace(/_/g, ' ')}</span>
}

export function Dot({ result, size = 8 }: { result: CheckResult; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: RESULT_COLOR[result] }} aria-hidden />
}

export function SourceTag({ source }: { source: 'demo' | 'scenario' | 'import' | 'builder' }): ReactNode {
  const map = { demo: ['DEMO', 'fog'], scenario: ['SCENARIO', 'copper'], import: ['IMPORTED', 'amber'], builder: ['BUILT', 'copper'] } as const
  const [label, tone] = map[source]
  const cls = tone === 'fog' ? 'text-fog-ink border-fog/45' : tone === 'amber' ? 'text-amber-ink border-amber/45' : 'text-copper-ink border-copper/45'
  return <span className={cx('inline-flex h-[18px] items-center rounded-[3px] border px-1.5 font-mono text-[9.5px] font-semibold tracking-[0.12em]', cls)}>{label}</span>
}
