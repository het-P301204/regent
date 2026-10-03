import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, FlaskConical, Hammer, Play, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import { afterDatasetChange, useActiveDataset, useRunVerification } from '../lib/queries'
import { useSession } from '../lib/session'
import { useReducedMotion } from '../lib/prefs'
import { plural } from '../lib/format'
import type { FindingType } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Tabs } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingState, useToast } from '../ui/feedback'
import { Metric } from '../ui/data'
import { IconChain } from '../brand/icons'
import { VerificationSequence } from '../viz/VerificationSequence'
import { FindingTypeBadge, findingLabel } from '../components/lab/findings'
import { totalFindings } from '../components/lab/run'
import type { ScenarioCard, ScenarioLoadResponse } from '../components/lab/run'

type Filter = 'all' | 'valid' | 'findings'

export default function Scenarios() {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useSession()
  const reduced = useReducedMotion()
  const { active } = useActiveDataset()
  const q = useQuery({ queryKey: ['scenarios'], queryFn: () => api.get<{ scenarios: ScenarioCard[] }>('/api/scenarios'), staleTime: 5 * 60_000 })
  const [filter, setFilter] = useState<Filter>('all')
  const [target, setTarget] = useState<ScenarioCard | null>(null)
  const benchRef = useRef<HTMLHeadingElement>(null)

  const load = useMutation({
    mutationFn: (s: ScenarioCard) => api.post<ScenarioLoadResponse>('/api/scenarios', { slug: s.slug }),
    onSuccess: async (res) => {
      await afterDatasetChange(qc)
      toast({ tone: 'success', title: `Scenario ${res.dataset.name.replace(/^Scenario /, '')} loaded`, body: res.matches_expected ? 'Produced findings match the expected set.' : 'Produced findings differ from the expected set.' })
    },
  })
  const rerun = useRunVerification()

  const start = (s: ScenarioCard) => {
    setTarget(s)
    load.mutate(s)
  }

  useEffect(() => {
    if (!target) return
    const el = benchRef.current
    if (!el) return
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }, [target, reduced])

  const activeSlug = active?.source === 'scenario' ? (active.source_metadata['slug'] as string | undefined) : undefined
  const all = q.data?.scenarios ?? []
  const shown = all.filter((s) => (filter === 'all' ? true : filter === 'valid' ? s.expected.length === 0 : s.expected.length > 0))

  return (
    <div>
      <PageHeader
        eyebrow="Build · Scenario lab"
        title="Scenario lab"
        description="Twelve synthetic scenarios, ordered as a curriculum. Each one isolates a single delegation property. Loading a scenario creates its own synthetic dataset, makes it active and verifies it with the same engine path as imported evidence. Your other datasets are untouched."
        actions={
          <LinkButton to="/app/builder" icon={<Hammer size={14} aria-hidden />}>
            Build your own chain
          </LinkButton>
        }
      />

      {target ? (
        <section aria-labelledby="bench-title" className="panel mb-6 overflow-hidden anim-fade-up">
          <header className="flex flex-col gap-3 border-b hairline px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="eyebrow mb-0.5">
                Scenario {String(target.number).padStart(2, '0')} · {load.isPending ? 'verifying' : load.isSuccess ? 'loaded and verified' : load.isError ? 'failed' : 'ready'}
              </div>
              <h2 id="bench-title" ref={benchRef} tabIndex={-1} className="text-[15px] font-medium text-ink outline-none">
                {target.title}
              </h2>
            </div>
            <VerificationSequence running={load.isPending} done={load.isSuccess} failed={load.isError} />
          </header>
          {load.isPending ? (
            <p className="px-4 py-5 text-[12.5px] text-ink-2">
              Creating a synthetic dataset from {plural(target.record_count, 'record')} and running every verification rule against it.
            </p>
          ) : load.isError ? (
            <ErrorState error={load.error} retry={() => load.mutate(target)} className="my-4 border-0 bg-transparent" />
          ) : load.isSuccess ? (
            <ScenarioResult res={load.data} canAnalyze={can('analyst')} rerunning={rerun.isPending} onRerun={() => rerun.mutate(undefined, { onSuccess: () => toast({ tone: 'success', title: 'Verification complete', body: 'The active scenario dataset was verified again.' }), onError: (e) => toast({ tone: 'error', title: 'Verification failed', body: e instanceof Error ? e.message : undefined }) })} />
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="curriculum-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="curriculum-title" className="sr-only">
            Curriculum
          </h2>
          <Tabs
            label="Filter scenarios"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All scenarios', count: all.length },
              { id: 'valid', label: 'Valid chains', count: all.filter((s) => s.expected.length === 0).length },
              { id: 'findings', label: 'Produce findings', count: all.filter((s) => s.expected.length > 0).length },
            ]}
            className="flex-1"
          />
          <p className="text-[11.5px] text-ink-3">
            <Badge tone="fog" className="mr-1.5">Synthetic</Badge>
            Every record is invented. No scenario touches real identities.
          </p>
        </div>

        {q.isLoading ? (
          <LoadingState label="Loading scenarios" />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState icon={<FlaskConical size={22} aria-hidden />} title="No scenarios available" body="The API returned an empty scenario list. Build a chain by hand instead, or reload once the API is updated." action={<LinkButton to="/app/builder">Open the chain builder</LinkButton>} />
        ) : shown.length === 0 ? (
          <EmptyState title="No scenarios match this filter" action={<Button onClick={() => setFilter('all')}>Show all scenarios</Button>} />
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Scenarios in curriculum order">
            {shown.map((s, i) => {
              const isActive = activeSlug === s.slug
              const isTarget = target?.slug === s.slug
              return (
                <li key={s.slug} className="min-w-0 anim-fade-up" style={{ animationDelay: reduced ? undefined : `${Math.min(i, 11) * 35}ms` }}>
                  <article aria-labelledby={`sc-${s.slug}`} className={cx('panel flex h-full flex-col p-4 transition-colors', isTarget && load.isPending ? 'border-copper/50' : 'hover:border-[rgb(var(--line-strong)/0.2)]')}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="tnum font-mono text-[22px] font-light leading-none text-ink-3" aria-label={`Scenario ${s.number}`}>
                        {String(s.number).padStart(2, '0')}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {isActive ? <Badge tone="copper">Active dataset</Badge> : null}
                        {s.expected.length === 0 ? <Badge tone="neutral">Valid chain</Badge> : null}
                      </div>
                    </div>
                    <h3 id={`sc-${s.slug}`} className="mt-3 text-[14px] font-medium leading-snug text-ink">
                      {s.title}
                    </h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{s.summary}</p>
                    <div className="mt-3 border-l-2 border-copper/40 pl-3">
                      <div className="eyebrow mb-0.5">Teaches</div>
                      <p className="text-[12px] leading-relaxed text-ink-2">{s.teaches}</p>
                    </div>
                    <div className="mt-3">
                      <div className="eyebrow mb-1.5">Expected findings</div>
                      {s.expected.length === 0 ? (
                        <span className="text-[12px] text-ink-2">No findings expected</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1" aria-label="Expected finding types">
                          {s.expected.map((t) => (
                            <li key={t}>
                              <FindingTypeBadge type={t} neutral />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="min-h-3 flex-1" aria-hidden />
                    <div className="flex items-center justify-between gap-3 border-t hairline pt-3">
                      <span className="font-mono text-[10.5px] text-ink-3">
                        {s.record_count} synthetic records · {s.focus_event}
                      </span>
                      <Button size="sm" variant={isTarget && load.isPending ? 'primary' : 'secondary'} icon={<Play size={12} aria-hidden />} loading={isTarget && load.isPending} disabled={load.isPending && !isTarget} onClick={() => start(s)} aria-label={`Load scenario ${s.number}: ${s.title}`}>
                        Load scenario
                      </Button>
                    </div>
                  </article>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

function ScenarioResult({ res, canAnalyze, onRerun, rerunning }: { res: ScenarioLoadResponse; canAnalyze: boolean; onRerun: () => void; rerunning: boolean }) {
  const types = [...new Set<FindingType>([...res.expected, ...res.produced])].sort()
  const s = res.summary
  return (
    <div className="anim-fade-up">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="border-b hairline p-4 md:border-b-0 md:border-r">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-ink">Produced vs expected</h3>
            {res.matches_expected ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-sage-ink">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]" aria-hidden>
                  ✓
                </span>
                Matches expected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-amber-ink">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]" aria-hidden>
                  !
                </span>
                Differs from expected
              </span>
            )}
          </div>
          {types.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">No findings expected and none produced. Every chain in this scenario is attributable and contained.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Finding types expected by the scenario and produced by the engine</caption>
              <thead>
                <tr>
                  <th scope="col" className="eyebrow pb-2 font-normal">Finding type</th>
                  <th scope="col" className="eyebrow w-[84px] pb-2 text-center font-normal">Expected</th>
                  <th scope="col" className="eyebrow w-[84px] pb-2 text-center font-normal">Produced</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const e = res.expected.includes(t)
                  const p = res.produced.includes(t)
                  return (
                    <tr key={t} className="border-t hairline">
                      <th scope="row" className="py-1.5 pr-2 font-normal">
                        <FindingTypeBadge type={t} neutral={!p} />
                      </th>
                      <td className="py-1.5 text-center font-mono text-[12px]">{e ? <span aria-label="expected">●</span> : <span className="text-ink-4" aria-label="not expected">·</span>}</td>
                      <td className="py-1.5 text-center font-mono text-[12px]">
                        {p ? <span aria-label="produced">●</span> : <span className="text-ink-4" aria-label="not produced">·</span>}
                        {e !== p ? <span className="ml-1 text-amber-ink" title={e ? 'Expected but not produced' : 'Produced but not expected'}>!</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[11.5px] text-ink-3">
            Comparison returned by the API for dataset <span className="id">{res.dataset.id}</span>, run <span className="id">{res.run_id}</span>.
          </p>
        </div>
        <div className="grid grid-cols-2 [&>div]:border-b [&>div]:hairline">
          <div className="border-r hairline">
            <Metric label="Actions verified" value={s.total_actions} sub={`${s.attributable_actions} attributable`} />
          </div>
          <div>
            <Metric label="Findings" value={totalFindings(s)} sub={Object.keys(s.findings_by_type).map(findingLabel).join(', ') || 'none'} />
          </div>
          <div className="border-r hairline">
            <Metric label="Authority violations" value={s.authority_violations} tone={s.authority_violations > 0 ? 'crimson' : 'neutral'} sub={`${s.amplification_events} amplification events`} />
          </div>
          <div>
            <Metric label="Unattributable" value={s.unattributable_actions} tone={s.unattributable_actions > 0 ? 'amber' : 'neutral'} sub={`${s.broken_chains} broken chains`} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t hairline px-4 py-3">
        <LinkButton to={`/app/chains/${encodeURIComponent(res.focus_event)}`} variant="primary" icon={<IconChain size={14} />}>
          Inspect chain
        </LinkButton>
        <LinkButton to="/app/findings" icon={<ShieldAlert size={14} aria-hidden />}>
          View findings
        </LinkButton>
        <Button onClick={onRerun} loading={rerunning} disabled={!canAnalyze} title={canAnalyze ? 'Verify the active dataset again' : 'Requires the analyst role'} icon={<Play size={13} aria-hidden />}>
          Run verification
        </Button>
        <LinkButton to="/app/reports" variant="ghost" icon={<FileText size={14} aria-hidden />}>
          Export report
        </LinkButton>
        {!canAnalyze ? <span className="text-[11.5px] text-ink-3">Running verification again requires the analyst role.</span> : null}
      </div>
    </div>
  )
}
