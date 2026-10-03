import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import type { ChainRow, CheckResult, Health, Severity } from '../lib/types'
import { Button, LinkButton, PageHeader, Select, cx } from '../ui/primitives'
import { DataTable } from '../ui/data'
import type { Column } from '../ui/data'
import { DecisionBadge, HealthBadge, SeverityBadge } from '../ui/status'
import { ScopeChip } from '../ui/scope'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { IconChain } from '../brand/icons'
import { ChainPath, TimeCell } from '../components/chains/ChainPath'
import { HealthMap } from '../components/chains/HealthMap'
import { useResponsiveColumns } from '../components/chains/responsive'

interface Facet {
  id: string
  name: string
}
interface ChainsResponse {
  total: number
  offset: number
  limit: number
  rows: ChainRow[]
  facets: { actors: Facet[]; roots: Facet[]; resources: Facet[]; tools: Facet[]; policies: string[] }
}

const FILTER_KEYS = ['health', 'root', 'actor', 'resource', 'tool', 'policy', 'severity', 'attribution', 'authority', 'q'] as const
type FilterKey = (typeof FILTER_KEYS)[number]
const SECONDARY: FilterKey[] = ['tool', 'policy', 'severity', 'attribution', 'authority']
const LIMIT = 1000

const HEALTH_OPTS: { v: Health; label: string }[] = [
  { v: 'violated', label: 'Violated' },
  { v: 'incomplete', label: 'Incomplete' },
  { v: 'unknown', label: 'Unknown' },
  { v: 'verified', label: 'Verified' },
]
const SEVERITY_OPTS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const AUTHORITY_OPTS: { v: CheckResult; label: string }[] = [
  { v: 'FAIL', label: 'Fail' },
  { v: 'WARN', label: 'Warn' },
  { v: 'UNKNOWN', label: 'Unknown' },
  { v: 'PASS', label: 'Pass' },
  { v: 'SKIPPED', label: 'Skipped' },
]
const SORT_OPTS = [
  { v: 'time_desc', label: 'Newest first' },
  { v: 'time_asc', label: 'Oldest first' },
  { v: 'risk', label: 'Violated first' },
]

const LABEL: Record<FilterKey, string> = {
  health: 'Health',
  root: 'Human principal',
  actor: 'Agent',
  resource: 'Resource',
  tool: 'Tool',
  policy: 'Policy',
  severity: 'Worst severity',
  attribution: 'Attribution',
  authority: 'Authority check',
  q: 'Search',
}

