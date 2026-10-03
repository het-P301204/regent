import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, FileJson, FileSpreadsheet, FileText, Lock } from 'lucide-react'
import { api, download } from '../lib/api'
import { wsKey } from '../lib/queries'
import { useSession } from '../lib/session'
import { stamp } from '../lib/format'
import type { ChainRow, DatasetRow, Role } from '../lib/types'
import { Badge, Button, LinkButton, PageHeader, Panel, TextInput, cx } from '../ui/primitives'
import { HealthBadge, SeverityBadge, SourceTag } from '../ui/status'
import { CodeBlock } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { useGrcControls } from '../components/grc/queries'

interface ReportItem {
  id: string
  title: string
  format: string
  href: string
}
interface ReportsResponse {
  dataset: DatasetRow
  reports: ReportItem[]
  investigation_template: string
}

/** Minimum role per export. Mirrors the API's route guards so the console can explain a disabled button. */
const MIN_ROLE: Record<string, Role> = { security: 'auditor', 'evidence-package': 'auditor', 'events-json': 'auditor', 'events-csv': 'auditor' }

const EXPORT_NOTES: Record<string, string> = {
  'findings-json': 'Every finding in the latest run as regent.finding/v1 records, with triage status.',
  'findings-csv': 'One row per finding. Cells that a spreadsheet would read as a formula are neutralized.',
  'events-json': 'The normalized evidence bundle the run was computed from.',
  'events-csv': 'One row per action: derived and recorded decision, per-dimension check results, scopes.',
  'evidence-package': 'Run metadata, rule set, control evaluation, findings and the full evidence bundle in one file.',
}

const SECURITY_SECTIONS: [string, string][] = [
  ['1', 'Executive summary'],
  ['2', 'Environment'],
  ['3', 'Analyzed chains'],
  ['4', 'Authority findings'],
  ['5', 'Attribution findings'],
  ['6', 'Identity findings'],
  ['7', 'Policy findings'],
  ['8', 'Controls'],
  ['9', 'Remediation'],
  ['A', 'Appendix: evidence and method'],
]

const FINDING_FIELDS: [string, string, string][] = [
  ['schema', '"regent.finding/v1"', 'Format identifier. Field names and order are stable within v1.'],
  ['finding_id', 'string', 'Deterministic: the same evidence and rule produce the same id.'],
  ['type', 'string', 'Finding type, e.g. AUTHORITY_AMPLIFICATION.'],
  ['rule_id', 'string', 'Verification rule that produced it (AUTH-001 … AUTH-010).'],
  ['severity', 'enum', 'critical | high | medium | low | info, from the rule set.'],
  ['status', 'enum', 'Triage status: OPEN | INVESTIGATING | ACCEPTED | RESOLVED | SUPPRESSED.'],
  ['title, summary', 'string', 'What is wrong, in one line and one sentence.'],
  ['root_cause', 'string', 'Why it is a security problem, derived from the evidence.'],
  ['remediation', 'string', 'Remediation text of the rule.'],
  ['action_id, delegation_id', 'string | null', 'The action or delegation the finding is located on.'],
  ['broken_edge', 'object | null', 'First hop where the invariant broke: from, to, hop_index, delegation_id.'],
  ['affected_principal_ids', 'string[]', 'Principals involved.'],
  ['affected_resource_ids', 'string[]', 'Resources involved.'],
  ['authority_delta', 'object | null', 'available, granted, requested, effective, exercised (null = not recorded) and excess.'],
  ['missing_fields', 'string[]', 'Evidence fields that were absent.'],
  ['evidence', 'EvidenceRef[]', 'kind, id, event_id, SHA-256 digest of the normalized record, note.'],
  ['related_event_ids', 'string[]', 'Every event the finding was observed on.'],
  ['first_seen, last_seen', 'ISO 8601 | null', 'Earliest and latest observation.'],
  ['input_digest, ruleset_version, engine_version', 'string', 'Provenance of the run that produced the finding.'],
]

const FINDING_EXAMPLE = `{
  "schema": "regent.finding/v1",
  "finding_id": "REG-AMP-e38c7a42f8",
  "type": "AUTHORITY_AMPLIFICATION",
  "rule_id": "AUTH-001",
  "severity": "critical",
  "status": "OPEN",
  "title": "Authority amplification",
  "summary": "ReconciliationAgent exercised ledger.write, which no delegation in its chain legitimately conveyed.",
  "root_cause": "… The execution identity wl-recon-04 holds standing permission for {ledger.write}: the action used the workload's own authority instead of the authority delegated to the agent. …",
  "remediation": "Enforce the delegated scope at the tool or gateway at action time, …",
  "action_id": "evt-0042",
  "delegation_id": null,
  "broken_edge": { "from": "agent-recon", "to": "tool-ledger-post", "hop_index": null, "delegation_id": null },
  "affected_principal_ids": ["agent-ops", "agent-recon", "human-maya"],
  "affected_resource_ids": ["res-ledger-db"],
  "authority_delta": {
    "available": ["invoice.approve", "invoice.read", "invoice.write", "ledger.read", "report.export"],
    "granted": ["ledger.read"],
    "requested": ["ledger.read", "ledger.write"],
    "effective": ["ledger.read"],
    "exercised": ["ledger.read", "ledger.write"],
    "excess": ["ledger.write"]
  },
  "missing_fields": [],
  "evidence": [
    { "kind": "action", "id": "evt-0042", "event_id": "evt-0042", "digest": "sha256:<64 hex>", "note": "The action record." }
  ],
  "related_event_ids": ["evt-0042"],
  "first_seen": "2026-10-03T11:47:00Z",
  "last_seen": "2026-10-03T11:47:00Z",
  "input_digest": "sha256:<64 hex>",
  "ruleset_version": "2026.10.1",
  "engine_version": "0.1.0"
}`

