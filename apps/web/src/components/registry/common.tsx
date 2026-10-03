import { useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { wsKey } from '../../lib/queries'
import { useReducedMotion } from '../../lib/prefs'
import { FINDING_LABEL, stamp } from '../../lib/format'
import type { ChainRow, FindingView, PrincipalType } from '../../lib/types'
import { PRINCIPAL_ICON } from '../../brand/icons'
import { Badge, cx } from '../../ui/primitives'
import { DecisionBadge, FindingStatusBadge, HealthBadge, SeverityBadge } from '../../ui/status'
import { ScopeChip } from '../../ui/scope'
import { DataTable } from '../../ui/data'
import type { Column } from '../../ui/data'
import type { ApprovalState, ContractIntegrity, IdentitiesResponse } from './types'

// ------------------------------------------------------------------ queries

/** The identity registry. Shared by every registry page for names and types. */
export function useIdentities() {
  return useQuery({ queryKey: wsKey('identities'), queryFn: () => api.get<IdentitiesResponse>('/api/identities') })
}

/** id -> display name and principal type, from the registry. Empty until loaded. */
export function usePrincipalIndex() {
  const q = useIdentities()
  const map = new Map<string, { name: string; type: PrincipalType }>()
  for (const p of q.data?.principals ?? []) map.set(p.principal_id, { name: p.display_name, type: p.principal_type })
  return map
}

// ------------------------------------------------------------------ motion

/** Small entrance stagger; no delay at all when motion is reduced. */
export function useStagger(step = 32, cap = 10) {
  const reduced = useReducedMotion()
  return useCallback((i: number): CSSProperties => (reduced ? {} : { animationDelay: `${Math.min(i, cap) * step}ms` }), [reduced, step, cap])
}

// ------------------------------------------------------------------ principals

export const TYPE_LABEL: Record<PrincipalType, string> = {
  human: 'Human',
  agent: 'Agent',
  sub_agent: 'Sub-agent',
  workload: 'Workload',
  service: 'Service',
}

/** Icon for a principal type; an unregistered principal gets a question mark, never a guessed type. */
export function PrincipalGlyph({ type, size = 16, className }: { type: PrincipalType | null | undefined; size?: number; className?: string }) {
  if (!type) {
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-fog/60 font-mono text-fog-ink', className)} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.55) }} aria-hidden>
        ?
      </span>
    )
  }
  const Icon = PRINCIPAL_ICON[type]
  return <Icon size={size} className={cx('shrink-0', className)} />
}

export function PrincipalLink({ id, name, type, className }: { id: string | null; name?: string | null; type?: PrincipalType | null; className?: string }) {
  if (!id) return <span className="font-mono text-[12px] italic text-fog-ink">not recorded</span>
  return (
    <Link to={`/app/identities/${encodeURIComponent(id)}`} className={cx('inline-flex min-w-0 items-center gap-1.5 text-ink transition-colors hover:text-copper-ink', className)}>
      <PrincipalGlyph type={type} size={14} className="text-ink-2" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{name ?? id}</span>
    </Link>
  )
}

// ------------------------------------------------------------------ scope

/** A scope in a table cell: the first few chips, then a count. Null is unknown, never empty. */
export function CompactScope({ scope, max = 3, highlight = [], empty = 'none', unknown = 'not recorded' }: { scope: readonly string[] | null | undefined; max?: number; highlight?: readonly string[]; empty?: ReactNode; unknown?: ReactNode }) {
  if (scope === null || scope === undefined) return <span className="font-mono text-[11.5px] italic text-fog-ink">{unknown}</span>
  if (scope.length === 0) return <span className="font-mono text-[11.5px] text-ink-3">{empty}</span>
  const shown = scope.slice(0, max)
  const rest = scope.length - shown.length
  return (
    <span className="inline-flex flex-wrap gap-1" title={scope.join(', ')}>
      {shown.map((p) => (
        <ScopeChip key={p} perm={p} tone={highlight.includes(p) ? 'excess' : 'neutral'} />
      ))}
      {rest > 0 ? <span className="self-center font-mono text-[11px] text-ink-3">+{rest} more</span> : null}
    </span>
  )
}

// ------------------------------------------------------------------ approval

const APPROVAL_TONE: Record<ApprovalState, 'sage' | 'amber' | 'crimson' | 'fog' | 'neutral'> = {
  APPROVED: 'sage',
  NOT_REQUIRED: 'neutral',
  PENDING: 'amber',
  REJECTED: 'crimson',
  EXPIRED: 'amber',
  UNKNOWN: 'fog',
}

export function ApprovalBadge({ state }: { state: ApprovalState }) {
  return (
    <Badge tone={APPROVAL_TONE[state]} title={`Approval state: ${state.replace(/_/g, ' ').toLowerCase()}`}>
      {state.replace(/_/g, ' ')}
    </Badge>
  )
}

// ------------------------------------------------------------------ integrity seal

