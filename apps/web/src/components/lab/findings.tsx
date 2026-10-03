import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Crosshair } from 'lucide-react'
import type { DimensionCheck, Explanation, Finding, FindingType } from '../../lib/types'
import { FINDING_LABEL } from '../../lib/format'
import { Badge, cx } from '../../ui/primitives'
import { ResultBadge, SeverityBadge } from '../../ui/status'

/**
 * Display helpers shared by the lab pages (Scenario Lab, Chain Builder,
 * Action-time authorization). Everything here renders what the engine
 * returned; nothing here decides a result.
 */

/**
 * Finding types that describe missing or unfollowable evidence. They are shown
 * amber (incomplete), never crimson: missing evidence is not a violation.
 * This only picks a display tone for a type the engine already produced.
 */
const INCOMPLETE_TYPES: ReadonlySet<FindingType> = new Set<FindingType>([
  'UNATTRIBUTABLE_ACTION',
  'BROKEN_DELEGATION_CHAIN',
  'ORPHANED_PRINCIPAL',
  'MISSING_DELEGATED_SCOPE',
  'MISSING_REQUESTED_SCOPE',
  'MISSING_POLICY_VERSION',
  'UNKNOWN_REFERENCE',
])

export function findingTone(type: FindingType): 'crimson' | 'amber' {
  return INCOMPLETE_TYPES.has(type) ? 'amber' : 'crimson'
}

export function findingLabel(type: string): string {
  return FINDING_LABEL[type] ?? type
}

/** A finding type as a badge. `neutral` is for expectations, which are not results. */
export function FindingTypeBadge({ type, neutral, className }: { type: FindingType; neutral?: boolean; className?: string }) {
  const tone = neutral ? 'neutral' : findingTone(type)
  const glyph = neutral ? null : tone === 'amber' ? '!' : '✕'
  return (
    <Badge tone={tone} className={cx('normal-case tracking-normal', className)} title={type}>
      {glyph ? <span aria-hidden>{glyph}</span> : null}
      {findingLabel(type)}
    </Badge>
  )
}

/** The engine's findings, most severe first, with an optional "show on canvas" hook. */
export function FindingList({ findings, onLocate, locateLabel = 'Show on canvas', linkToDetail = false, empty }: { findings: Finding[]; onLocate?: (f: Finding) => void; locateLabel?: string; linkToDetail?: boolean; empty?: ReactNode }) {
  if (findings.length === 0) return <>{empty ?? null}</>
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const
  const sorted = [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.finding_id.localeCompare(b.finding_id))
  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.08)]" aria-label="Findings">
      {sorted.map((f) => (
        <li key={f.finding_id} className="py-3 first:pt-0 last:pb-0 anim-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <FindingTypeBadge type={f.type} />
            <span className="font-mono text-[10.5px] text-ink-3">{f.rule_id}</span>
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">
            {linkToDetail ? (
              <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="hover:text-copper-ink hover:underline">
                {f.title}
              </Link>
            ) : (
              f.title
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{f.summary}</p>
          {f.authority_delta && f.authority_delta.excess.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="eyebrow mr-1">Not granted</span>
              {f.authority_delta.excess.map((p) => (
                <span key={p} className="scope-chip border-crimson/60 bg-crimson/15 text-crimson-ink">
                  <span aria-hidden>+</span>
                  {p}
                </span>
              ))}
            </div>
          ) : null}
          {onLocate && (f.broken_edge || f.action_id || f.delegation_id) ? (
            <button type="button" onClick={() => onLocate(f)} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-copper-ink hover:underline">
              <Crosshair size={12} aria-hidden />
              {locateLabel}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Per-dimension verification results for one action. */
export function CheckList({ checks }: { checks: DimensionCheck[] }) {
  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.08)]" aria-label="Verification results by dimension">
      {checks.map((c) => (
        <li key={c.dimension} className="grid grid-cols-[minmax(0,150px)_auto_minmax(0,1fr)] items-start gap-3 py-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
          <span className="text-[12.5px] text-ink">{c.label}</span>
          <ResultBadge result={c.result} />
          <span className="text-[12px] leading-relaxed text-ink-3 max-sm:col-span-2 [overflow-wrap:anywhere]">{c.detail}</span>
        </li>
      ))}
    </ul>
  )
}

const STEP: Record<Explanation['steps'][number]['tone'], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: '✓', cls: 'text-sage-ink border-sage/45', label: 'passes' },
  warn: { glyph: '!', cls: 'text-amber-ink border-amber/45', label: 'warning' },
  fail: { glyph: '✕', cls: 'text-crimson-ink border-crimson/50', label: 'fails' },
  neutral: { glyph: '·', cls: 'text-ink-3 border-[rgb(var(--line-strong)/0.2)]', label: 'context' },
}

/** The engine's deterministic explanation, step by step. */
export function ExplanationSteps({ explanation }: { explanation: Explanation }) {
  return (
    <div>
      <p className="text-[13px] font-medium text-ink">{explanation.headline}</p>
      <ol className="mt-3 space-y-2">
        {explanation.steps.map((s, i) => {
          const t = STEP[s.tone]
          return (
            <li key={i} className="flex gap-2.5">
              <span className={cx('mt-[1px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px]', t.cls)} aria-label={t.label}>
                <span aria-hidden>{t.glyph}</span>
              </span>
              <span className="text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{s.text}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 border-t hairline pt-3 text-[12.5px] leading-relaxed text-ink">{explanation.conclusion}</p>
    </div>
  )
}
