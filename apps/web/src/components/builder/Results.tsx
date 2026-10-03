import { useState } from 'react'
import type { Finding } from '../../lib/types'
import { Badge, Panel, Tabs } from '../../ui/primitives'
import { DecisionBadge, ResultBadge } from '../../ui/status'
import { Metric } from '../../ui/data'
import { AuthorityFlow } from '../../viz/AuthorityFlow'
import { CheckList, ExplanationSteps, FindingList } from '../lab/findings'
import { flowStagesFromRun, totalFindings } from '../lab/run'
import type { BuilderVerifyResponse } from '../lab/run'
import type { Compiled } from './model'

/** The engine's answer for a built chain. Rendered as returned; nothing is recomputed. */
export function BuilderResults({ res, compiled, stale, onLocate }: { res: BuilderVerifyResponse; compiled: Compiled; stale: boolean; onLocate: (f: Finding) => void }) {
  const run = res.run
  const [tab, setTab] = useState('0')
  const idx = Math.min(Number(tab), Math.max(0, run.actions.length - 1))
  const v = run.actions[idx]
  const s = run.summary
  const name = (id: string | null) => (id ? (res.names[id] ?? id) : 'unknown')
  const specAction = compiled.spec.actions[idx]
  return (
    <section aria-labelledby="builder-results" className="mt-6 anim-fade-up">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Engine verdict</div>
          <h2 id="builder-results" className="text-[17px] font-medium text-ink">
            Verification of the built chain
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="fog">Synthetic</Badge>
          <span className="font-mono text-[10.5px] text-ink-3" title="sha256 over the normalized evidence and rule set">
            digest {run.input_digest.slice(0, 16)}… · engine {run.engine_version} · rules {run.ruleset_version}
          </span>
        </div>
      </div>
      {stale ? (
        <p role="status" className="mb-3 rounded border border-amber/40 bg-amber/[0.07] px-3 py-2 text-[12.5px] text-amber-ink">
          ! The canvas changed after this verification. Canvas highlights are hidden until you verify again.
        </p>
      ) : null}

      <div className="panel mb-4 grid grid-cols-2 md:grid-cols-4">
        <Metric label="Actions verified" value={s.total_actions} sub={`${s.attributable_actions} attributable`} className="border-b border-r hairline md:border-b-0" />
        <Metric label="Findings" value={totalFindings(s)} sub={`${s.amplification_events} amplification events`} className="border-b hairline md:border-b-0 md:border-r" />
        <Metric label="Derived decisions" value={<span className="text-[15px] font-normal">{(['ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN'] as const).filter((d) => s.decisions[d] > 0).map((d) => `${s.decisions[d]} ${d}`).join(' · ') || '—'}</span>} sub="REGENT's action-time decision" className="border-r hairline" />
        <Metric label="Chain health" value={<span className="text-[15px] font-normal">{(['verified', 'incomplete', 'violated', 'unknown'] as const).filter((h) => s.chain_health[h] > 0).map((h) => `${s.chain_health[h]} ${h}`).join(' · ') || '—'}</span>} sub={`${s.broken_chains} broken chains`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Panel title="Findings" eyebrow={`${run.findings.length} produced`} id="b-findings">
          <FindingList findings={run.findings} onLocate={stale ? undefined : onLocate} empty={<p className="text-[12.5px] leading-relaxed text-ink-2">The engine produced no findings for this chain. Check the per-dimension results: an UNKNOWN is not a pass.</p>} />
        </Panel>

        <Panel title="Actions" eyebrow="Per-action verification" id="b-actions" bodyClassName="p-0">
          {run.actions.length === 0 ? (
            <p className="p-4 text-[12.5px] leading-relaxed text-ink-2">The chain has no complete action, so only the delegations were checked. Connect a principal to a tool and the tool to a resource to verify an action.</p>
          ) : (
            <>
              {run.actions.length > 1 ? (
                <Tabs
                  label="Verified actions"
                  value={String(idx)}
                  onChange={setTab}
                  className="px-2"
                  tabs={run.actions.map((a, i) => ({ id: String(i), label: `${i + 1}. ${name(a.chain.actor_principal_id)} · ${compiled.map.toolLabel[i] ?? 'tool'}` }))}
                />
              ) : null}
              {v ? (
                <div className="space-y-5 p-4" key={v.action_id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[10.5px] text-ink-3">{v.event_id}</div>
                      <p className="mt-0.5 text-[13px] text-ink [overflow-wrap:anywhere]">
                        {[...(v.chain.hops.length ? [name(v.chain.hops[0]!.delegator_principal_id), ...v.chain.hops.map((h) => name(h.delegatee_principal_id))] : [name(v.chain.actor_principal_id)])].join(' → ')}
                        <span className="text-ink-3"> → {specAction?.tool ?? 'tool'} → {specAction?.resource ?? 'resource'}</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="eyebrow">Derived decision</span>
                      <DecisionBadge decision={v.derived_decision} recorded={v.recorded_decision} />
                    </div>
                  </div>
                  {v.derived_decision_reasons.length ? (
                    <ul className="space-y-1 border-l-2 border-[rgb(var(--line-strong)/0.2)] pl-3">
                      {v.derived_decision_reasons.map((r, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-ink-2">
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="eyebrow">Authority flow</h3>
                      <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                        Overall <ResultBadge result={v.overall} />
                      </span>
                    </div>
                    <AuthorityFlow stages={flowStagesFromRun(v, run.findings, res.names, compiled.map.toolLabel[idx] ?? 'Action')} height={220} />
                  </div>
                  <div>
                    <h3 className="eyebrow mb-1">Checks</h3>
                    <CheckList checks={v.checks} />
                  </div>
                  {res.explanations[idx] ? (
                    <div>
                      <h3 className="eyebrow mb-2">Why</h3>
                      <ExplanationSteps explanation={res.explanations[idx]!} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      {res.issues.length > 0 ? (
        <Panel title="Normalization notes" eyebrow={`${res.issues.length} from the evidence normalizer`} className="mt-4" id="b-issues">
          <ul className="space-y-1">
            {res.issues.slice(0, 20).map((i, k) => (
              <li key={k} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                <Badge tone={i.severity === 'error' ? 'amber' : 'neutral'}>{i.severity}</Badge>
                <span className="font-mono text-[11px] text-ink-3">{i.code}</span>
                <span className="text-ink-2">{i.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </section>
  )
}
