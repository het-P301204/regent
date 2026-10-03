import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileDown, Pause, Play, SkipForward, Crosshair, ArrowLeft } from 'lucide-react'
import { api, download } from '../lib/api'
import { stamp, scopeText } from '../lib/format'
import { wsKey } from '../lib/queries'
import { useSession } from '../lib/session'
import { useReducedMotion } from '../lib/prefs'
import type { ChainDetail as Detail, ReplayStep } from '../lib/types'
import { IconEvidence, IconReplay, IconChain, IconVerification } from '../brand/icons'
import { CodeBlock, CopyButton } from '../ui/data'
import { ErrorState, LoadingState } from '../ui/feedback'
import { Button, cx, KV, LinkButton, PageHeader, Panel, Tabs } from '../ui/primitives'
import { AuthorityDiff, ScopeChips } from '../ui/scope'
import { DecisionBadge, HealthBadge, ResultBadge, SeverityBadge, RESULT_COLOR } from '../ui/status'
import { AuthorityFlow } from '../viz/AuthorityFlow'
import { ChainStrip } from '../viz/ChainStrip'
import { DelegationGraph } from '../viz/DelegationGraph'
import type { Selection } from '../viz/DelegationGraph'
import { chainGraph, flowStages } from '../viz/model'
import type { GraphEdge } from '../viz/model'

type Tab = 'graph' | 'replay' | 'evidence'

