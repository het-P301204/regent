import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, FileDown, Search } from 'lucide-react'
import { api, download } from '../lib/api'
import { wsKey } from '../lib/queries'
import { useSession } from '../lib/session'
import { FINDING_LABEL, stamp } from '../lib/format'
import type { ChainRow, FindingView, Investigation } from '../lib/types'
import { Button, LinkButton, PageHeader, Panel, Tooltip, cx } from '../ui/primitives'
import { CopyButton } from '../ui/data'
import { FindingStatusBadge, HealthBadge, ResultBadge, SeverityBadge } from '../ui/status'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { IconAgent, IconAttribution, IconChain, IconHuman, IconReplay, IconResource } from '../brand/icons'
import { ChainPath, TimeCell } from '../components/chains/ChainPath'
import { AuthoritySequence } from '../components/investigation/AuthoritySequence'
import { ExplanationView, ReplayTimeline } from '../components/investigation/ReplayTimeline'

type InvestigationResponse = Omit<Investigation, 'findings'> & {
  findings: FindingView[]
  names: Record<string, string>
  tools: Record<string, string>
  resources: Record<string, string>
}

export default function Investigate() {
  const { event = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()
  const [draft, setDraft] = useState(event)
  useEffect(() => setDraft(event), [event])

  const q = useQuery({ queryKey: wsKey('investigation', event), queryFn: () => api.get<InvestigationResponse>(`/api/investigations/${encodeURIComponent(event)}`), enabled: !!event })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = draft.trim()
    if (v) navigate(`/app/investigate/${encodeURIComponent(v)}`)
  }

  const canReport = can('auditor')
  const d = q.data

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Verify · Incident response"
        title="Investigate"
        description="Start from one event and reconstruct who authorized it, how authority was delegated, what executed, and every other action that shares that authority."
        actions={
          d ? (
            <>
              <LinkButton to={`/app/chains/${encodeURIComponent(d.action_id)}`} icon={<IconChain size={14} />}>
                Open chain
              </LinkButton>
              {canReport ? (
                <Button variant="primary" icon={<FileDown size={14} />} onClick={() => download(`/api/reports/investigation/${encodeURIComponent(d.event_id)}.pdf`)}>
                  Generate investigation report
                </Button>
              ) : (
                <Tooltip content="Generating reports requires the auditor role.">
                  <Button variant="primary" icon={<FileDown size={14} />} disabled aria-describedby="report-role-note">
                    Generate investigation report
                  </Button>
                  <span id="report-role-note" className="sr-only">
                    Requires the auditor role.
                  </span>
                </Tooltip>
              )}
            </>
          ) : null
        }
      />

      <form onSubmit={submit} role="search" aria-label="Investigate an event" className="panel anim-fade-up mb-5 flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="eyebrow">Event id</span>
          <span className="relative flex">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="evt-… or an action id"
              spellCheck={false}
              autoComplete="off"
              className="h-8 w-full min-w-0 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 pl-8 pr-2.5 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-4 hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper"
            />
          </span>
        </label>
        <Button type="submit" variant={event ? 'secondary' : 'primary'} disabled={!draft.trim()} icon={<ArrowRight size={14} />}>
          Investigate event
        </Button>
      </form>

      {!event ? (
        <Suggestions />
      ) : q.isLoading ? (
        <LoadingState label="Reconstructing the incident" />
      ) : q.isError ? (
        <div>
          <ErrorState error={q.error} retry={() => q.refetch()} />
          <Suggestions />
        </div>
      ) : d ? (
        <Report d={d} />
      ) : null}
    </div>
  )
}

