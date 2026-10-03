import { useId, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { afterDatasetChange, wsKey } from '../lib/queries'
import { useReducedMotion } from '../lib/prefs'
import type { ChainSpec, Decision, FindingView } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Panel } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { CodeBlock } from '../ui/data'
import { DecisionBadge, SeverityBadge } from '../ui/status'
import { VerificationSequence } from '../viz/VerificationSequence'
import { IconClock } from '../brand/icons'
import { CheckList, ExplanationSteps, FindingList, FindingTypeBadge } from '../components/lab/findings'
import type { BuilderVerifyResponse } from '../components/lab/run'

/**
 * Provision-time vs action-time authorization. The timeline is illustrative;
 * the verdict is the engine's. The UI maps the two times and the evaluation
 * mode onto the two ChainSpec booleans that decide the case, and renders the
 * run the engine returns.
 */

const SPAN = 120 // minutes shown, 09:00 to 11:00
const clock = (m: number) => `${String(9 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const WORD: Record<Decision, string> = { ALLOW: 'Authorized', DENY: 'Denied', CONDITIONAL: 'Conditional', UNKNOWN: 'Unknown' }

type Mode = 'cached' | 'action'

function specFor(revoked: boolean, cached: boolean): ChainSpec {
  return {
    name: 'Action-time authorization simulation',
    principals: [
      { id: 'human-alice', type: 'human', name: 'Alice', scope: ['customer.read'] },
      { id: 'agent-research', type: 'agent', name: 'ResearchAgent' },
    ],
    delegations: [{ from: 'human-alice', to: 'agent-research', granted: ['customer.read'], ...(revoked ? { revoked: true } : {}) }],
    actions: [{ actor: 'agent-research', tool: 'CustomerSearch', resource: 'CustomerDB', operation: 'read', requested: ['customer.read'], exercised: ['customer.read'], ...(cached ? { decision_cached_before_revocation: true } : {}) }],
  }
}

export default function ActionTime() {
  const [revokeAt, setRevokeAt] = useState(60)
  const [attemptAt, setAttemptAt] = useState(65)
  const [mode, setMode] = useState<Mode>('cached')
  // Revocation takes effect at the instant it is recorded, as in the engine.
  const revoked = attemptAt >= revokeAt
  const cached = mode === 'cached'
  const spec = useMemo(() => specFor(revoked, cached), [revoked, cached])
  const sim = useQuery({
    queryKey: ['action-time-sim', revoked, cached],
    queryFn: () => api.post<BuilderVerifyResponse>('/api/builder/verify', spec),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
  const v = sim.data?.run.actions[0]
  const exp = sim.data?.explanations[0] ?? null
  const evaluatedAt = cached ? 0 : attemptAt

  return (
    <div>
      <PageHeader
        eyebrow="Analyze · Action-time authorization"
        title="Provision-time vs action-time"
        description="A decision made when access was provisioned can outlive the authority behind it. Move the revocation and the attempt, choose when the decision is evaluated, and the engine verifies the resulting chain."
        actions={
          <LinkButton to="/app/scenarios" variant="ghost">
            Scenario 11 in the lab
          </LinkButton>
        }
      />

      <Panel title="Timeline" eyebrow="Illustrative · 09:00 to 11:00 UTC" id="at-timeline">
        <Timeline revokeAt={revokeAt} attemptAt={attemptAt} evaluatedAt={evaluatedAt} cached={cached} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TimeSlider label="Access revoked at" value={revokeAt} onChange={setRevokeAt} help="Alice revokes ResearchAgent's read access." />
          <TimeSlider label="Agent attempts the read at" value={attemptAt} onChange={setAttemptAt} help="ResearchAgent reads a customer record." />
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t hairline pt-4 lg:flex-row lg:items-start lg:justify-between">
          <ModeSwitch mode={mode} onChange={setMode} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => (setRevokeAt(60), setAttemptAt(65), setMode('cached'))}>
              Revoked 10:00, read 10:05, cached
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setRevokeAt(60), setAttemptAt(45), setMode('cached'))}>
              Read before revocation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setRevokeAt(60), setAttemptAt(65), setMode('action'))}>
              Re-evaluated at action time
            </Button>
          </div>
        </div>
      </Panel>

      <section aria-labelledby="at-verdict" className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="at-verdict" className="text-[15px] font-medium text-ink">
            Verdict
          </h2>
          <VerificationSequence running={sim.isFetching} done={!sim.isFetching && sim.isSuccess} failed={sim.isError && !sim.isFetching} />
        </div>
        {sim.isLoading ? (
          <LoadingState label="Verifying the simulated chain" className="min-h-[200px]" />
        ) : sim.isError && !sim.data ? (
          <ErrorState error={sim.error} retry={() => sim.refetch()} />
        ) : v && sim.data ? (
          <div className={cx('space-y-4 transition-opacity duration-200', sim.isFetching && 'opacity-60')} aria-busy={sim.isFetching}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
              <div className="panel p-4">
                <div className="eyebrow mb-2">Provision-time · recorded by the system</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[20px] font-light tracking-[-0.01em] text-ink">{WORD[v.recorded_decision ?? 'UNKNOWN']}</span>
                  {v.recorded_decision ? <DecisionBadge decision={v.recorded_decision} /> : <Badge tone="fog">not recorded</Badge>}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
                  The system under audit evaluated the decision at <span className="font-mono text-ink">{clock(evaluatedAt)}</span>
                  {cached ? ', when access was provisioned, and reused it for the attempt.' : ', when the attempt was made.'}
                </p>
              </div>
              <div className="hidden items-center justify-center font-mono text-[11px] tracking-[0.14em] text-ink-3 md:flex" aria-hidden>
                VS
              </div>
              <div className={cx('panel p-4', v.decision_agreement === 'DISAGREE' && 'border-crimson/50')}>
                <div className="eyebrow mb-2">Action-time · derived by REGENT</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('text-[20px] font-light tracking-[-0.01em]', v.derived_decision === 'DENY' ? 'text-crimson-ink' : v.derived_decision === 'ALLOW' ? 'text-ink' : 'text-amber-ink')}>{WORD[v.derived_decision]}</span>
                  <DecisionBadge decision={v.derived_decision} />
                </div>
                <ul className="mt-2 space-y-1">
                  {v.derived_decision_reasons.map((r, i) => (
                    <li key={i} className="text-[12.5px] leading-relaxed text-ink-2">
                      {r}
                    </li>
                  ))}
                </ul>
                <p className={cx('mt-2 text-[12px] font-medium', v.decision_agreement === 'AGREE' ? 'text-sage-ink' : v.decision_agreement === 'DISAGREE' ? 'text-crimson-ink' : 'text-fog-ink')}>
                  {v.decision_agreement === 'AGREE' ? '✓ Recorded and derived decisions agree' : v.decision_agreement === 'DISAGREE' ? '✕ Recorded and derived decisions disagree' : '? Agreement cannot be verified'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Produced finding" eyebrow="From the engine" id="at-finding">
                <FindingList findings={sim.data.run.findings} empty={<p className="text-[12.5px] leading-relaxed text-ink-2">The engine produced no finding for this attempt. Expect ACTION_TIME_AUTHORIZATION_FAILURE when a cached decision outlives a revocation, and STALE_DELEGATION when a decision evaluated after the revocation still allows the read.</p>} />
                <div className="mt-4 border-t hairline pt-3">
                  <h3 className="eyebrow mb-1">Time and authority checks</h3>
                  <CheckList checks={v.checks.filter((c) => c.dimension === 'temporal' || c.dimension === 'authority' || c.dimension === 'attribution')} />
                </div>
              </Panel>
              <Panel title="Why" eyebrow="Deterministic explanation" id="at-why">
                {exp ? <ExplanationSteps explanation={exp} /> : <p className="text-[12.5px] text-ink-3">No explanation was returned for this action.</p>}
              </Panel>
            </div>

            <details className="panel group px-4 py-3">
              <summary className="cursor-pointer list-none text-[12.5px] text-ink-2 hover:text-ink">
                <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                What the engine receives
              </summary>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
                The timeline above is illustrative. Built chains use a fixed synthetic clock: the delegation is issued at 09:00, a revocation is recorded at 09:25 and the attempt runs at 09:30. Your settings decide the two facts that matter: whether the attempt falls at or after the revocation (<span className="font-mono text-ink">delegation.revoked = {String(revoked)}</span>) and whether the decision was cached before it (<span className="font-mono text-ink">decision_cached_before_revocation = {String(cached)}</span>).
              </p>
              <CodeBlock value={spec} className="mt-3" maxHeight={280} />
            </details>
          </div>
        ) : (
          <EmptyState title="No result yet" body="The engine has not answered for these settings." action={<Button onClick={() => sim.refetch()}>Verify again</Button>} />
        )}
      </section>

      <RealExamples />
    </div>
  )
}

function Timeline({ revokeAt, attemptAt, evaluatedAt, cached }: { revokeAt: number; attemptAt: number; evaluatedAt: number; cached: boolean }) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/:/g, '')
  const W = 1000
  const x0 = 40
  const x1 = 960
  const X = (m: number) => x0 + ((x1 - x0) * m) / SPAN
  const T = reduced ? undefined : 'transform 260ms cubic-bezier(0.22,1,0.36,1)'
  const after = attemptAt >= revokeAt
  const anchor = (m: number) => (m <= 15 ? 'start' : m >= SPAN - 25 ? 'end' : 'middle')
  return (
    <figure>
      <svg viewBox={`0 0 ${W} 190`} className="block h-auto w-full" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Delegation and decision timeline</title>
        <desc id={`${uid}-d`}>
          Delegation created at 09:00, revoked at {clock(revokeAt)}. The agent attempts a read at {clock(attemptAt)}, {after ? 'after' : 'before'} the revocation. The decision is evaluated at {clock(evaluatedAt)}
          {cached ? ' and cached.' : ', at action time.'}
        </desc>
        <defs>
          <pattern id={`${uid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--fog) / 0.5)" strokeWidth="1.4" />
          </pattern>
        </defs>
        {/* lane labels */}
        <text x={x0} y={22} fontSize="11" letterSpacing="1.4" className="font-mono uppercase" fill="rgb(var(--ink-3))">
          Delegation · read access
        </text>
        <text x={x0} y={92} fontSize="11" letterSpacing="1.4" className="font-mono uppercase" fill="rgb(var(--ink-3))">
          Authorization decision
        </text>
        {/* delegation lane */}
        <rect x={x0} y={32} width={Math.max(0, X(revokeAt) - x0)} height={22} rx="3" fill="rgb(var(--copper) / 0.32)" stroke="rgb(var(--copper))" strokeWidth="1" style={{ transition: reduced ? undefined : 'width 260ms cubic-bezier(0.22,1,0.36,1)' }} />
        <rect x={X(revokeAt)} y={32} width={Math.max(0, x1 - X(revokeAt))} height={22} rx="3" fill={`url(#${uid}-h)`} stroke="rgb(var(--fog) / 0.6)" strokeDasharray="4 3" />
        <text x={x0 + 8} y={47} fontSize="11.5" fill="rgb(var(--ink))">
          in force
        </text>
        {X(revokeAt) < x1 - 70 ? (
          <text x={X(revokeAt) + 8} y={47} fontSize="11.5" fill="rgb(var(--fog-ink))">
            revoked
          </text>
        ) : null}
        {/* decision lane */}
        {cached ? (
          <line x1={X(0)} x2={X(attemptAt)} y1={113} y2={113} stroke="rgb(var(--ink-3))" strokeDasharray="2 4" strokeWidth="1.5" />
        ) : null}
        <g style={{ transform: `translateX(${X(evaluatedAt)}px)`, transition: T }}>
          <rect x={-6} y={107} width={12} height={12} transform="rotate(45 0 113)" fill="rgb(var(--s1))" stroke="rgb(var(--ink-2))" strokeWidth="1.5" />
          <text x={evaluatedAt < 20 ? 10 : 0} y={138} textAnchor={evaluatedAt < 20 ? 'start' : 'middle'} fontSize="11" className="font-mono" fill="rgb(var(--ink-2))">
            {cached ? 'evaluated once, cached' : 'evaluated at attempt'}
          </text>
        </g>
        {/* delegation created */}
        <circle cx={X(0)} cy={43} r={5} fill="rgb(var(--copper))" />
        {/* revocation marker */}
        <g style={{ transform: `translateX(${X(revokeAt)}px)`, transition: T }}>
          <line x1={0} x2={0} y1={26} y2={150} stroke="rgb(var(--ink-2))" strokeWidth="1.2" strokeDasharray="3 3" />
          <text x={0} y={166} textAnchor={anchor(revokeAt)} fontSize="11.5" className="font-mono" fill="rgb(var(--ink))">
            {clock(revokeAt)} revoked
          </text>
        </g>
        {/* attempt marker */}
        <g style={{ transform: `translateX(${X(attemptAt)}px)`, transition: T }}>
          <line x1={0} x2={0} y1={26} y2={150} stroke={after ? 'rgb(var(--crimson-ink))' : 'rgb(var(--sage-ink))'} strokeWidth="2" />
          <circle cx={0} cy={43} r={6} fill="rgb(var(--s1))" stroke={after ? 'rgb(var(--crimson-ink))' : 'rgb(var(--sage-ink))'} strokeWidth="2" />
          <text x={0} y={184} textAnchor={anchor(attemptAt)} fontSize="11.5" className="font-mono" fill={after ? 'rgb(var(--crimson-ink))' : 'rgb(var(--sage-ink))'}>
            {clock(attemptAt)} attempt {after ? '(after revocation)' : '(access in force)'}
          </text>
        </g>
        {/* axis */}
        <line x1={x0} x2={x1} y1={150} y2={150} stroke="rgb(var(--ink) / 0.14)" />
        {Array.from({ length: SPAN / 15 + 1 }, (_, i) => i * 15).map((m) => (
          <g key={m}>
            <line x1={X(m)} x2={X(m)} y1={150} y2={155} stroke="rgb(var(--ink) / 0.25)" />
            {m % 30 === 0 ? (
              <text x={X(m)} y={166} fontSize="10" textAnchor="middle" className="font-mono" fill="rgb(var(--ink-3))" opacity={Math.abs(X(m) - X(revokeAt)) < 70 ? 0 : 1}>
                {clock(m)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-[11.5px] text-ink-3">Illustrative timeline. The verdict below is computed by the engine, not by this drawing.</figcaption>
    </figure>
  )
}

function TimeSlider({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help: string }) {
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[13px] text-ink">
          {clock(value)}
        </output>
      </div>
      <input id={id} type="range" min={0} max={SPAN} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${clock(value)} UTC`} className="mt-1.5 w-full accent-[rgb(var(--copper))]" />
      <p className="text-[11px] text-ink-3">{help}</p>
    </div>
  )
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opts: { id: Mode; title: string; body: string }[] = [
    { id: 'cached', title: 'Decision cached at provisioning', body: 'Evaluated once at 09:00 and reused for every later attempt.' },
    { id: 'action', title: 'Evaluated at action time', body: 'Re-evaluated against the evidence when the attempt happens.' },
  ]
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow mb-2">When is the decision evaluated?</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {opts.map((o) => (
          <label key={o.id} className={cx('flex cursor-pointer items-start gap-2 rounded border px-3 py-2 transition-colors', mode === o.id ? 'border-copper/55 bg-copper/[0.07]' : 'hairline hover:bg-s2')}>
            <input type="radio" name="at-mode" value={o.id} checked={mode === o.id} onChange={() => onChange(o.id)} className="mt-[3px] accent-[rgb(var(--copper))]" />
            <span>
              <span className="block text-[12.5px] text-ink">{o.title}</span>
              <span className="block text-[11.5px] text-ink-3">{o.body}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function RealExamples() {
  const qc = useQueryClient()
  const type = 'ACTION_TIME_AUTHORIZATION_FAILURE'
  const q = useQuery({ queryKey: wsKey('findings', { type }), queryFn: () => api.get<{ total: number; findings: FindingView[] }>(`/api/findings?type=${type}`) })
  const load = useMutation({
    mutationFn: () => api.post('/api/scenarios', { slug: 'action-time-authorization' }),
    onSuccess: async () => {
      await afterDatasetChange(qc)
    },
  })
  return (
    <Panel title="In the active dataset" eyebrow="Real examples" id="at-real" className="mt-5" bodyClassName="p-0">
      {q.isLoading ? (
        <LoadingState label="Loading findings" className="min-h-[140px]" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} className="border-0 bg-transparent" />
      ) : (q.data?.findings.length ?? 0) === 0 ? (
        <EmptyState
          icon={<IconClock size={22} />}
          title="No action-time authorization failures in the active dataset"
          body="Load scenario 11 to get a dataset where a cached decision allows a read after the delegation behind it was revoked."
          action={
            <Button onClick={() => load.mutate()} loading={load.isPending}>
              Load scenario 11
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
          {q.data!.findings.map((f) => (
            <li key={f.finding_id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <FindingTypeBadge type={f.type} />
                  <span className="font-mono text-[10.5px] text-ink-3">{f.status}</span>
                </div>
                <Link to={`/app/findings/${encodeURIComponent(f.finding_id)}`} className="mt-1 block text-[13px] font-medium text-ink hover:text-copper-ink hover:underline">
                  {f.title}
                </Link>
                <p className="text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{f.summary}</p>
              </div>
              {f.action_id ? (
                <div className="flex shrink-0 gap-2">
                  <LinkButton size="sm" to={`/app/chains/${encodeURIComponent(f.action_id)}`}>
                    Inspect chain
                  </LinkButton>
                  <LinkButton size="sm" variant="ghost" to={`/app/time-travel`}>
                    Time travel
                  </LinkButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
