import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Download, Landmark } from 'lucide-react'
import { download } from '../lib/api'
import { useSession } from '../lib/session'
import { plural } from '../lib/format'
import type { FindingStatus, RuleConfig } from '../lib/types'
import { Button, LinkButton, PageHeader, Panel, cx } from '../ui/primitives'
import { FindingStatusBadge } from '../ui/status'
import { CopyButton } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { useGrcControls, useRuleSet } from '../components/grc/queries'
import type { ControlRow, ControlResult } from '../components/grc/queries'
import { CONTROL_RESULT, CONTROL_RESULT_ORDER, ControlResultBadge } from '../components/grc/ControlResultBadge'

const STATUS_ORDER: FindingStatus[] = ['OPEN', 'INVESTIGATING', 'ACCEPTED', 'RESOLVED', 'SUPPRESSED']

export default function Grc() {
  const q = useGrcControls()
  const rules = useRuleSet()
  const { can } = useSession()
  const ruleIndex = useMemo(() => new Map((rules.data?.rules ?? []).map((r) => [r.rule_id as string, r])), [rules.data])

  const exportButton = can('auditor') ? (
    <Button variant="primary" icon={<Download size={14} />} onClick={() => download('/api/grc/evidence-package')} disabled={!q.data}>
      Export evidence package
    </Button>
  ) : (
    <Button variant="secondary" icon={<Download size={14} />} disabled aria-describedby="grc-export-role">
      Export evidence package
    </Button>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Analyze · GRC"
        title="Control evaluation"
        description="Each control restates a REGENT verification question as a control statement. Results come from the same verification run as every other view in the console; nothing on this page is evaluated separately."
        actions={exportButton}
      />
      {!can('auditor') ? (
        <p id="grc-export-role" className="-mt-3 mb-5 text-[12px] text-ink-3">
          Your role can view control results. Exporting the evidence package requires the auditor role or higher.
        </p>
      ) : null}

      {q.isLoading ? (
        <LoadingState label="Evaluating controls" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data || q.data.controls.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Landmark size={22} />}
            title="No controls evaluated"
            body="The active dataset has no verification run yet, so there is nothing to evaluate controls against. Load a scenario or import evidence, then come back."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/app/scenarios" variant="primary">
                  Open scenario lab
                </LinkButton>
                <LinkButton to="/app/import">Import events</LinkButton>
              </div>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <RunProvenance run={q.data.run} />
          <ResultSummary controls={q.data.controls} />
          <p className="rounded border border-dashed hairline-strong px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">Scope of this mapping.</span> The control set (RGT-C1 to RGT-C7) is REGENT's own. It does not claim compliance with, or certification against, any framework or standard. Use it as evidence for your own control assessment, not as the assessment.
          </p>
          <ControlTable controls={q.data.controls} rules={ruleIndex} rulesState={rules.isLoading ? 'loading' : rules.isError ? 'error' : 'ready'} />
          <div className="xl:hidden">
            <h2 className="sr-only">Controls</h2>
            <ul className="flex flex-col gap-3">
              {q.data.controls.map((c) => (
                <li key={c.control_id}>
                  <ControlCard control={c} rules={ruleIndex} rulesState={rules.isLoading ? 'loading' : rules.isError ? 'error' : 'ready'} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function RunProvenance({ run }: { run: { id: string; input_digest: string; ruleset_version: string } }) {
  const rows: [string, string][] = [
    ['Verification run', run.id],
    ['Input digest', run.input_digest],
    ['Rule set version', run.ruleset_version],
  ]
  return (
    <section aria-label="Run provenance" className="panel grid grid-cols-1 divide-y hairline md:grid-cols-[1fr_2fr_1fr] md:divide-x md:divide-y-0">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 items-start justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="eyebrow">{k}</div>
            <div className="id mt-1">{v}</div>
          </div>
          <CopyButton text={v} label="Copy" />
        </div>
      ))}
    </section>
  )
}

function ResultSummary({ controls }: { controls: ControlRow[] }) {
  const counts = CONTROL_RESULT_ORDER.map((r) => [r, controls.filter((c) => c.result === r).length] as const)
  const total = controls.length
  return (
    <section aria-labelledby="grc-summary" className="panel px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="grc-summary" className="text-[13px] font-medium text-ink">
          {plural(total, 'control')} evaluated
        </h2>
        <span className="text-[11.5px] text-ink-3">Not evaluated means the evidence cannot settle the control. It is never counted as satisfied.</span>
      </div>
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-s3" aria-hidden>
        {counts.map(([r, n]) => (n > 0 ? <span key={r} className={cx('h-full border-r border-[rgb(var(--s1))] last:border-r-0', CONTROL_RESULT[r].fill)} style={{ width: `${(n / total) * 100}%` }} /> : null))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {counts.map(([r, n]) => (
          <div key={r} className="flex items-center gap-2">
            <dt>
              <ControlResultBadge result={r} />
            </dt>
            <dd className="tnum font-mono text-[13px] text-ink">{n}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

type RulesState = 'loading' | 'error' | 'ready'

function EvidenceCell({ c }: { c: ControlRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[12px] text-ink-2">
        <span className="tnum text-ink">{c.actions_passing}</span> of <span className="tnum text-ink">{c.actions_evaluated}</span> evaluable actions pass
        {c.actions_unknown > 0 ? (
          <>
            {' · '}
            <span className="text-fog-ink">
              <span aria-hidden>? </span>
              {c.actions_unknown} unknown
            </span>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-1" aria-label="Mapped rules">
        {c.rule_ids.map((r) => (
          <span key={r} className="scope-chip border-[rgb(var(--line-strong)/0.16)] bg-s2 text-ink-2">
            {r}
          </span>
        ))}
      </div>
      {c.evidence_event_ids.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer select-none text-[11.5px] text-copper-ink underline-offset-2 hover:underline">
            Chain / event ids ({c.evidence_event_ids.length})
          </summary>
          <ul className="mt-1.5 flex max-h-36 flex-wrap gap-1 overflow-y-auto pr-1">
            {c.evidence_event_ids.map((id) => (
              <li key={id}>
                <Link to={`/app/chains/${encodeURIComponent(id)}`} className="scope-chip border-[rgb(var(--line-strong)/0.14)] bg-transparent text-ink-2 hover:border-copper/50 hover:text-ink">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <span className="text-[11.5px] text-ink-3">No events carry evidence for this control.</span>
      )}
    </div>
  )
}

function FindingsCell({ c }: { c: ControlRow }) {
  if (c.finding_ids.length === 0) return <span className="text-[12px] text-ink-3">None</span>
  const head = c.finding_ids.slice(0, 4)
  const rest = c.finding_ids.slice(4)
  const link = (id: string) => (
    <li key={id}>
      <Link to={`/app/findings/${encodeURIComponent(id)}`} className="id hover:text-copper-ink hover:underline">
        {id}
      </Link>
    </li>
  )
  return (
    <div className="min-w-0">
      <ul className="flex flex-col gap-0.5">{head.map(link)}</ul>
      {rest.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[11.5px] text-copper-ink underline-offset-2 hover:underline">{rest.length} more</summary>
          <ul className="mt-1 flex flex-col gap-0.5">{rest.map(link)}</ul>
        </details>
      ) : null}
    </div>
  )
}

function StatusCell({ c }: { c: ControlRow }) {
  const values = Object.values(c.finding_statuses)
  if (values.length === 0) return <span className="text-[12px] text-ink-3">No findings to triage</span>
  return (
    <ul className="flex flex-col items-start gap-1">
      {STATUS_ORDER.map((s) => {
        const n = values.filter((v) => v === s).length
        return n > 0 ? (
          <li key={s} className="flex items-center gap-1.5">
            <FindingStatusBadge status={s} />
            <span className="tnum font-mono text-[11.5px] text-ink-2">×{n}</span>
          </li>
        ) : null
      })}
    </ul>
  )
}

function RemediationCell({ c, rules, state }: { c: ControlRow; rules: Map<string, RuleConfig>; state: RulesState }) {
  if (state === 'loading') return <span className="text-[11.5px] text-ink-3">Loading rule remediation</span>
  const items = [...new Set(c.rule_ids)].map((id) => [id, rules.get(id)?.remediation] as const).filter(([, r]) => !!r)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {state === 'error' || items.length === 0 ? (
        <span className="text-[11.5px] text-ink-3">Remediation text unavailable. Open the mapped rules in the policy engine.</span>
      ) : (
        items.map(([id, text]) => (
          <p key={id} className="text-[12px] leading-snug text-ink-2">
            <span className="mr-1 font-mono text-[11px] text-ink-3">{id}</span>
            <span className="line-clamp-3">{text}</span>
          </p>
        ))
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
        <Link to="/app/policy" className="text-copper-ink underline-offset-2 hover:underline">
          Rules in policy engine
        </Link>
        {c.finding_ids[0] ? (
          <Link to={`/app/findings/${encodeURIComponent(c.finding_ids[0])}`} className="text-copper-ink underline-offset-2 hover:underline">
            Root cause of {c.finding_ids[0]}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function ResultCell({ c }: { c: ControlRow }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <ControlResultBadge result={c.result} />
      <p className="text-[11.5px] leading-snug text-ink-3">{c.rationale}</p>
    </div>
  )
}

function ControlTable({ controls, rules, rulesState }: { controls: ControlRow[]; rules: Map<string, RuleConfig>; rulesState: RulesState }) {
  const th = 'eyebrow px-3 py-2.5 text-left align-bottom font-normal'
  const td = 'px-3 py-3.5 align-top'
  return (
    <div className="panel hidden overflow-x-auto xl:block">
      <table className="w-full min-w-[1120px] border-collapse text-[12.5px]">
        <caption className="sr-only">Control evaluation: one row per control, with evidence, result, findings, owner, remediation and triage status.</caption>
        <thead className="border-b hairline-strong">
          <tr>
            <th scope="col" className={cx(th, 'w-[170px] pl-4')}>Control</th>
            <th scope="col" className={cx(th, 'w-[200px]')}>Requirement</th>
            <th scope="col" className={cx(th, 'w-[210px]')}>Evidence</th>
            <th scope="col" className={cx(th, 'w-[180px]')}>Result</th>
            <th scope="col" className={cx(th, 'w-[150px]')}>Finding</th>
            <th scope="col" className={cx(th, 'w-[110px]')}>Owner</th>
            <th scope="col" className={th}>Remediation</th>
            <th scope="col" className={cx(th, 'w-[140px] pr-4')}>Status</th>
          </tr>
        </thead>
        <tbody>
          {controls.map((c) => (
            <tr key={c.control_id} className="border-b hairline last:border-b-0">
              <th scope="row" className={cx(td, 'pl-4 text-left font-normal')}>
                <div className="font-mono text-[11.5px] text-ink-3">{c.control_id}</div>
                <div className="mt-0.5 text-[13px] font-medium leading-snug text-ink">{c.title}</div>
              </th>
              <td className={cx(td, 'leading-snug text-ink-2')}>{c.requirement}</td>
              <td className={td}>
                <EvidenceCell c={c} />
              </td>
              <td className={td}>
                <ResultCell c={c} />
              </td>
              <td className={td}>
                <FindingsCell c={c} />
              </td>
              <td className={cx(td, 'text-ink-2')}>{c.owner}</td>
              <td className={td}>
                <RemediationCell c={c} rules={rules} state={rulesState} />
              </td>
              <td className={cx(td, 'pr-4')}>
                <StatusCell c={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function ControlCard({ control: c, rules, rulesState }: { control: ControlRow; rules: Map<string, RuleConfig>; rulesState: RulesState }) {
  const result: ControlResult = c.result
  return (
    <article aria-labelledby={`ctl-${c.control_id}`} className="panel p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11.5px] text-ink-3">{c.control_id}</div>
          <h3 id={`ctl-${c.control_id}`} className="text-[14px] font-medium leading-snug text-ink">
            {c.title}
          </h3>
        </div>
        <ControlResultBadge result={result} />
      </header>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{c.requirement}</p>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{c.rationale}</p>
      <dl className="mt-4 grid grid-cols-1 gap-4 border-t hairline pt-4 sm:grid-cols-2">
        <Field label="Evidence">
          <EvidenceCell c={c} />
        </Field>
        <Field label="Finding">
          <FindingsCell c={c} />
        </Field>
        <Field label="Owner">
          <span className="text-[12.5px] text-ink-2">{c.owner}</span>
        </Field>
        <Field label="Status">
          <StatusCell c={c} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Remediation">
            <RemediationCell c={c} rules={rules} state={rulesState} />
          </Field>
        </div>
      </dl>
    </article>
  )
}