function Suggestions() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: wsKey('chains', 'list', 'health=violated&limit=6'), queryFn: () => api.get<{ total: number; rows: ChainRow[] }>('/api/chains?health=violated&limit=6') })
  return (
    <section aria-labelledby="suggested-title" className="anim-fade-up" style={{ animationDelay: '60ms' }}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="suggested-title" className="text-[13px] font-medium text-ink">
          Recent violated events
        </h2>
        {q.data && q.data.total > q.data.rows.length ? (
          <Link to="/app/chains?health=violated" className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            All {q.data.total} violated chains
          </Link>
        ) : null}
      </div>
      {q.isLoading ? (
        <LoadingState label="Finding violated events" className="min-h-[120px]" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data || q.data.rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No violated chains in this dataset"
            body="Enter any event id above to investigate it, or browse every chain to pick one."
            action={<LinkButton to="/app/chains">Browse chains</LinkButton>}
          />
        </div>
      ) : (
        <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.rows.map((r, i) => (
            <li key={r.action_id} className="anim-fade-up" style={{ animationDelay: `${80 + i * 40}ms` }}>
              <button
                type="button"
                onClick={() => navigate(`/app/investigate/${encodeURIComponent(r.event_id)}`)}
                className="panel flex h-full w-full min-w-0 flex-col gap-1.5 px-3.5 py-3 text-left transition-colors hover:border-[rgb(var(--line-strong)/0.22)] hover:bg-s2"
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="id truncate text-ink">{r.event_id}</span>
                  <HealthBadge health={r.health} className="shrink-0" />
                </span>
                <ChainPath path={r.path} rootKnown={r.root_principal_id !== null} nowrap className="w-full" />
                <span className="flex w-full min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
                  <TimeCell ts={r.timestamp} />
                  {r.worst_severity ? <SeverityBadge severity={r.worst_severity} /> : null}
                  <span className="ml-auto truncate">{r.resource_name ?? ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Report({ d }: { d: InvestigationResponse }) {
  const principal = (id: string | null | undefined) => (id ? (d.names[id] ?? id) : null)
  const tool = (id: string | null | undefined) => (id ? (d.tools[id] ?? id) : null)
  const resource = (id: string | null | undefined) => (id ? (d.resources[id] ?? id) : null)
  const v = d.verification
  const attribution = v.checks.find((c) => c.dimension === 'attribution')

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="anim-fade-up flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-y hairline py-2.5">
        <span className="eyebrow">Event</span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="id text-ink">{d.event_id}</span>
          <CopyButton text={d.event_id} label="Copy event ID" />
        </span>
        {d.action_id !== d.event_id ? <span className="font-mono text-[11px] text-ink-3">action {d.action_id}</span> : null}
        <span className="font-mono text-[11.5px] text-ink-3">{stamp(v.timestamp, true)}</span>
        <span className="ml-auto">
          <ResultBadge result={v.overall} />
        </span>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title="From principal to result" eyebrow="Who · authorized · delegated · executed · resource · result" id="sequence">
          <AuthoritySequence inv={d} principal={principal} tool={tool} resource={resource} />
        </Panel>
        <Panel title="Explanation" eyebrow="Why the engine reached this verdict" id="explanation">
          <ExplanationView ex={d.explanation} />
        </Panel>
      </div>

      <Panel title="Timeline" eyebrow="Action replay" id="timeline" actions={<IconReplay size={16} className="text-ink-3" />}>
        <ReplayTimeline replay={d.replay} />
      </Panel>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Root attribution" eyebrow="Who is accountable" id="root" actions={<IconAttribution size={16} className="text-ink-3" />}>
          {d.root_principal_id ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <IconHuman size={16} className="shrink-0 text-ink-2" />
                <Link to={`/app/identities/${encodeURIComponent(d.root_principal_id)}`} className="min-w-0 text-[13.5px] text-ink underline-offset-2 hover:text-copper-ink hover:underline [overflow-wrap:anywhere]">
                  {principal(d.root_principal_id)}
                </Link>
              </div>
              <div className="id mt-0.5 text-[11px] text-ink-3">{d.root_principal_id}</div>
            </div>
          ) : (
            <p className="text-[13px] italic text-fog-ink">No root principal established.</p>
          )}
          {attribution ? (
            <div className="mt-3 border-t hairline pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-ink-3">{attribution.label}</span>
                <ResultBadge result={attribution.result} />
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{attribution.detail}</p>
            </div>
          ) : null}
          {v.chain.breaks.length > 0 ? (
            <p className="mt-2 text-[11.5px] text-amber-ink">
              <span aria-hidden>! </span>
              {v.chain.breaks.length} chain {v.chain.breaks.length === 1 ? 'break' : 'breaks'} recorded
            </p>
          ) : null}
        </Panel>

        <Panel title="Findings" eyebrow="Authority violations and evidence gaps" id="findings" bodyClassName="p-0">
          {d.findings.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] leading-relaxed text-ink-3">The engine raised no findings for this event.</p>
          ) : (
            <ul>
              {d.findings.map((f) => (
                <li key={f.finding_id} className="border-b hairline last:border-b-0">
                  <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="block min-w-0 px-4 py-2.5 transition-colors hover:bg-s2 focus-visible:bg-s2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={f.severity} />
                      <FindingStatusBadge status={f.status} />
                    </span>
                    <span className="mt-1 block text-[12.5px] font-medium leading-snug text-ink">{f.title}</span>
                    <span className="eyebrow mt-0.5 block">{FINDING_LABEL[f.type] ?? f.type}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Affected resources" eyebrow={`${d.affected_resources.length} total`} id="resources" bodyClassName="p-0">
          {d.affected_resources.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-ink-3">No resource recorded.</p>
          ) : (
            <ul>
              {d.affected_resources.map((rid) => (
                <li key={rid} className="border-b hairline last:border-b-0">
                  <Link to={`/app/chains?resource=${encodeURIComponent(rid)}`} className="flex min-w-0 items-center gap-2 px-4 py-2 transition-colors hover:bg-s2 focus-visible:bg-s2">
                    <IconResource size={14} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{resource(rid)}</span>
                      <span className="id block truncate text-[10.5px] text-ink-3">{rid}</span>
                    </span>
                    {rid === d.resource_id ? <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-copper-ink">this event</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Related agents" eyebrow={`${d.related_agents.length} total`} id="agents" bodyClassName="p-0">
          {d.related_agents.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-ink-3">No agent shares this chain or its related actions.</p>
          ) : (
            <ul>
              {d.related_agents.map((pid) => (
                <li key={pid} className="border-b hairline last:border-b-0">
                  <Link to={`/app/identities/${encodeURIComponent(pid)}`} className="flex min-w-0 items-center gap-2 px-4 py-2 transition-colors hover:bg-s2 focus-visible:bg-s2">
                    <IconAgent size={14} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{principal(pid)}</span>
                      <span className="id block truncate text-[10.5px] text-ink-3">{pid}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Related actions" eyebrow="Actions sharing a delegation, actor, identity, credential or parent event" id="related" bodyClassName="p-0">
        {d.related.length === 0 ? (
          <EmptyState title="No related actions" body="No other recorded action shares a delegation, actor, execution identity, credential or parent event with this one." className="py-8" action={<LinkButton to="/app/chains">Browse chains</LinkButton>} />
        ) : (
          <ul>
            {d.related.map((r, i) => (
              <li key={r.action_id} className="border-b hairline last:border-b-0 anim-fade-up" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <Link
                  to={`/app/chains/${encodeURIComponent(r.action_id)}`}
                  className="grid min-w-0 gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-s2 focus-visible:bg-s2 sm:grid-cols-[92px_minmax(0,1fr)_minmax(0,1.3fr)_104px] sm:items-center"
                >
                  <TimeCell ts={r.timestamp} />
                  <span className="min-w-0">
                    <span className="id block truncate text-ink">{r.event_id}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {principal(r.actor_principal_id) ?? 'actor not recorded'}
                      {r.resource_id ? <> › {resource(r.resource_id)}</> : null}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1">
                    {r.relation.map((rel) => (
                      <span key={rel} className={cx('inline-flex h-[19px] items-center rounded-[3px] border px-1.5 font-mono text-[10px]', rel === 'shares delegation' ? 'border-copper/40 text-copper-ink' : 'border-[rgb(var(--line-strong)/0.16)] text-ink-2')}>
                        {rel}
                      </span>
                    ))}
                  </span>
                  <HealthBadge health={r.health} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