export default function Chains() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of FILTER_KEYS) {
      const v = sp.get(k)
      if (v) p.set(k, v)
    }
    const sort = sp.get('sort')
    if (sort) p.set('sort', sort)
    p.set('limit', String(LIMIT))
    return p.toString()
  }, [sp])
  const filtered = FILTER_KEYS.some((k) => !!sp.get(k))

  const list = useQuery({ queryKey: wsKey('chains', 'list', apiQuery), queryFn: () => api.get<ChainsResponse>(`/api/chains?${apiQuery}`), placeholderData: keepPreviousData })
  const all = useQuery({ queryKey: wsKey('chains', 'all'), queryFn: () => api.get<ChainsResponse>(`/api/chains?sort=time_asc&limit=${LIMIT}`) })
  const facets = all.data?.facets ?? list.data?.facets

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value) next.set(key, value)
    else next.delete(key)
    setSp(next, { replace: true })
  }
  const clearAll = () => {
    const next = new URLSearchParams(sp)
    for (const k of FILTER_KEYS) next.delete(k)
    setSp(next, { replace: true })
  }

  // Search text: local while typing, written to the URL after a pause.
  const urlQ = sp.get('q') ?? ''
  const [draft, setDraft] = useState(urlQ)
  useEffect(() => setDraft(urlQ), [urlQ])
  useEffect(() => {
    if (draft === urlQ) return
    const t = setTimeout(() => setParam('q', draft.trim() || null), 280)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const [more, setMore] = useState(() => SECONDARY.some((k) => !!sp.get(k)))
  useEffect(() => {
    if (SECONDARY.some((k) => !!sp.get(k))) setMore(true)
  }, [sp])

  const matched = useMemo(() => (filtered && list.data ? new Set(list.data.rows.map((r) => r.action_id)) : null), [filtered, list.data])
  const open = (r: ChainRow) => navigate(`/app/chains/${encodeURIComponent(r.action_id)}`)

  const nameOf = (key: FilterKey, v: string): string => {
    const pick = (xs: Facet[] | undefined) => xs?.find((x) => x.id === v)?.name ?? v
    if (key === 'root') return pick(facets?.roots)
    if (key === 'actor') return pick(facets?.actors)
    if (key === 'resource') return pick(facets?.resources)
    if (key === 'tool') return pick(facets?.tools)
    if (key === 'attribution') return v === 'attributable' ? 'Attributable' : 'Unattributable'
    if (key === 'authority') return AUTHORITY_OPTS.find((o) => o.v === v)?.label ?? v
    if (key === 'health' || key === 'severity') return v.charAt(0).toUpperCase() + v.slice(1)
    return v
  }

  const columns = useResponsiveColumns<ChainRow>([
    { key: 'time', header: 'Time (UTC)', width: '92px', cell: (r) => <TimeCell ts={r.timestamp} /> },
    {
      key: 'path',
      header: 'Delegation path',
      width: 'minmax(0,1.5fr)',
      cell: (r) => (
        <div className="min-w-0">
          <ChainPath path={r.path} rootKnown={r.root_principal_id !== null} nowrap />
          <div className="truncate font-mono text-[10.5px] text-ink-3" title={r.event_id}>
            {r.event_id}
          </div>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Tool › resource',
      width: 'minmax(0,1.1fr)',
      hideBelow: 'md',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ink-2" title={r.tool_id ?? undefined}>
            {r.tool_name ?? <span className="italic text-fog-ink">tool not recorded</span>}
          </div>
          <div className="truncate text-[11.5px] text-ink-3" title={r.resource_id ?? undefined}>
            <span aria-hidden>› </span>
            {r.resource_name ?? <span className="italic text-fog-ink">resource not recorded</span>}
            {r.operation ? <span className="font-mono text-[10.5px] text-ink-4"> · {r.operation}</span> : null}
          </div>
        </div>
      ),
    },
    { key: 'scope', header: 'Exercised scope', width: 'minmax(0,1fr)', hideBelow: 'lg', cell: (r) => <ScopeSummary scope={r.exercised_scope} /> },
    { key: 'decision', header: 'Derived decision', width: '148px', hideBelow: 'lg', cell: (r) => <DecisionBadge decision={r.derived_decision} recorded={r.recorded_decision} /> },
    { key: 'health', header: 'Health', width: '100px', cell: (r) => <HealthBadge health={r.health} /> },
    {
      key: 'findings',
      header: 'Findings',
      width: '118px',
      hideBelow: 'sm',
      cell: (r) =>
        r.finding_count === 0 ? (
          <span className="font-mono text-[11.5px] text-ink-4">
            <span aria-hidden>—</span>
            <span className="sr-only">No findings</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="tnum font-mono text-[12px] text-ink">{r.finding_count}</span>
            {r.worst_severity ? <SeverityBadge severity={r.worst_severity} /> : null}
          </span>
        ),
    },
  ] satisfies Column<ChainRow>[])

  const active = FILTER_KEYS.filter((k) => !!sp.get(k))

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Verify · Delegation chains"
        title="Chains"
        description="Every action traced from its human principal through each delegation hop to the resource it touched, with the engine's verdict on each chain."
        actions={<LinkButton to="/app/investigate" icon={<Search size={14} />}>Investigate an event</LinkButton>}
      />

      {all.isLoading ? (
        <LoadingState label="Reconstructing chains" />
      ) : all.isError ? (
        <ErrorState error={all.error} retry={() => all.refetch()} />
      ) : all.data && all.data.total === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<IconChain size={28} />}
            title="No actions in this dataset"
            body="The active dataset has no recorded actions, so there are no delegation chains to reconstruct. Run a scenario or import events to verify."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/app/scenarios" variant="primary">Open the scenario lab</LinkButton>
                <LinkButton to="/app/import">Import events</LinkButton>
              </div>
            }
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {all.data ? (
            <div className="anim-fade-up">
              <HealthMap rows={all.data.rows} matched={matched} onOpen={open} />
              {all.data.total > all.data.rows.length ? <p className="mt-1.5 text-[11.5px] text-ink-3">The map shows the first {all.data.rows.length} of {all.data.total} chains.</p> : null}
            </div>
          ) : null}

          <section aria-label="Filter chains" className="panel anim-fade-up p-3" style={{ animationDelay: '50ms' }}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
              <div className="col-span-2 sm:col-span-3 lg:col-span-1">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="eyebrow">Search</span>
                  <span className="relative flex">
                    <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      type="search"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Event id, principal, tool, resource"
                      className="h-8 w-full min-w-0 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper"
                    />
                  </span>
                </label>
              </div>
              <Select label="Health" value={sp.get('health') ?? ''} onChange={(e) => setParam('health', e.target.value || null)}>
                <option value="">All health</option>
                {HEALTH_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <FacetSelect label="Human principal" all="All principals" value={sp.get('root')} options={facets?.roots} onChange={(v) => setParam('root', v)} />
              <FacetSelect label="Agent" all="All agents" value={sp.get('actor')} options={facets?.actors} onChange={(v) => setParam('actor', v)} />
              <FacetSelect label="Resource" all="All resources" value={sp.get('resource')} options={facets?.resources} onChange={(v) => setParam('resource', v)} />
              <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
                <Select label="Sort" className="flex-1" value={sp.get('sort') ?? 'time_desc'} onChange={(e) => setParam('sort', e.target.value === 'time_desc' ? null : e.target.value)}>
                  {SORT_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant={more ? 'secondary' : 'ghost'}
                  icon={<SlidersHorizontal size={13} />}
                  aria-expanded={more}
                  aria-controls="chains-more-filters"
                  onClick={() => setMore((m) => !m)}
                >
                  More
                  {SECONDARY.filter((k) => sp.get(k)).length ? <span className="tnum font-mono text-[10.5px] text-copper-ink">{SECONDARY.filter((k) => sp.get(k)).length}</span> : null}
                </Button>
              </div>
            </div>

            {more ? (
              <div id="chains-more-filters" className="mt-2.5 grid grid-cols-2 gap-2.5 border-t hairline pt-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <FacetSelect label="Tool" all="All tools" value={sp.get('tool')} options={facets?.tools} onChange={(v) => setParam('tool', v)} />
                <FacetSelect label="Policy" all="All policies" value={sp.get('policy')} options={facets?.policies.map((p) => ({ id: p, name: p }))} onChange={(v) => setParam('policy', v)} />
                <Select label="Worst severity" value={sp.get('severity') ?? ''} onChange={(e) => setParam('severity', e.target.value || null)}>
                  <option value="">Any severity</option>
                  {SEVERITY_OPTS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </Select>
                <Select label="Attribution" value={sp.get('attribution') ?? ''} onChange={(e) => setParam('attribution', e.target.value || null)}>
                  <option value="">Any attribution</option>
                  <option value="attributable">Attributable to a root principal</option>
                  <option value="unattributable">No root principal established</option>
                </Select>
                <Select label="Authority check" value={sp.get('authority') ?? ''} onChange={(e) => setParam('authority', e.target.value || null)}>
                  <option value="">Any result</option>
                  {AUTHORITY_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {active.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t hairline pt-2.5">
                <span className="eyebrow mr-1">Active</span>
                {active.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setParam(k, null)}
                    className="group inline-flex h-6 max-w-full items-center gap-1.5 rounded-[3px] border border-copper/40 bg-copper/10 px-2 text-[11.5px] text-copper-ink transition-colors hover:bg-copper/20"
                    aria-label={`Remove filter ${LABEL[k]}: ${nameOf(k, sp.get(k)!)}`}
                  >
                    <span className="text-ink-3">{LABEL[k]}</span>
                    <span className="min-w-0 truncate">{nameOf(k, sp.get(k)!)}</span>
                    <X size={11} aria-hidden className="shrink-0 opacity-70 group-hover:opacity-100" />
                  </button>
                ))}
                <button type="button" onClick={clearAll} className="ml-1 text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                  Clear all filters
                </button>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="chains-table-title" className="panel min-w-0 anim-fade-up overflow-hidden" style={{ animationDelay: '100ms' }}>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-4 py-2.5">
              <h2 id="chains-table-title" className="text-[13px] font-medium text-ink">
                {list.data ? (
                  <>
                    <span className="tnum">{list.data.total}</span> {list.data.total === 1 ? 'chain' : 'chains'}
                    {filtered && all.data ? <span className="font-normal text-ink-3"> of {all.data.total}</span> : null}
                  </>
                ) : (
                  'Chains'
                )}
              </h2>
              <span className={cx('text-[11.5px] text-ink-3 transition-opacity', list.isFetching ? 'opacity-100' : 'opacity-0')} aria-live="polite">
                {list.isFetching ? 'Updating' : ''}
              </span>
            </header>
            {list.isError ? (
              <ErrorState error={list.error} retry={() => list.refetch()} className="my-4" />
            ) : !list.data ? (
              <LoadingState label="Filtering chains" />
            ) : (
              <>
                <DataTable
                  rows={list.data.rows}
                  columns={columns}
                  rowKey={(r) => r.action_id}
                  onRowClick={open}
                  caption="Delegation chains. Select a row to open the chain."
                  height={600}
                  empty={
                    <EmptyState
                      title="No chains match these filters"
                      body="Nothing in the active dataset satisfies every filter at once. Remove a filter to widen the result."
                      action={
                        <Button onClick={clearAll} icon={<X size={13} />}>
                          Clear all filters
                        </Button>
                      }
                    />
                  }
                />
                {list.data.total > list.data.rows.length ? (
                  <p className="border-t hairline px-4 py-2 text-[11.5px] text-ink-3">
                    Showing the first {list.data.rows.length} of {list.data.total}. Narrow the filters to see the rest.
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function FacetSelect({ label, all, value, options, onChange }: { label: string; all: string; value: string | null; options: Facet[] | undefined; onChange: (v: string | null) => void }) {
  const opts = options ?? []
  const missing = value && !opts.some((o) => o.id === value)
  return (
    <Select label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{all}</option>
      {missing ? <option value={value}>{value}</option> : null}
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  )
}

/** First two exercised permissions, then a count, so a row stays one line tall. */
function ScopeSummary({ scope }: { scope: string[] | null }) {
  if (scope === null) return <span className="font-mono text-[11px] italic text-fog-ink">not recorded</span>
  if (scope.length === 0) return <span className="font-mono text-[11px] text-ink-3">none</span>
  const shown = scope.slice(0, 2)
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden" title={scope.join(', ')}>
      {shown.map((p) => (
        <ScopeChip key={p} perm={p} />
      ))}
      {scope.length > 2 ? <span className="shrink-0 font-mono text-[10.5px] text-ink-3">+{scope.length - 2}</span> : null}
    </span>
  )
}
