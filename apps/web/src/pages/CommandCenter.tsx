import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { api } from '../lib/api'
import { hhmm, pct, plural } from '../lib/format'
import { wsKey } from '../lib/queries'
import type { ChainRow, CheckResult, DatasetRow, FindingView, RunSummary, Severity } from '../lib/types'
import { IconChain, IconViolation } from '../brand/icons'
import { Counter, Sparkline } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { cx, LinkButton, PageHeader, Panel, Tooltip } from '../ui/primitives'
import { HEALTH_COLOR, HealthBadge, SeverityBadge, SourceTag, DecisionBadge, RESULT_COLOR } from '../ui/status'

interface Overview {
  dataset: DatasetRow
  run: { id: string; created_at: string; input_digest: string; ruleset_version: string; engine_version: string }
  summary: RunSummary
  metrics: {
    total_actions: number
    attributable_actions: number
    unattributable_actions: number
    authority_violations: number
    amplification_events: number
    broken_chains: number
    missing_field_records: number
    active_identities: number
    registered_identities: number
    active_delegations: number
    high_risk_chains: number
    policy_violations: number
    open_findings: number
    authority_integrity: { passing: number; evaluated: number; unknown: number }
  }
  timeline: { hour: string; verified: number; incomplete: number; violated: number; unknown: number }[]
  risk_distribution: Record<Severity | 'none', number>
  dimension_health: ({ dimension: string; label: string } & Record<CheckResult, number>)[]
  finding_status: Record<string, number>
  recent_findings: (FindingView & { actor_name: string | null })[]
  recent_actions: ChainRow[]
}

