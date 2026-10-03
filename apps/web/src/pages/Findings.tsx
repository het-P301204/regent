import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { FINDING_LABEL, stamp } from '../lib/format'
import type { FindingStatus, FindingView, Severity } from '../lib/types'
import { Button, LinkButton, PageHeader, Select, cx } from '../ui/primitives'
import { CopyButton } from '../ui/data'
import { FindingStatusBadge, SeverityBadge } from '../ui/status'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { IconAgent, IconResource, IconVerification } from '../brand/icons'
import { shortDigest } from '../components/chains/ChainPath'
import { FINDING_STATUSES } from '../components/findings/TriagePanel'

interface FindingsResponse {
  total: number
  findings: FindingView[]
  input_digest: string
  ruleset_version: string
}
interface Facet {
  id: string
  name: string
}
interface FacetsResponse {
  facets: { actors: Facet[]; roots: Facet[]; resources: Facet[] }
}

/** Server-side filters. `type` is applied on the client so the category row can count every type. */
const SERVER_KEYS = ['severity', 'status', 'rule', 'principal', 'resource', 'q'] as const
const ALL_KEYS = [...SERVER_KEYS, 'type'] as const
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const PAGE = 60

export default function Findings() {
  const [sp, setSp] = useSearchParams()

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of SERVER_KEYS) {
      const v = sp.get(k)
      if (v) p.set(k, v)
    }
    return p.toString()
  }, [sp])

  const q = useQuery({ queryKey: wsKey('findings', 'list', apiQuery), queryFn: () => api.get<FindingsResponse>(`/api/findings${apiQuery ? `?${apiQuery}` : ''}`), placeholderData: keepPreviousData })
  // Names for affected principals and resources; ids are shown if this is unavailable.
  const names = useQuery({ queryKey: wsKey('chains', 'facets'), queryFn: () => api.get<FacetsResponse>('/api/chains?limit=1'), staleTime: 60_000 })
  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    const f = names.data?.facets
    for (const x of [...(f?.roots ?? []), ...(f?.actors ?? []), ...(f?.resources ?? [])]) m.set(x.id, x.name)
    return m
  }, [names.data])

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value) next.set(key, value)
    else next.delete(key)
    setSp(next, { replace: true })
  }
  const clearAll = () => {
    const next = new URLSearchParams(sp)
    for (const k of ALL_KEYS) next.delete(k)
    setSp(next, { replace: true })
  }

  const urlQ = sp.get('q') ?? ''
  const [draft, setDraft] = useState(urlQ)
  useEffect(() => setDraft(urlQ), [urlQ])
  useEffect(() => {
    if (draft === urlQ) return
    const t = setTimeout(() => setParam('q', draft.trim() || null), 280)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const type = sp.get('type')
  const base = useMemo(() => q.data?.findings ?? [], [q.data])
  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of base) m.set(f.type, (m.get(f.type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (FINDING_LABEL[a[0]] ?? a[0]).localeCompare(FINDING_LABEL[b[0]] ?? b[0]))
  }, [base])
  const rules = useMemo(() => [...new Set(base.map((f) => f.rule_id))].sort(), [base])
  const shown = type ? base.filter((f) => f.type === type) : base

  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [apiQuery, type])

  const active = ALL_KEYS.filter((k) => !!sp.get(k))
  const labelFor = (k: (typeof ALL_KEYS)[number], v: string) => (k === 'type' ? (FINDING_LABEL[v] ?? v) : k === 'principal' || k === 'resource' ? (nameMap.get(v) ?? v) : v)

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Verify · Findings"
        title="Findings"
        description="Every invariant the engine found broken or unprovable, with the evidence that shows it and its triage status."
        actions={<LinkButton to="/app/chains?health=violated">Open violated chains</LinkButton>}
      />

      {q.isLoading ? (
        <LoadingState label="Loading findings" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data ? (
        <div className="flex min-w-0 flex-col gap-4">
          <p className="anim-fade-up -mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-3">
            <IconVerification size={13} className="shrink-0" />
            <span>From run</span>
            <span className="font-mono text-ink-2" title={q.data.input_digest}>
              input {shortDigest(q.data.input_digest, 10, 4)}
            </span>
            <CopyButton text={q.data.input_digest} label="Copy input digest" />
            <span aria-hidden>·</span>
            <span>
              rule set <span className="font-mono text-ink-2">{q.data.ruleset_version}</span>
            </span>
          </p>

          {byType.length > 0 || type ? (
            <section aria-label="Findings by category" className="anim-fade-up" style={{ animationDelay: '40ms' }}>
              <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
                <CategoryButton label="All categories" count={base.length} active={!type} onClick={() => setParam('type', null)} />
                {byType.map(([t, n]) => (
                  <CategoryButton key={t} label={FINDING_LABEL[t] ?? t} count={n} active={type === t} onClick={() => setParam('type', type === t ? null : t)} />
                ))}
                {type && !byType.some(([t]) => t === type) ? <CategoryButton label={FINDING_LABEL[type] ?? type} count={0} active onClick={() => setParam('type', null)} /> : null}
              </div>
            </section>
          ) : null}

          <section aria-label="Filter findings" className="panel anim-fade-up p-3" style={{ animationDelay: '80ms' }}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <label className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-4 lg:col-span-1">
                <span className="eyebrow">Search</span>
                <span className="relative flex">
                  <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="search"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Finding id, title or summary"
                    className="h-8 w-full min-w-0 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper"
                  />
                </span>
              </label>
              <Select label="Severity" value={sp.get('severity') ?? ''} onChange={(e) => setParam('severity', e.target.value || null)}>
                <option value="">Any severity</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
              <Select label="Status" value={sp.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || null)}>
                <option value="">Any status</option>
                {FINDING_STATUSES.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.v.charAt(0) + s.v.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
              <Select label="Rule" value={sp.get('rule') ?? ''} onChange={(e) => setParam('rule', e.target.value || null)} className="col-span-2 sm:col-span-1">
                <option value="">Any rule</option>
                {sp.get('rule') && !rules.includes(sp.get('rule') as FindingView['rule_id']) ? <option value={sp.get('rule')!}>{sp.get('rule')}</option> : null}
                {rules.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            {active.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t hairline pt-2.5">
                <span className="eyebrow mr-1">Active</span>
                {active.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setParam(k, null)}
                    className="group inline-flex h-6 max-w-full items-center gap-1.5 rounded-[3px] border border-copper/40 bg-copper/10 px-2 text-[11.5px] text-copper-ink transition-colors hover:bg-copper/20"
                    aria-label={`Remove filter ${k}: ${labelFor(k, sp.get(k)!)}`}
                  >
                    <span className="capitalize text-ink-3">{k === 'q' ? 'search' : k}</span>
                    <span className="min-w-0 truncate">{labelFor(k, sp.get(k)!)}</span>
                    <X size={11} aria-hidden className="shrink-0 opacity-70 group-hover:opacity-100" />
                  </button>
                ))}
                <button type="button" onClick={clearAll} className="ml-1 text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                  Clear all filters
                </button>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="findings-list-title" className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 id="findings-list-title" className="text-[13px] font-medium text-ink">
                <span className="tnum">{shown.length}</span> {shown.length === 1 ? 'finding' : 'findings'}
              </h2>
              <span className={cx('text-[11.5px] text-ink-3 transition-opacity', q.isFetching ? 'opacity-100' : 'opacity-0')} aria-live="polite">
                {q.isFetching ? 'Updating' : ''}
              </span>
            </div>
            {shown.length === 0 ? (
              <div className="panel">
                {active.length > 0 ? (
                  <EmptyState
                    title="No findings match these filters"
                    body="Nothing in the latest run satisfies every filter at once. Remove a filter to widen the result."
                    action={
                      <Button onClick={clearAll} icon={<X size={13} />}>
                        Clear all filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<IconVerification size={28} />}
                    title="The latest run raised no findings"
                    body="The enabled rules raised nothing for the recorded evidence. No findings is not the same as verified: chains with incomplete or unknown evidence can still be present."
                    action={<LinkButton to="/app/chains">Review chain health</LinkButton>}
                  />
                )}
              </div>
            ) : (
              <>
                <ul className="flex min-w-0 flex-col gap-2">
                  {shown.slice(0, limit).map((f, i) => (
                    <FindingCard key={f.finding_id} f={f} nameOf={(id) => nameMap.get(id) ?? id} delay={Math.min(i, 10) * 30} />
                  ))}
                </ul>
                {shown.length > limit ? (
                  <div className="mt-3 flex justify-center">
                    <Button onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more findings</Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

function CategoryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded border px-2.5 text-[12px] transition-colors',
        active ? 'border-copper/55 bg-copper/[0.12] text-ink' : 'border-[rgb(var(--line-strong)/0.14)] bg-s1 text-ink-2 hover:border-[rgb(var(--line-strong)/0.26)] hover:bg-s2 hover:text-ink',
      )}
    >
      {label}
      <span className={cx('tnum font-mono text-[11px]', active ? 'text-copper-ink' : 'text-ink-3')}>{count}</span>
    </button>
  )
}

const STATUS_FADED: FindingStatus[] = ['RESOLVED', 'SUPPRESSED']

function FindingCard({ f, nameOf, delay }: { f: FindingView; nameOf: (id: string) => string; delay: number }) {
  const agent = f.affected_principal_ids[f.affected_principal_ids.length - 1] ?? null
  const resource = f.affected_resource_ids[0] ?? null
  const href = `/app/findings/${encodeURIComponent(f.finding_id)}`
  return (
    <li
      className={cx('panel group relative min-w-0 px-4 py-3 transition-colors anim-fade-up hover:border-[rgb(var(--line-strong)/0.2)] hover:bg-s2 focus-within:bg-s2', STATUS_FADED.includes(f.status) && 'opacity-75')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <SeverityBadge severity={f.severity} />
        <span className="eyebrow">{FINDING_LABEL[f.type] ?? f.type}</span>
        <span className="font-mono text-[10.5px] text-ink-3">{f.rule_id}</span>
        <span className="ml-auto">
          <FindingStatusBadge status={f.status} />
        </span>
      </div>
      <h3 className="mt-1.5 text-[13.5px] font-medium leading-snug text-ink">
        <Link to={href} className="outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-copper-ink group-hover:text-ink">
          {f.title}
        </Link>
      </h3>
      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">{f.summary}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
        <span className="relative z-[1] inline-flex min-w-0 items-center gap-1">
          <span className="id text-[11px] text-ink-3">{f.finding_id}</span>
          <CopyButton text={f.finding_id} label="Copy ID" />
        </span>
        {agent ? (
          <span className="inline-flex min-w-0 items-center gap-1" title={agent}>
            <IconAgent size={12} className="shrink-0" />
            <span className="truncate text-ink-2">{nameOf(agent)}</span>
          </span>
        ) : null}
        {resource ? (
          <span className="inline-flex min-w-0 items-center gap-1" title={resource}>
            <IconResource size={12} className="shrink-0" />
            <span className="truncate text-ink-2">{nameOf(resource)}</span>
            {f.affected_resource_ids.length > 1 ? <span className="font-mono text-[10.5px]">+{f.affected_resource_ids.length - 1}</span> : null}
          </span>
        ) : null}
        <span className="font-mono text-[11px]">
          {f.first_seen === f.last_seen ? (
            <>seen {stamp(f.first_seen)}</>
          ) : (
            <>
              {stamp(f.first_seen)} <span aria-hidden>→</span>
              <span className="sr-only">to</span> {stamp(f.last_seen)}
            </>
          )}
        </span>
      </div>
    </li>
  )
}
