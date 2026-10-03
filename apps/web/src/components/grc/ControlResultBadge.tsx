import { cx } from '../../ui/primitives'
import type { ControlResult } from './queries'

/**
 * Control result vocabulary. Glyph AND words, never colour alone:
 *   SATISFIED ✓   PARTIALLY SATISFIED !   NOT SATISFIED ✕   NOT EVALUATED ?
 */
export const CONTROL_RESULT: Record<ControlResult, { glyph: string; label: string; cls: string; fill: string }> = {
  SATISFIED: { glyph: '✓', label: 'Satisfied', cls: 'text-sage-ink border-sage/40 bg-sage/10', fill: 'bg-sage/70' },
  PARTIALLY_SATISFIED: { glyph: '!', label: 'Partially satisfied', cls: 'text-amber-ink border-amber/45 bg-amber/10', fill: 'bg-amber/70' },
  NOT_SATISFIED: { glyph: '✕', label: 'Not satisfied', cls: 'text-crimson-ink border-crimson/50 bg-crimson/12', fill: 'bg-crimson/80' },
  NOT_EVALUATED: { glyph: '?', label: 'Not evaluated', cls: 'text-fog-ink border-fog/45 bg-fog/10', fill: 'bg-fog/50' },
}

export const CONTROL_RESULT_ORDER: ControlResult[] = ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'NOT_EVALUATED']

export function ControlResultBadge({ result, className }: { result: ControlResult; className?: string }) {
  const r = CONTROL_RESULT[result]
  return (
    <span className={cx('inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]', r.cls, className)}>
      <span aria-hidden>{r.glyph}</span>
      {r.label}
    </span>
  )
}