export const INTEGRITY: Record<ContractIntegrity, { glyph: string; short: string; long: string; text: string; border: string; bg: string; explain: string }> = {
  PASS: {
    glyph: '✓',
    short: 'Integrity pass',
    long: 'Contract integrity: pass',
    text: 'text-sage-ink',
    border: 'border-sage/45',
    bg: 'bg-sage/[0.07]',
    explain: 'Actions relied on this delegation and no finding is located on it.',
  },
  WARN: {
    glyph: '!',
    short: 'Integrity warn',
    long: 'Contract integrity: warn',
    text: 'text-amber-ink',
    border: 'border-amber/45',
    bg: 'bg-amber/[0.07]',
    explain: 'Findings of medium or lower severity are located on this delegation.',
  },
  VIOLATION: {
    glyph: '✕',
    short: 'Contract violation',
    long: 'Contract violation',
    text: 'text-crimson-ink',
    border: 'border-crimson/55',
    bg: 'bg-crimson/[0.09]',
    explain: 'A high or critical finding is located on this delegation.',
  },
  UNVERIFIED: {
    glyph: '?',
    short: 'Unverified',
    long: 'Contract integrity: unverified',
    text: 'text-fog-ink',
    border: 'border-fog/45',
    bg: 'bg-fog/[0.06]',
    explain: 'No action relied on this delegation, so there is nothing to verify it against. Unverified is not violated.',
  },
}

/** The footer seal of a delegation contract. The verdict is the API's `contract_integrity`. */
export function IntegritySeal({ integrity, className }: { integrity: ContractIntegrity; className?: string }) {
  const s = INTEGRITY[integrity]
  return (
    <span className={cx('inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]', s.text, className)} title={s.explain}>
      <span className={cx('inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px]', s.border)} aria-hidden>
        {s.glyph}
      </span>
      {s.long}
    </span>
  )
}

// ------------------------------------------------------------------ findings

export function FindingsList({ findings, empty }: { findings: FindingView[]; empty: ReactNode }) {
  if (findings.length === 0) return <p className="px-4 py-5 text-[12.5px] text-ink-3">{empty}</p>
  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
      {findings.map((f) => (
        <li key={f.finding_id}>
          <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-s2 focus-visible:bg-s2">
            <SeverityBadge severity={f.severity} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink group-hover:text-copper-ink">{f.title}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{f.summary}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10.5px] text-ink-3">{f.rule_id}</span>
                <span className="font-mono text-[10.5px] text-ink-3">{FINDING_LABEL[f.type] ?? f.type}</span>
                <FindingStatusBadge status={f.status} />
              </span>
            </span>
            <ChevronRight size={14} className="mt-1 shrink-0 text-ink-4 group-hover:text-ink-2" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Links to findings when only ids are known. */
export function FindingIdLinks({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <Link key={id} to={`/app/findings/${encodeURIComponent(id)}`} className="id rounded border border-[rgb(var(--line-strong)/0.14)] px-1.5 py-[1px] text-[11px] transition-colors hover:border-copper/50 hover:text-copper-ink">
          {id}
        </Link>
      ))}
    </span>
  )
}

// ------------------------------------------------------------------ actions

/** Actions as chain rows. Each row opens the chain; health and decisions are the API's. */
export function ActionsTable({ rows, caption, empty }: { rows: ChainRow[]; caption: string; empty: ReactNode }) {
  const nav = useNavigate()
  const columns: Column<ChainRow>[] = [
    { key: 'time', header: 'Time', width: '150px', hideBelow: 'md', cell: (r) => <span className="font-mono text-[11.5px] text-ink-2">{stamp(r.timestamp)}</span> },
    {
      key: 'chain',
      header: 'Delegation chain',
      width: 'minmax(0,1.6fr)',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block text-[12.5px] text-ink [overflow-wrap:anywhere]">{r.path.length ? r.path.map((p) => p.name).join(' → ') : <span className="italic text-fog-ink">no chain resolved</span>}</span>
          <span className="id block text-[11px] text-ink-3">{r.event_id}</span>
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Tool → resource',
      width: 'minmax(0,1.2fr)',
      hideBelow: 'lg',
      cell: (r) => (
        <span className="block min-w-0 text-[12px] text-ink-2 [overflow-wrap:anywhere]">
          {r.tool_name ?? r.tool_id ?? '—'} <span className="text-ink-4">→</span> {r.resource_name ?? r.resource_id ?? '—'}
          {r.operation ? <span className="ml-1 font-mono text-[11px] text-ink-3">{r.operation}</span> : null}
        </span>
      ),
    },
    { key: 'decision', header: 'Decision', width: '130px', hideBelow: 'sm', cell: (r) => <DecisionBadge decision={r.derived_decision} recorded={r.recorded_decision} /> },
    { key: 'health', header: 'Chain health', width: '112px', cell: (r) => <HealthBadge health={r.health} /> },
  ]
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.action_id} onRowClick={(r) => nav(`/app/chains/${encodeURIComponent(r.action_id)}`)} caption={caption} empty={<p className="px-4 py-5 text-[12.5px] text-ink-3">{empty}</p>} />
}

// ------------------------------------------------------------------ layout bits

/** A segmented two-or-more-way toggle built from pressed buttons. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: ReactNode; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 items-center rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={cx('inline-flex h-full items-center gap-1.5 rounded-[3px] px-2.5 text-[12px] transition-colors', o.id === value ? 'bg-s4 text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** One line of type counts: icon, count, label. Not a metric card. */
export function CountStrip({ items, label }: { items: { key: string; icon: ReactNode; count: number; label: string; tone?: string }[]; label: string }) {
  return (
    <ul aria-label={label} className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-y hairline py-2.5">
      {items.map((it) => (
        <li key={it.key} className={cx('inline-flex items-center gap-2 text-[12.5px]', it.tone ?? 'text-ink-2')}>
          <span aria-hidden className="text-ink-3">
            {it.icon}
          </span>
          <span className="tnum font-mono text-[13px] text-ink">{it.count}</span>
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  )
}
