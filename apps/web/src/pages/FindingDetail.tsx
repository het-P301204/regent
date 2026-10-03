import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, Download } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { FINDING_LABEL, stamp } from '../lib/format'
import type { ChainRow, FindingView } from '../lib/types'
import { Button, KV, LinkButton, PageHeader, Panel } from '../ui/primitives'
import { CopyButton } from '../ui/data'
import { DecisionBadge, FindingStatusBadge, HealthBadge, SeverityBadge } from '../ui/status'
import { AuthorityDiff, ScopeChip } from '../ui/scope'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { IconAuthority, IconChain, IconEvidence, IconPolicy, IconResource } from '../brand/icons'
import { ChainPath, TimeCell } from '../components/chains/ChainPath'
import { EvidenceLocker } from '../components/findings/EvidenceLocker'
import type { EvidenceItem } from '../components/findings/EvidenceLocker'
import { TriagePanel } from '../components/findings/TriagePanel'

interface FindingDetailResponse {
  finding: FindingView
  related_actions: ChainRow[]
  evidence: EvidenceItem[]
  names: Record<string, string>
}

export default function FindingDetail() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: wsKey('findings', 'detail', id), queryFn: () => api.get<FindingDetailResponse>(`/api/findings/${encodeURIComponent(id)}`), enabled: !!id })

  if (q.isLoading) return <LoadingState label="Loading finding" />
  if (q.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={q.error} retry={() => q.refetch()} />
      </div>
    )
  }
  if (!q.data) {
    return (
      <div className="panel">
        <EmptyState title="Finding not found" body="No finding id was given." action={<LinkButton to="/app/findings">Back to findings</LinkButton>} />
      </div>
    )
  }

  const { finding: f, related_actions, evidence, names } = q.data
  const nm = (pid: string | null | undefined) => (pid ? (names[pid] ?? pid) : null)
  const primaryAction = related_actions.find((r) => r.action_id === f.action_id) ?? related_actions[0] ?? null
  const chainHref = f.action_id ? `/app/chains/${encodeURIComponent(f.action_id)}` : primaryAction ? `/app/chains/${encodeURIComponent(primaryAction.action_id)}` : null

  const exportEvidence = () => {
    const blob = new Blob([JSON.stringify({ finding: f, evidence }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `regent-finding-${f.finding_id.replace(/[^A-Za-z0-9._-]/g, '_')}-evidence.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="min-w-0">
      <BackLink />
      <PageHeader
        eyebrow={`Finding · ${FINDING_LABEL[f.type] ?? f.type}`}
        title={f.title}
        description={f.summary}
        actions={
          <>
            {primaryAction ? (
              <LinkButton to={`/app/investigate/${encodeURIComponent(primaryAction.event_id)}`} variant="ghost">
                Investigate event
              </LinkButton>
            ) : null}
            <Button onClick={exportEvidence} icon={<Download size={14} />}>
              Export evidence
            </Button>
          </>
        }
      />

      <div className="anim-fade-up -mt-2 mb-6 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-y hairline py-2.5">
        <SeverityBadge severity={f.severity} />
        <FindingStatusBadge status={f.status} />
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="id">{f.finding_id}</span>
          <CopyButton text={f.finding_id} label="Copy finding ID" />
        </span>
        <span className="font-mono text-[11.5px] text-ink-3">
          rule <span className="text-ink-2">{f.rule_id}</span>
        </span>
        <span className="font-mono text-[11.5px] text-ink-3">
          first seen <span className="text-ink-2">{stamp(f.first_seen)}</span>
        </span>
        {f.last_seen !== f.first_seen ? (
          <span className="font-mono text-[11.5px] text-ink-3">
            last seen <span className="text-ink-2">{stamp(f.last_seen)}</span>
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="What is wrong" eyebrow="Summary" id="summary" className="anim-fade-up">
            <p className="text-[13.5px] leading-relaxed text-ink">{f.summary}</p>
            <h3 className="eyebrow mb-1.5 mt-4">Root cause</h3>
            <p className="max-w-[72ch] text-[13px] leading-relaxed text-ink-2">{f.root_cause}</p>
          </Panel>

          {f.authority_delta ? (
            <Panel
              title="Authority delta"
              eyebrow="Held · granted · requested · effective · exercised"
              id="authority-delta"
              className="anim-fade-up"
              actions={<IconAuthority size={16} className="text-copper-ink" />}
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <p className="max-w-[64ch] text-[12.5px] leading-relaxed text-ink-2">
                  Each permission on its own row, across every stage of the delegation. A permission marked <span className="font-mono text-[11.5px] font-semibold text-crimson-ink">UNGRANTED</span> is in the engine's excess set: it went beyond what was available at that point in the chain. <span className="text-fog-ink">?</span> means the stage was not recorded, which is not the same as empty.
                </p>
                {f.authority_delta.excess.length > 0 ? (
                  <div className="min-w-0 rounded border border-crimson/40 bg-crimson/[0.07] px-3 py-2">
                    <div className="eyebrow text-crimson-ink">
                      <span aria-hidden>✕ </span>Excess authority
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {f.authority_delta.excess.map((p) => (
                        <ScopeChip key={p} perm={p} tone="excess" />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <AuthorityDiff
                available={f.authority_delta.available}
                granted={f.authority_delta.granted}
                requested={f.authority_delta.requested}
                effective={f.authority_delta.effective}
                exercised={f.authority_delta.exercised}
                excess={f.authority_delta.excess}
              />
            </Panel>
          ) : null}

          {f.broken_edge ? (
            <Panel title="Locate the broken edge" eyebrow="Where the invariant first broke" id="broken-edge" className="anim-fade-up">
              <BrokenEdge edge={f.broken_edge} nm={nm} chainHref={chainHref} />
            </Panel>
          ) : null}

          <Panel title="Remediation" eyebrow="What to change" id="remediation" className="anim-fade-up">
            <p className="max-w-[72ch] whitespace-pre-line text-[13px] leading-relaxed text-ink">{f.remediation}</p>
          </Panel>

          <Panel title="Related events" eyebrow={`${related_actions.length} ${related_actions.length === 1 ? 'action' : 'actions'}`} id="related" bodyClassName="p-0" className="anim-fade-up">
            {related_actions.length === 0 ? (
              <EmptyState title="No related events" body="The engine linked no recorded action to this finding. It may describe a registry record rather than an action." action={<LinkButton to="/app/chains">Browse chains</LinkButton>} className="py-8" />
            ) : (
              <ul>
                {related_actions.map((r) => (
                  <li key={r.action_id} className="border-b hairline last:border-b-0">
                    <Link to={`/app/chains/${encodeURIComponent(r.action_id)}`} className="grid min-w-0 gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-s2 focus-visible:bg-s2 sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center">
                      <TimeCell ts={r.timestamp} />
                      <span className="min-w-0">
                        <ChainPath path={r.path} rootKnown={r.root_principal_id !== null} />
                        <span className="id block text-[11px] text-ink-3">{r.event_id}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <DecisionBadge decision={r.derived_decision} recorded={r.recorded_decision} />
                        <HealthBadge health={r.health} />
                        <ArrowRight size={13} aria-hidden className="hidden text-ink-3 sm:block" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Evidence locker" eyebrow="The records this finding rests on" id="evidence" className="anim-fade-up" actions={<IconEvidence size={16} className="text-ink-3" />}>
            <EvidenceLocker finding={f} evidence={evidence} />
            <p className="mt-4 border-t hairline pt-3 text-[11.5px] leading-relaxed text-ink-3">Digests are SHA-256 over the normalized record; they detect change but are not signatures.</p>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Finding context">
          <TriagePanel finding={f} />

          <Panel title="Rule and policy" eyebrow="What was checked" id="rule">
            <KV
              rows={[
                [
                  'Rule',
                  <span key="r" className="inline-flex items-center gap-1.5 font-mono text-[12px]">
                    <IconPolicy size={13} className="text-ink-3" />
                    {f.rule_id}
                  </span>,
                ],
                ['Finding type', FINDING_LABEL[f.type] ?? f.type],
                ['Delegation', f.delegation_id ? <Link key="d" className="font-mono text-[12px] text-copper-ink underline-offset-2 hover:underline" to={`/app/delegations/${encodeURIComponent(f.delegation_id)}`}>{f.delegation_id}</Link> : <span className="text-ink-3">none</span>],
                ['Action', f.action_id ? <span key="a" className="font-mono text-[12px]">{f.action_id}</span> : <span className="text-ink-3">none</span>],
              ]}
            />
            <div className="mt-3">
              <LinkButton to="/app/policy" size="sm" variant="ghost" icon={<IconPolicy size={13} />}>
                Open policy engine
              </LinkButton>
            </div>
            {f.missing_fields.length > 0 ? (
              <div className="mt-4 border-t hairline pt-3">
                <h3 className="eyebrow mb-1.5 text-amber-ink">
                  <span aria-hidden>! </span>Missing from the record
                </h3>
                <ul className="flex flex-wrap gap-1">
                  {f.missing_fields.map((m) => (
                    <li key={m} className="scope-chip border-dashed border-amber/45 text-amber-ink">
                      {m}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11.5px] text-ink-3">Missing evidence makes a result unknown. It is not evidence of misuse.</p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Affected" eyebrow="Principals and resources" id="affected">
            <h3 className="eyebrow mb-1.5">Principals</h3>
            {f.affected_principal_ids.length === 0 ? (
              <p className="text-[12px] text-ink-3">None recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {f.affected_principal_ids.map((pid) => (
                  <li key={pid}>
                    <Link to={`/app/identities/${encodeURIComponent(pid)}`} className="group flex min-w-0 items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-s2">
                      <span className="min-w-0 truncate text-[12.5px] text-ink group-hover:text-copper-ink">{nm(pid)}</span>
                      <span className="ml-auto min-w-0 truncate font-mono text-[10.5px] text-ink-3">{pid}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="eyebrow mb-1.5 mt-4">Resources</h3>
            {f.affected_resource_ids.length === 0 ? (
              <p className="text-[12px] text-ink-3">None recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {f.affected_resource_ids.map((rid) => (
                  <li key={rid}>
                    <Link to={`/app/chains?resource=${encodeURIComponent(rid)}`} className="group flex min-w-0 items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-s2">
                      <IconResource size={14} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 truncate font-mono text-[12px] text-ink group-hover:text-copper-ink">{rid}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/app/findings" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft size={13} aria-hidden />
      All findings
    </Link>
  )
}

function EdgeEnd({ id, role, name }: { id: string | null; role: string; name: string | null }) {
  return (
    <div className="min-w-0 rounded-md border hairline bg-s2 px-3 py-2">
      <div className="eyebrow">{role}</div>
      {id ? (
        <>
          <div className="truncate text-[13px] text-ink">{name ?? id}</div>
          <div className="id truncate text-[11px] text-ink-3">{id}</div>
        </>
      ) : (
        <div className="text-[12.5px] italic text-fog-ink">not recorded</div>
      )}
    </div>
  )
}

function BrokenEdge({ edge, nm, chainHref }: { edge: NonNullable<FindingView['broken_edge']>; nm: (id: string | null | undefined) => string | null; chainHref: string | null }) {
  return (
    <div className="min-w-0">
      <div className="grid min-w-0 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <EdgeEnd id={edge.from} role="Delegator" name={nm(edge.from)} />
        <div className="relative flex h-10 items-center justify-center sm:h-auto" aria-hidden>
          <span className="absolute inset-x-0 top-1/2 hidden h-0 border-t-2 border-dashed border-copper/60 sm:block" />
          <span className="absolute inset-y-0 left-1/2 w-0 border-l-2 border-dashed border-copper/60 sm:hidden" />
          <span className="relative z-[1] inline-flex h-6 items-center gap-1 rounded-full border border-copper/60 bg-s1 px-2 font-mono text-[10px] font-semibold tracking-[0.08em] text-copper-ink">
            <IconChain size={11} />
            {edge.hop_index !== null ? `HOP ${edge.hop_index}` : 'EDGE'}
          </span>
        </div>
        <EdgeEnd id={edge.to} role="Delegatee" name={nm(edge.to)} />
      </div>
      <KV
        className="mt-4"
        rows={[
          ['Hop index', edge.hop_index !== null ? <span key="h" className="font-mono">{edge.hop_index} <span className="text-ink-3">(0 is the root delegation)</span></span> : <span className="text-ink-3">not located on a hop</span>],
          [
            'Delegation',
            edge.delegation_id ? (
              <span key="d" className="inline-flex flex-wrap items-center gap-1">
                <Link className="font-mono text-[12px] text-copper-ink underline-offset-2 hover:underline" to={`/app/delegations/${encodeURIComponent(edge.delegation_id)}`}>
                  {edge.delegation_id}
                </Link>
                <CopyButton text={edge.delegation_id} label="Copy delegation ID" />
              </span>
            ) : (
              <span className="text-fog-ink">not recorded</span>
            ),
          ],
        ]}
      />
      {chainHref ? (
        <div className="mt-4">
          <LinkButton to={chainHref} size="sm" variant="secondary" icon={<IconChain size={13} />}>
            Open the chain at this edge
          </LinkButton>
        </div>
      ) : null}
    </div>
  )
}