export default function ChainDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'graph'
  const q = useQuery({ queryKey: wsKey('chain', id), queryFn: () => api.get<Detail>(`/api/chains/${encodeURIComponent(id)}`) })
  const [selection, setSelection] = useState<Selection>(null)
  const graph = useMemo(() => (q.data ? chainGraph(q.data) : null), [q.data])
  const stages = useMemo(() => (q.data ? flowStages(q.data) : []), [q.data])
  const { can } = useSession()

  // Open on the first broken edge, so the reason for the verdict is the first thing shown.
  useEffect(() => {
    if (!graph) return
    const broken = graph.edges.find((e) => e.broken)
    setSelection(broken ? { kind: 'edge', edge: broken } : null)
  }, [graph])

  if (q.isLoading) return <LoadingState label="Reconstructing chain" />
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />
  const d = q.data!
  const v = d.verification
  const row = d.row
  const amp = d.findings.find((f) => f.authority_delta && f.action_id === v.action_id) ?? d.findings.find((f) => f.authority_delta)
  const lastHop = v.chain.hops[v.chain.hops.length - 1]

  return (
    <>
      <Link to="/app/chains" className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-2">
        <ArrowLeft size={13} /> Chains
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Action</span>
            <span className="font-mono normal-case tracking-normal text-ink-2">{v.event_id}</span>
            <CopyButton text={v.event_id} label="Copy id" />
            <span>· {stamp(v.timestamp)}</span>
          </span>
        }
        title={
          <>
            {row.actor_name ?? 'Unknown actor'} <span className="text-ink-3">{d.action.operation ?? 'acted on'}</span> {row.resource_name ?? 'an unrecorded resource'}
          </>
        }
        description={
          v.chain.root_principal_id
            ? `Authorized by ${row.root_name} through ${v.chain.hops.length} delegation hop${v.chain.hops.length === 1 ? '' : 's'}, executed by ${d.tool?.display_name ?? d.action.tool_id ?? 'an unrecorded tool'} as ${d.action.execution_identity_id ?? 'an unrecorded identity'}.`
            : 'REGENT cannot trace this action to a root principal. The gaps are listed below; nothing is assumed.'
        }
        actions={
          <>
            <HealthBadge health={row.health} />
            <DecisionBadge decision={v.derived_decision} recorded={v.recorded_decision} />
            <LinkButton to={`/app/investigate/${encodeURIComponent(v.event_id)}`} size="sm" icon={<Crosshair size={13} />}>
              Investigate
            </LinkButton>
            {can('auditor') ? (
              <Button size="sm" icon={<FileDown size={13} />} onClick={() => download(`/api/reports/investigation/${encodeURIComponent(v.event_id)}.pdf`)}>
                Report
              </Button>
            ) : null}
          </>
        }
      />

      {/* Signature: the authority stream for this action. */}
      <Panel
        title="Authority flow"
        eyebrow={amp?.type === 'AUTHORITY_AMPLIFICATION' ? 'Authority expands where no delegation conveyed it' : 'Authority should only narrow from principal to action'}
        className="mb-4"
        bodyClassName="px-3 pb-3 pt-1 sm:px-6"
      >
        <AuthorityFlow stages={stages} height={250} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <Tabs<Tab>
            label="Chain views"
            value={tab}
            onChange={(t) => setParams((p) => (p.set('tab', t), p), { replace: true })}
            tabs={[
              { id: 'graph', label: <span className="inline-flex items-center gap-1.5"><IconChain size={14} /> Delegation graph</span> },
              { id: 'replay', label: <span className="inline-flex items-center gap-1.5"><IconReplay size={14} /> Action replay</span>, count: d.replay?.steps.length },
              { id: 'evidence', label: <span className="inline-flex items-center gap-1.5"><IconEvidence size={14} /> Evidence</span> },
            ]}
            className="mb-3"
          />
          {tab === 'graph' && graph ? (
            <>
              <div className="hidden sm:block">
                <DelegationGraph nodes={graph.nodes} edges={graph.edges} selection={selection} onSelect={setSelection} height={660} />
              </div>
              <Panel className="sm:hidden" title="Delegation chain" eyebrow="Tap an edge for its reason">
                <ChainStrip nodes={graph.nodes} edges={graph.edges} onSelectEdge={(e) => setSelection({ kind: 'edge', edge: e })} onSelectNode={(n) => setSelection({ kind: 'node', node: n })} selectedId={selection?.kind === 'edge' ? selection.edge.id : selection?.kind === 'node' ? selection.node.id : null} />
              </Panel>
            </>
          ) : null}
          {tab === 'replay' && d.replay && graph ? <ReplayView detail={d} graphEdges={graph.edges} nodes={graph.nodes} /> : null}
          {tab === 'evidence' ? <EvidenceView detail={d} /> : null}
        </div>

        <aside className="min-w-0 space-y-4" aria-label="Inspector">
          <Inspector selection={selection} detail={d} labels={new Map((graph?.nodes ?? []).map((n) => [n.id, n.label]))} onClear={() => setSelection(null)} />
          <Panel title="Locate the broken edge" eyebrow="First point where an invariant breaks" bodyClassName="px-3 py-2">
            {graph ? <ChainStrip nodes={graph.nodes} edges={graph.edges} onSelectEdge={(e) => setSelection({ kind: 'edge', edge: e })} onSelectNode={(n) => setSelection({ kind: 'node', node: n })} selectedId={selection?.kind === 'edge' ? selection.edge.id : selection?.kind === 'node' ? selection.node.id : null} /> : null}
          </Panel>
        </aside>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WhyPanel detail={d} />
        <Panel title="Authority diff" eyebrow="Granted vs requested vs effective vs exercised">
          <AuthorityDiff
            available={lastHop ? lastHop.available_scope : undefined}
            granted={lastHop?.granted_scope ?? null}
            requested={v.requested_scope}
            effective={v.effective_scope}
            exercised={v.exercised_scope}
            excess={amp?.authority_delta?.excess ?? []}
          />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Verification checks" eyebrow={`Overall ${v.overall}`} bodyClassName="p-0">
          <ul>
            {v.checks.map((c) => (
              <li key={c.dimension} className="grid grid-cols-[150px_86px_1fr] items-start gap-3 border-b hairline px-4 py-2.5 last:border-0">
                <span className="text-[12.5px] text-ink">{c.label}</span>
                <ResultBadge result={c.result} />
                <span className="text-[12px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                  {c.detail}
                  <span className="ml-1.5 font-mono text-[10px] text-ink-4">{c.rule_ids.join(' ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Findings" eyebrow={d.findings.length ? `${d.findings.length} on this chain` : 'None'} bodyClassName="p-0">
          {d.findings.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-sage-ink">✓ No findings. Every invariant held for this action.</p>
          ) : (
            <ul>
              {d.findings.map((f) => (
                <li key={f.finding_id} className="border-b hairline last:border-0">
                  <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="block px-4 py-3 hover:bg-s2">
                    <span className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="text-[13px] text-ink">{f.title}</span>
                      <span className="font-mono text-[10.5px] text-ink-3">{f.rule_id}</span>
                    </span>
                    <span className="mt-1 block text-[12px] text-ink-2">{f.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Delegation hops" eyebrow="Each hop as a contract" bodyClassName="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
        {v.chain.hops.length === 0 ? <p className="text-[12.5px] text-ink-3">No delegation hops. {v.chain.resolution === 'direct' ? 'The root principal acted directly.' : 'No delegation to the actor could be reconstructed.'}</p> : null}
        {v.chain.hops.map((h) => {
          const name = (id: string | null) => d.principals.find((p) => p.principal_id === id)?.display_name ?? id ?? 'unknown'
          return (
            <Link key={h.delegation_id} to={`/app/delegations/${encodeURIComponent(h.delegation_id)}`} className={cx('block rounded border p-3.5 transition-colors hover:bg-s2', h.result === 'FAIL' ? 'border-crimson/50' : 'hairline-strong')}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10.5px] text-ink-3">HOP {h.hop_index + 1} · {h.delegation_id}</span>
                <ResultBadge result={h.result} />
              </div>
              <div className="mt-2 text-[13px] text-ink">
                {name(h.delegator_principal_id)} <span className="text-ink-3">delegates to</span> {name(h.delegatee_principal_id)}
              </div>
              <div className="mt-2 space-y-1.5 text-[11.5px]">
                <div className="flex gap-2"><span className="w-[64px] shrink-0 text-ink-3">Granted</span><ScopeChips scope={h.granted_scope} highlight={h.amplified} /></div>
                <div className="flex gap-2"><span className="w-[64px] shrink-0 text-ink-3">Effective</span><ScopeChips scope={h.effective_scope} /></div>
              </div>
              <div className="mt-2 text-[11.5px] text-ink-3">{h.reasons[0]}</div>
            </Link>
          )
        })}
      </Panel>
    </>
  )
}

function Inspector({ selection, detail, labels, onClear }: { selection: Selection; detail: Detail; labels: Map<string, string>; onClear: () => void }) {
  if (!selection) {
    return (
      <Panel title="Inspector" eyebrow="Select a node or edge">
        <p className="text-[12.5px] leading-relaxed text-ink-2">Select any principal, tool, identity or resource in the graph to inspect it, or any edge to see the authority on each side and the reason for its result.</p>
        <div className="mt-3">
          <KV rows={[['Root', detail.row.root_name ?? 'not established'], ['Resolution', detail.verification.chain.resolution], ['Effective', scopeText(detail.verification.effective_scope)], ['Exercised', scopeText(detail.verification.exercised_scope)]]} />
        </div>
      </Panel>
    )
  }
  if (selection.kind === 'node') {
    const n = selection.node
    return (
      <Panel title={n.label} eyebrow={n.role} actions={<button onClick={onClear} className="text-[11.5px] text-ink-3 hover:text-ink">Clear</button>} className="anim-fade-up">
        <div className="mb-3 flex items-center gap-2">
          <ResultBadge result={n.status} />
          <span className="id">{n.sublabel}</span>
        </div>
        {n.scope !== undefined ? (
          <div className="mb-3">
            <div className="eyebrow mb-1">Effective authority</div>
            <ScopeChips scope={n.scope} />
            {n.excess && n.excess.length ? (
              <div className="mt-2">
                <div className="eyebrow mb-1 text-crimson-ink">Granted without being held</div>
                <ScopeChips scope={n.excess} tone="excess" />
              </div>
            ) : null}
          </div>
        ) : null}
        <KV rows={n.meta} />
        {n.id.startsWith('p:') && !n.id.startsWith('p:unknown') ? (
          <Link to={`/app/identities/${encodeURIComponent(n.id.slice(2))}`} className="mt-3 inline-block text-[12px] text-copper-ink hover:underline">
            Open in identity registry →
          </Link>
        ) : null}
      </Panel>
    )
  }
  const e: GraphEdge = selection.edge
  const name = (id: string) => labels.get(id) ?? id.replace(/^p:/, '')
  return (
    <Panel title={e.kind.replace(/_/g, ' ')} eyebrow={e.broken ? 'First broken edge' : 'Edge'} actions={<button onClick={onClear} className="text-[11.5px] text-ink-3 hover:text-ink">Clear</button>} className={cx('anim-fade-up', e.broken && 'border-crimson/50')}>
      <div className="mb-3 flex items-center gap-2">
        <ResultBadge result={e.result} />
        <span className="text-[12.5px] text-ink">
          {name(e.source)} <span className="text-ink-3">→</span> {name(e.target)}
        </span>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">{e.reason}</p>
      {e.hop ? (
        <KV
          rows={[
            ['Delegator authority', <ScopeChips key="a" scope={e.hop.available_scope} />],
            ['Delegated authority', <ScopeChips key="g" scope={e.hop.granted_scope} highlight={e.hop.amplified} />],
            ['Requested', <ScopeChips key="r" scope={detail.delegations.find((x) => x.delegation_id === e.hop!.delegation_id)?.requested_scope ?? null} />],
            ['Effective', <ScopeChips key="e" scope={e.hop.effective_scope} />],
            ['Decision', e.hop.result === 'FAIL' ? 'Invariant broken at this hop' : 'Within the delegator\'s authority'],
            ['Policy', e.hop.policy_id ? `${e.hop.policy_id} v${e.hop.policy_version ?? '?'}` : 'not recorded'],
            ['Timestamp', stamp(e.hop.created_at)],
            ['Approval', e.hop.approval_state],
            ['At action time', e.hop.temporal],
            ['Downstream result', detail.action.downstream_result ?? 'not recorded'],
          ]}
        />
      ) : (
        <KV
          rows={[
            ['Requested', <ScopeChips key="r" scope={detail.verification.requested_scope} />],
            ['Actual (exercised)', <ScopeChips key="x" scope={detail.verification.exercised_scope} />],
            ['Effective', <ScopeChips key="e" scope={detail.verification.effective_scope} />],
            ['Decision', <DecisionBadge key="d" decision={detail.verification.derived_decision} recorded={detail.verification.recorded_decision} />],
            ['Policy', detail.action.policy_id ? `${detail.action.policy_id} v${detail.action.policy_version ?? '?'}` : 'not recorded'],
            ['Timestamp', stamp(detail.action.timestamp)],
            ['Approval', detail.action.approval_state],
            ['Downstream result', detail.action.downstream_result ?? 'not recorded'],
          ]}
        />
      )}
    </Panel>
  )
}

function WhyPanel({ detail }: { detail: Detail }) {
  const e = detail.explanation
  if (!e) return null
  const glyph = { pass: '✓', fail: '✕', warn: '!', neutral: '·' }
  const tone = { pass: 'text-sage-ink', fail: 'text-crimson-ink', warn: 'text-amber-ink', neutral: 'text-ink-3' }
  return (
    <Panel title={e.question} eyebrow="Why did this happen? · generated from the evidence, not a model">
      <p className="font-display text-[22px] leading-snug text-ink">{e.headline}</p>
      <ol className="mt-4 space-y-2">
        {e.steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-[13px] leading-relaxed anim-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
            <span className={cx('mt-[1px] w-3 shrink-0 text-center font-mono', tone[s.tone])} aria-label={s.tone}>
              {glyph[s.tone]}
            </span>
            <span className={s.tone === 'fail' ? 'text-ink' : 'text-ink-2'}>{s.text}</span>
          </li>
        ))}
      </ol>
      <p className={cx('mt-4 border-l-2 pl-3 text-[13px] leading-relaxed', e.verdict === 'allowed' ? 'border-sage text-sage-ink' : e.verdict === 'unverifiable' ? 'border-amber text-amber-ink' : e.verdict === 'refused' ? 'border-sage text-ink-2' : 'border-crimson text-ink')}>{e.conclusion}</p>
    </Panel>
  )
}

function ReplayView({ detail, graphEdges, nodes }: { detail: Detail; graphEdges: GraphEdge[]; nodes: ReturnType<typeof chainGraph>['nodes'] }) {
  const replay = detail.replay!
  const steps = replay.steps
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) return
    timer.current = window.setTimeout(() => {
      if (i >= steps.length - 1) setPlaying(false)
      else setI(i + 1)
    }, reduced ? 300 : 1100)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [playing, i, steps.length, reduced])
  const step: ReplayStep | undefined = steps[i]
  const edge = step?.edge ? matchEdge(step, graphEdges) : null
  const atViolation = replay.violation_index !== null && i >= replay.violation_index
  const fmt = (ms: number | null) => {
    if (ms === null) return '--:--'
    const s = Math.round(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel
        title="Timeline"
        eyebrow={`Step ${i + 1} of ${steps.length}${replay.violation_index !== null ? ` · first violation at step ${replay.violation_index + 1}` : ''}`}
        actions={
          <div className="flex items-center gap-1" role="toolbar" aria-label="Replay controls">
            <Button size="sm" variant="ghost" aria-label="Step backward" onClick={() => (setPlaying(false), setI(Math.max(0, i - 1)))} disabled={i === 0}>
              <ChevronLeft size={14} />
            </Button>
            <Button size="sm" variant={playing ? 'secondary' : 'primary'} aria-label={playing ? 'Pause' : 'Play'} onClick={() => (i >= steps.length - 1 && !playing ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </Button>
            <Button size="sm" variant="ghost" aria-label="Step forward" onClick={() => (setPlaying(false), setI(Math.min(steps.length - 1, i + 1)))} disabled={i >= steps.length - 1}>
              <ChevronRight size={14} />
            </Button>
            {replay.violation_index !== null ? (
              <Button size="sm" variant="danger" onClick={() => (setPlaying(false), setI(replay.violation_index!))} icon={<SkipForward size={13} />}>
                Jump to violation
              </Button>
            ) : null}
          </div>
        }
        bodyClassName="p-0"
      >
        <ol className="relative" aria-live="polite">
          {steps.map((s, k) => {
            const shown = k <= i
            const current = k === i
            const isViolation = k === replay.violation_index
            return (
              <li key={k}>
                <button
                  onClick={() => (setPlaying(false), setI(k))}
                  className={cx('grid w-full grid-cols-[62px_14px_1fr] gap-3 border-b hairline px-4 py-2.5 text-left transition-[opacity,background-color] duration-300', current ? 'bg-s2' : 'hover:bg-s2', shown ? 'opacity-100' : 'opacity-30')}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="pt-0.5 font-mono text-[11px] text-ink-3">{fmt(s.offset_ms)}</span>
                  <span className="relative flex justify-center pt-1.5">
                    <span className={cx('h-2.5 w-2.5 rounded-full', isViolation && shown && 'anim-pulse-crimson')} style={{ background: shown ? RESULT_COLOR[s.status] : 'rgb(var(--ink-4))' }} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cx('text-[12.5px]', isViolation ? 'text-crimson-ink' : 'text-ink')}>{s.title}</span>
                      {shown ? <ResultBadge result={s.status} compact /> : null}
                      {isViolation && shown ? <span className="font-mono text-[9.5px] font-semibold tracking-[0.12em] text-crimson-ink">VIOLATION</span> : null}
                    </span>
                    {current ? <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-2 anim-fade-up">{s.detail}</span> : null}
                    <span className="mt-0.5 block font-mono text-[10px] text-ink-4">{s.at ? stamp(s.at, true) : 'untimed'}</span>
                  </span>
                </button>
              </li>
            )
          })}
          {replay.untimed.map((s, k) => (
            <li key={`u${k}`} className="grid grid-cols-[62px_14px_1fr] gap-3 border-b hairline px-4 py-2.5 opacity-70">
              <span className="font-mono text-[11px] text-ink-4">untimed</span>
              <span className="pt-1.5"><span className="block h-2.5 w-2.5 rounded-full border border-ink-4" /></span>
              <span className="text-[12px] text-ink-3">{s.title} — not timestamped in the evidence; shown without inventing a time.</span>
            </li>
          ))}
        </ol>
      </Panel>
      <div className="min-w-0">
        <DelegationGraph nodes={nodes} edges={graphEdges} selection={edge ? { kind: 'edge', edge } : null} onSelect={() => {}} height={520} />
        <p className={cx('mt-2 text-[12px]', atViolation ? 'text-crimson-ink' : 'text-ink-3')}>
          {edge ? `Highlighted: ${edge.kind.replace(/_/g, ' ')} edge — ${edge.reason}` : 'This step has no edge in the graph.'}
        </p>
      </div>
    </div>
  )
}

function matchEdge(step: ReplayStep, edges: GraphEdge[]): GraphEdge | null {
  const e = step.edge!
  switch (e.kind) {
    case 'DELEGATES':
      return edges.find((x) => x.kind === 'DELEGATES' && x.source === `p:${e.from}` && x.target === `p:${e.to}`) ?? null
    case 'INVOKES':
      return edges.find((x) => x.kind === 'INVOKES') ?? null
    case 'EXECUTES_AS':
      return edges.find((x) => x.kind === 'EXECUTES_AS') ?? null
    case 'AUTHENTICATES_WITH':
      return edges.find((x) => x.kind === 'AUTHENTICATES_WITH') ?? null
    case 'TARGETS':
      return edges.find((x) => x.kind === 'TARGETS') ?? null
    case 'GOVERNED_BY':
      return edges.find((x) => x.kind === 'GOVERNED_BY') ?? null
  }
}

function EvidenceView({ detail }: { detail: Detail }) {
  const c = detail.verification.record_completeness
  const refs = detail.findings.flatMap((f) => f.evidence).filter((e, i, a) => a.findIndex((x) => x.kind === e.kind && x.id === e.id) === i)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Record completeness" eyebrow={c.schema_id}>
        <div className="flex items-end gap-3">
          <span className={cx('text-[40px] font-light leading-none', c.critical_missing.length ? 'text-crimson-ink' : c.missing.length ? 'text-amber-ink' : 'text-sage-ink')}>{c.percent}%</span>
          <span className="mb-1 font-mono text-[11px] text-ink-3">
            {c.present.length} present ÷ {c.required_count} expected
          </span>
        </div>
        {c.missing.length ? (
          <div className="mt-4">
            <div className="eyebrow mb-1.5">Missing</div>
            <ul className="flex flex-wrap gap-1.5">
              {c.missing.map((m) => (
                <li key={m} className={cx('scope-chip', c.critical_missing.includes(m) ? 'border-crimson/55 text-crimson-ink' : 'border-amber/45 text-amber-ink')}>
                  {m}
                  {c.critical_missing.includes(m) ? ' · critical' : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-sage-ink">✓ Every expected field is recorded.</p>
        )}
        <div className="mt-5">
          <div className="eyebrow mb-1.5 flex items-center gap-1.5"><IconVerification size={13} /> Evidence references</div>
          {refs.length === 0 ? <p className="text-[12px] text-ink-3">No findings reference evidence for this action.</p> : null}
          <ul className="space-y-1.5">
            {refs.map((r) => (
              <li key={`${r.kind}:${r.id}`} className="flex items-center gap-2 rounded border hairline px-2.5 py-1.5">
                <span className="w-[110px] shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{r.kind.replace('_', ' ')}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">{r.id}</span>
                <span className="hidden font-mono text-[10px] text-ink-4 sm:block" title={r.digest ?? ''}>{r.digest?.slice(7, 19)}</span>
                <CopyButton text={r.id} label="Copy" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">Digests are SHA-256 over the normalized record. They show whether a record changed after ingestion; they are not signatures.</p>
        </div>
      </Panel>
      <Panel title="Source action record" eyebrow="Normalized, as stored">
        <CodeBlock value={detail.action} maxHeight={520} />
      </Panel>
    </div>
  )
}