function FormatIcon({ format }: { format: string }) {
  if (format === 'csv') return <FileSpreadsheet size={16} aria-hidden />
  if (format === 'json') return <FileJson size={16} aria-hidden />
  return <FileText size={16} aria-hidden />
}

export default function Reports() {
  const q = useQuery({ queryKey: wsKey('reports'), queryFn: () => api.get<ReportsResponse>('/api/reports') })
  const grc = useGrcControls()
  const { can } = useSession()

  if (q.isLoading) return <LoadingState label="Listing reports" />
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />
  const data = q.data
  if (!data || data.reports.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Analyze · Reports" title="Reports & exports" />
        <Panel>
          <EmptyState
            icon={<FileText size={22} />}
            title="No reports available"
            body="Reports are generated from the active dataset's latest verification run. Load a dataset first."
            action={
              <LinkButton to="/app/scenarios" variant="primary">
                Open scenario lab
              </LinkButton>
            }
          />
        </Panel>
      </div>
    )
  }

  const security = data.reports.find((r) => r.id === 'security')
  const exportsList = data.reports.filter((r) => r.id !== 'security')
  const allowed = (r: ReportItem) => can(MIN_ROLE[r.id] ?? 'viewer')

  return (
    <div>
      <PageHeader
        eyebrow="Analyze · Reports"
        title="Reports & exports"
        description="Every report and export is generated server-side from the active dataset's latest verification run. The console only fetches the file."
      />

      <section aria-label="Source dataset" className="panel mb-5 flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-1">Exports come from</div>
          <div className="flex flex-wrap items-center gap-2">
            <SourceTag source={data.dataset.source} />
            <span className="text-[13.5px] font-medium text-ink [overflow-wrap:anywhere]">{data.dataset.name}</span>
            <span className="text-[12px] text-ink-3">created {stamp(data.dataset.created_at)}</span>
          </div>
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] md:max-w-[560px]">
          <dt className="text-ink-3">Input digest</dt>
          <dd className="id min-w-0">{grc.data?.run.input_digest ?? (grc.isLoading ? 'loading' : 'unavailable')}</dd>
          <dt className="text-ink-3">Rule set</dt>
          <dd className="id min-w-0">{grc.data?.run.ruleset_version ?? (grc.isLoading ? 'loading' : 'unavailable')}</dd>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {security ? (
          <Panel eyebrow="PDF report" title={security.title} id="security-report" actions={<Badge tone="copper">PDF</Badge>}>
            <p className="text-[13px] leading-relaxed text-ink-2">
              The report for an engineering lead or auditor. It embeds the run's input digest and rule set version, so anyone holding the same evidence can re-run it and check that it produces the same findings.
            </p>
            <ol className="mt-4 grid grid-cols-1 gap-x-6 border-t hairline pt-3 sm:grid-cols-2" aria-label="Report sections">
              {SECURITY_SECTIONS.map(([n, label]) => (
                <li key={n} className="flex items-baseline gap-3 border-b hairline py-1.5 text-[12.5px]">
                  <span className="w-4 shrink-0 font-mono text-[11px] text-ink-3">{n}</span>
                  <span className="text-ink">{label}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<Download size={14} />} disabled={!allowed(security)} onClick={() => download(security.href)}>
                Download security report
              </Button>
              {!allowed(security) ? <RoleNote role="auditor" /> : <span className="font-mono text-[11px] text-ink-3">{security.href}</span>}
            </div>
          </Panel>
        ) : null}

        <Panel eyebrow="Data exports" title="Machine-readable exports" bodyClassName="p-0">
          <ul>
            {exportsList.map((r) => {
              const ok = allowed(r)
              return (
                <li key={r.id} className="flex flex-col gap-2 border-b hairline px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 text-ink-3">
                      <FormatIcon format={r.format} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] text-ink">{r.title}</span>
                        <Badge>{r.format}</Badge>
                      </div>
                      {EXPORT_NOTES[r.id] ? <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{EXPORT_NOTES[r.id]}</p> : null}
                      {!ok ? <RoleNote role={MIN_ROLE[r.id] ?? 'viewer'} /> : null}
                    </div>
                  </div>
                  <Button size="sm" icon={ok ? <Download size={13} /> : <Lock size={13} />} disabled={!ok} onClick={() => download(r.href)} aria-label={`Download ${r.title} (${r.format})`} className="self-start sm:self-center">
                    Download
                  </Button>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvestigationPicker template={data.investigation_template} allowed={can('auditor')} />
        <Panel eyebrow="Format" title="regent.finding/v1" id="finding-format">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            The stable record each finding is exported as, in JSON exports and the evidence package. Use it to feed a SIEM or ticketing system. A <code className="font-mono text-[12px] text-ink">null</code> scope means the evidence did not record it; it is never the same as an empty scope.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Fields of regent.finding/v1</caption>
              <thead>
                <tr className="border-b hairline-strong">
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">Field</th>
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">Type</th>
                  <th scope="col" className="eyebrow py-2 font-normal">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {FINDING_FIELDS.map(([f, t, d]) => (
                  <tr key={f} className="border-b hairline align-top">
                    <th scope="row" className="py-1.5 pr-3 font-mono text-[11.5px] font-normal text-ink">{f}</th>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11px] text-ink-3">{t}</td>
                    <td className="py-1.5 text-ink-2">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-[12px] text-copper-ink underline-offset-2 hover:underline">Show an example record</summary>
            <p className="mb-2 mt-2 text-[11.5px] text-ink-3">The demo finding on evt-0042 (ReconciliationAgent's ledger write). Long text is shortened with … and digests are elided; a real export carries the full values for your run.</p>
            <CodeBlock value={FINDING_EXAMPLE} maxHeight={420} />
          </details>
        </Panel>
      </div>
    </div>
  )
}

function RoleNote({ role }: { role: Role }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-ink-3">
      <Lock size={11} aria-hidden /> Requires the {role} role or higher.
    </span>
  )
}

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function InvestigationPicker({ template, allowed }: { template: string; allowed: boolean }) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const listId = useId()
  const chains = useQuery({
    queryKey: wsKey('chains', { health: 'violated', limit: 20 }),
    queryFn: () => api.get<{ total: number; rows: ChainRow[] }>('/api/chains?health=violated&limit=20'),
  })
  const id = value.trim()
  const valid = EVENT_ID.test(id)
  const href = template.replace('{event_id}', encodeURIComponent(id))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (valid && allowed) download(href)
  }

  return (
    <Panel eyebrow="PDF report" title="Investigation report" id="investigation-report">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        A focused report for one event: the reconstructed chain, every finding on it, and the evidence records with their digests. Pick a violated chain or enter any event id from the active dataset.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <TextInput
          label="Event id"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="evt-0042"
          spellCheck={false}
          autoComplete="off"
          maxLength={128}
          aria-invalid={touched && !valid ? true : undefined}
          aria-describedby={`${listId}-hint`}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" icon={<Download size={14} />} disabled={!allowed}>
            Download PDF
          </Button>
          {valid ? (
            <LinkButton to={`/app/investigate/${encodeURIComponent(id)}`} variant="ghost">
              Investigate
            </LinkButton>
          ) : null}
        </div>
      </form>
      <p id={`${listId}-hint`} className={cx('mt-1.5 text-[11.5px]', touched && !valid && id.length > 0 ? 'text-amber-ink' : 'text-ink-3')}>
        {!allowed ? 'Investigation reports require the auditor role or higher.' : touched && !valid && id.length > 0 ? 'Event ids contain letters, digits, dot, dash, underscore or colon.' : touched && id.length === 0 ? 'Enter an event id or choose one below.' : `Fetches ${template}`}
      </p>

      <h3 className="eyebrow mb-2 mt-4">Violated chains in this dataset</h3>
      {chains.isLoading ? (
        <LoadingState label="Loading violated chains" className="min-h-[120px]" />
      ) : chains.isError ? (
        <ErrorState error={chains.error} retry={() => chains.refetch()} className="my-2" />
      ) : !chains.data || chains.data.rows.length === 0 ? (
        <p className="rounded border border-dashed hairline-strong px-3 py-4 text-center text-[12.5px] text-ink-3">
          No violated chains in the active dataset. You can still enter any event id above, or <Link to="/app/chains" className="text-copper-ink underline-offset-2 hover:underline">browse all chains</Link>.
        </p>
      ) : (
        <ul className="max-h-[300px] overflow-y-auto rounded border hairline" aria-label="Violated chains">
          {chains.data.rows.map((r) => {
            const selected = id === r.event_id
            return (
              <li key={r.action_id} className="border-b hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setValue(r.event_id)
                    setTouched(false)
                  }}
                  aria-pressed={selected}
                  className={cx('flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left transition-colors hover:bg-s2', selected && 'bg-copper/[0.08]')}
                >
                  <span className="font-mono text-[12px] text-ink">{r.event_id}</span>
                  <HealthBadge health={r.health} />
                  {r.worst_severity ? <SeverityBadge severity={r.worst_severity} /> : null}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                    {r.actor_name ?? 'Unknown actor'} → {r.tool_name ?? r.tool_id ?? 'no tool'} → {r.resource_name ?? r.resource_id ?? 'no resource'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