export default function CommandCenter() {
  const q = useQuery({ queryKey: wsKey('overview'), queryFn: () => api.get<Overview>('/api/overview') })
  if (q.isLoading) return <LoadingState label="Reconstructing chains" />
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />
  const o = q.data!
  const m = o.metrics
  if (m.total_actions === 0) {
    return (
      <>
        <Header o={o} />
        <Panel>
          <EmptyState icon={<IconChain size={28} />} title="No actions in this dataset" body="There is nothing to verify yet. Import agent events, run a scenario, or build a chain." action={<LinkButton to="/app/import" variant="primary">Import events</LinkButton>} />
        </Panel>
      </>
    )
  }
  const integrityPct = pct(m.authority_integrity.passing, m.authority_integrity.evaluated)
  const totals = o.timeline.map((t) => t.verified + t.incomplete + t.violated + t.unknown)
  return (
    <>
      <Header o={o} />

      {/* Integrity + metric strip: one panel, hairline-divided, not a wall of cards. */}
      <section className="panel grid grid-cols-1 overflow-hidden xl:grid-cols-[minmax(320px,0.9fr)_2fr]" aria-label="Key metrics">
        <div className="relative border-b hairline p-5 xl:border-b-0 xl:border-r">
          <div className="eyebrow">Authority integrity</div>
          <div className="mt-3 flex items-end gap-4">
            <div className="font-sans text-[52px] font-light leading-none tracking-[-0.04em] text-ink">
              <Counter value={integrityPct} />
              <span className="text-[24px] text-ink-3">%</span>
            </div>
            <IntegrityBar passing={m.authority_integrity.passing} evaluated={m.authority_integrity.evaluated} unknown={m.authority_integrity.unknown} />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
            <span className="tnum text-ink">{m.authority_integrity.passing}</span> of <span className="tnum text-ink">{m.authority_integrity.evaluated}</span> evaluable actions stayed within delegated authority.{' '}
            {m.authority_integrity.unknown > 0 ? (
              <>
                <span className="tnum text-fog-ink">{m.authority_integrity.unknown}</span> could not be evaluated and are <em>not</em> counted as passing.
              </>
            ) : null}
          </p>
          <div className="mt-3 font-mono text-[10.5px] text-ink-3">integrity = contained ÷ evaluable · unknown excluded</div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <Cell label="Agent actions" value={m.total_actions} visual={<Sparkline values={totals} label="Actions per hour" width={64} height={22} />} />
          <Cell label="Attributable" value={m.attributable_actions} sub={`of ${m.total_actions}`} />
          <Cell label="Unattributable" value={m.unattributable_actions} tone={m.unattributable_actions ? 'amber' : 'neutral'} to="/app/chains?attribution=unattributable" />
          <Cell label="Authority violations" value={m.authority_violations} tone={m.authority_violations ? 'crimson' : 'sage'} to="/app/chains?authority=FAIL" />
          <Cell label="Amplification events" value={m.amplification_events} tone={m.amplification_events ? 'crimson' : 'sage'} to="/app/findings?type=AUTHORITY_AMPLIFICATION" />
          <Cell label="Broken chains" value={m.broken_chains} tone={m.broken_chains ? 'amber' : 'neutral'} to="/app/findings?type=BROKEN_DELEGATION_CHAIN" />
          <Cell label="Missing audit fields" value={m.missing_field_records} sub="records" tone={m.missing_field_records ? 'amber' : 'neutral'} />
          <Cell label="Active identities" value={m.active_identities} sub={`${m.registered_identities} registered`} to="/app/identities" />
          <Cell label="Delegations" value={m.active_delegations} to="/app/delegations" />
          <Cell label="High-risk chains" value={m.high_risk_chains} tone={m.high_risk_chains ? 'crimson' : 'neutral'} to="/app/chains?health=violated" />
        </dl>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Activity by chain health" eyebrow="Timeline" className="xl:col-span-2" actions={<Legend />}>
          <ActivityChart timeline={o.timeline} />
        </Panel>
        <Panel title="Authority-risk distribution" eyebrow="Worst finding per action">
          <RiskDistribution dist={o.risk_distribution} total={m.total_actions} />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Chain health by invariant" eyebrow="Verification checks across all actions" bodyClassName="px-4 py-3">
          <DimensionHealth rows={o.dimension_health} total={m.total_actions} />
        </Panel>
        <Panel
          title="Recent findings"
          eyebrow={`${plural(m.open_findings, 'open finding')} · ${o.summary.findings_by_severity.critical} critical`}
          actions={<LinkButton to="/app/findings" size="sm" variant="ghost">All findings <ArrowRight size={13} /></LinkButton>}
          bodyClassName="p-0"
        >
          {o.recent_findings.length === 0 ? (
            <EmptyState title="No findings" body="Every invariant held for every action in this dataset." />
          ) : (
            <ul>
              {o.recent_findings.map((f, i) => (
                <li key={f.finding_id} className="anim-fade-up border-b hairline last:border-0" style={{ animationDelay: `${i * 50}ms` }}>
                  <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-s2">
                    <SeverityBadge severity={f.severity} className="mt-0.5 w-[86px] justify-start" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink">{f.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-2">{f.summary}</span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-[10.5px] text-ink-3 sm:block">{f.finding_id}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Recently analyzed actions" eyebrow="Latest by action time" actions={<LinkButton to="/app/chains" size="sm" variant="ghost">All chains <ArrowRight size={13} /></LinkButton>} bodyClassName="p-0">
        <RecentActions rows={o.recent_actions} />
      </Panel>
    </>
  )
}

function Header({ o }: { o: Overview }) {
  return (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <SourceTag source={o.dataset.source} /> {o.dataset.name}
        </span>
      }
      title="Command Center"
      description="Who authorized each agent action, through which delegation chain, and whether authority stayed within what was granted."
      actions={
        <Tooltip content={`Run ${o.run.id} · engine ${o.run.engine_version} · identical digest and rule set always give identical findings`}>
          <span className="inline-flex items-center gap-2 rounded border hairline-strong bg-s1 px-2.5 py-1.5 font-mono text-[10.5px] text-ink-3" tabIndex={0}>
            <span className="h-1.5 w-1.5 rounded-full bg-sage" aria-hidden />
            verified {o.run.created_at.slice(11, 16)} UTC · {o.run.input_digest.slice(0, 19)}… · rules {o.run.ruleset_version}
          </span>
        </Tooltip>
      }
    />
  )
}

function Cell({ label, value, sub, tone = 'neutral', visual, to }: { label: string; value: number; sub?: string; tone?: 'neutral' | 'crimson' | 'sage' | 'amber'; visual?: React.ReactNode; to?: string }) {
  const nav = useNavigate()
  const toneCls = tone === 'crimson' ? 'text-crimson-ink' : tone === 'sage' ? 'text-sage-ink' : tone === 'amber' ? 'text-amber-ink' : 'text-ink'
  const body = (
    <>
      <dt className="eyebrow min-h-[26px] leading-[13px]">{label}</dt>
      <dd className="mt-2 flex items-end justify-between gap-2">
        <span className={cx('text-[26px] font-light leading-none tracking-[-0.02em]', toneCls)}>
          <Counter value={value} />
          {sub ? <span className="ml-1.5 text-[11px] font-normal tracking-normal text-ink-3">{sub}</span> : null}
        </span>
        {visual}
      </dd>
    </>
  )
  return (
    <div className="border-b border-r hairline [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(3n)]:border-r lg:[&:nth-child(5n)]:border-r-0">
      {to ? (
        <button onClick={() => nav(to)} className="block w-full px-4 py-3.5 text-left transition-colors hover:bg-s2" aria-label={`${label}: ${value}. Open`}>
          {body}
        </button>
      ) : (
        <div className="px-4 py-3.5">{body}</div>
      )}
    </div>
  )
}

function IntegrityBar({ passing, evaluated, unknown }: { passing: number; evaluated: number; unknown: number }) {
  const total = evaluated + unknown || 1
  const segs: [number, string, string][] = [
    [passing, 'rgb(var(--sage))', 'contained'],
    [evaluated - passing, 'rgb(var(--crimson))', 'violated'],
    [unknown, 'rgb(var(--fog) / 0.6)', 'not evaluable'],
  ]
  return (
    <div className="mb-2 flex-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-s3" role="img" aria-label={`${passing} contained, ${evaluated - passing} violated, ${unknown} not evaluable`}>
        {segs.map(([n, c], i) => (n > 0 ? <span key={i} style={{ width: `${(n / total) * 100}%`, background: c, transition: 'width 900ms cubic-bezier(0.22,1,0.36,1)' }} /> : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 whitespace-nowrap font-mono text-[10px] text-ink-3">
        {segs.map(([n, c, l]) => (
          <span key={l} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} aria-hidden />
            {n} {l}
          </span>
        ))}
      </div>
    </div>
  )
}

const HEALTH_KEYS = ['verified', 'incomplete', 'unknown', 'violated'] as const

function Legend() {
  return (
    <div className="hidden items-center gap-3 sm:flex">
      {HEALTH_KEYS.map((h) => (
        <span key={h} className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: HEALTH_COLOR[h] }} aria-hidden />
          {h}
        </span>
      ))}
    </div>
  )
}

function ActivityChart({ timeline: sparse }: { timeline: Overview['timeline'] }) {
  // Display only: fill hours with no actions so the axis is continuous.
  const timeline: Overview['timeline'] = []
  if (sparse.length) {
    const start = Date.parse(sparse[0]!.hour)
    const end = Date.parse(sparse[sparse.length - 1]!.hour)
    const byHour = new Map(sparse.map((t) => [t.hour, t]))
    for (let h = start; h <= end; h += 3600_000) {
      const key = new Date(h).toISOString()
      timeline.push(byHour.get(key) ?? { hour: key, verified: 0, incomplete: 0, violated: 0, unknown: 0 })
    }
  }
  const max = Math.max(1, ...timeline.map((t) => t.verified + t.incomplete + t.violated + t.unknown))
  const H = 150
  return (
    <div>
      <div className="flex h-[170px] items-end gap-1.5" role="img" aria-label={`Actions per hour: ${timeline.map((t) => `${hhmm(t.hour)} ${t.verified + t.incomplete + t.violated + t.unknown}`).join(', ')}`}>
        {timeline.map((t, i) => {
          const total = t.verified + t.incomplete + t.violated + t.unknown
          return (
            <Tooltip
              key={t.hour}
              className="h-[150px] min-w-[8px] flex-1"
              content={
                <span className="font-mono">
                  {hhmm(t.hour)} UTC · {total} actions · {t.verified} verified · {t.incomplete} incomplete · {t.violated} violated · {t.unknown} unknown
                </span>
              }
            >
              <div className="flex h-[150px] w-full flex-col-reverse justify-start" tabIndex={0} aria-label={`${hhmm(t.hour)}: ${total} actions`}>
                {HEALTH_KEYS.map((k) =>
                  t[k] > 0 ? (
                    <span
                      key={k}
                      className="block w-full first:rounded-b-[2px] last:rounded-t-[2px]"
                      style={{ height: (t[k] / max) * H, background: HEALTH_COLOR[k], opacity: k === 'verified' ? 0.55 : 0.9, transformOrigin: 'bottom', animation: `rg-fade-up 500ms cubic-bezier(0.22,1,0.36,1) ${i * 35}ms backwards` }}
                    />
                  ) : null,
                )}
              </div>
            </Tooltip>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1.5 font-mono text-[10px] text-ink-3">
        {timeline.map((t, i) => (
          <span key={t.hour} className="min-w-[8px] flex-1 text-center">
            {i % 2 === 0 ? hhmm(t.hour).slice(0, 2) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function RiskDistribution({ dist, total }: { dist: Overview['risk_distribution']; total: number }) {
  const rows: (Severity | 'none')[] = ['critical', 'high', 'medium', 'low', 'none']
  const max = Math.max(1, ...rows.map((r) => dist[r]))
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r} className="grid grid-cols-[92px_1fr_32px] items-center gap-3">
          {r === 'none' ? <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-sage-ink">✓ no findings</span> : <SeverityBadge severity={r} />}
          <span className="h-2 overflow-hidden rounded-full bg-s3">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(dist[r] / max) * 100}%`,
                background: r === 'critical' ? 'rgb(var(--crimson))' : r === 'high' ? 'rgb(var(--copper))' : r === 'medium' ? 'rgb(var(--amber))' : r === 'none' ? 'rgb(var(--sage) / 0.7)' : 'rgb(var(--fog))',
                transition: `width 800ms cubic-bezier(0.22,1,0.36,1) ${i * 60}ms`,
              }}
            />
          </span>
          <span className="tnum text-right font-mono text-[12px] text-ink-2">{dist[r]}</span>
        </li>
      ))}
      <li className="pt-1 font-mono text-[10.5px] text-ink-3">{total} actions, each counted once by its most severe finding</li>
    </ul>
  )
}

function DimensionHealth({ rows, total }: { rows: Overview['dimension_health']; total: number }) {
  const order: CheckResult[] = ['PASS', 'WARN', 'UNKNOWN', 'FAIL', 'SKIPPED']
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Verification results per invariant across all actions</caption>
      <thead>
        <tr>
          <th scope="col" className="eyebrow pb-2 font-normal">Invariant</th>
          <th scope="col" className="eyebrow pb-2 font-normal">Distribution</th>
          <th scope="col" className="eyebrow pb-2 text-right font-normal">Fail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.dimension} className="border-t hairline">
            <th scope="row" className="py-2 pr-3 text-[12.5px] font-normal text-ink-2">{r.label}</th>
            <td className="w-[55%] py-2">
              <span className="flex h-2.5 overflow-hidden rounded-[2px] bg-s3" role="img" aria-label={order.map((k) => `${r[k]} ${k}`).join(', ')}>
                {order.map((k) => (r[k] > 0 ? <span key={k} title={`${r[k]} ${k}`} style={{ width: `${(r[k] / total) * 100}%`, background: RESULT_COLOR[k], opacity: k === 'PASS' ? 0.6 : 0.95 }} /> : null))}
              </span>
            </td>
            <td className={cx('tnum py-2 text-right font-mono text-[12px]', r.FAIL ? 'text-crimson-ink' : 'text-ink-3')}>{r.FAIL ? `✕ ${r.FAIL}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RecentActions({ rows }: { rows: ChainRow[] }) {
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.action_id} className="border-b hairline last:border-0">
          <Link to={`/app/chains/${encodeURIComponent(r.action_id)}`} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-s2 md:grid-cols-[52px_minmax(0,1.6fr)_minmax(0,1fr)_120px_110px]">
            <span className="font-mono text-[11.5px] text-ink-3">{hhmm(r.timestamp)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
              {r.root_name ? <span className="truncate text-ink-2">{r.root_name}</span> : <span className="inline-flex items-center gap-1 text-amber-ink"><IconViolation size={13} /> no root</span>}
              <span className="text-ink-4" aria-hidden>→</span>
              <span className="truncate text-ink">{r.actor_name ?? 'unknown'}</span>
            </span>
            <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-ink-3 md:block">
              {r.operation} · {r.resource_name}
            </span>
            <span className="hidden md:block">
              <DecisionBadge decision={r.derived_decision} recorded={r.recorded_decision} />
            </span>
            <HealthBadge health={r.health} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
