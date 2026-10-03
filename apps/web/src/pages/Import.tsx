import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileJson, FlaskConical, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { afterDatasetChange } from '../lib/queries'
import { useSession } from '../lib/session'
import { plural } from '../lib/format'
import type { IngestIssue } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Panel, Tabs, TextInput } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { CodeBlock, DataTable, Metric } from '../ui/data'
import type { Column } from '../ui/data'
import { SourceTag } from '../ui/status'
import { VerificationSequence } from '../viz/VerificationSequence'
import { totalFindings } from '../components/lab/run'
import type { ImportResponse, ScenarioCard } from '../components/lab/run'

const MAX_BYTES = 5 * 1024 * 1024

/** The documented legacy audit-record shape. Aliases are rewritten to canonical names on import. */
const EXAMPLE = [
  {
    event_id: 'evt-001',
    timestamp: '2026-10-03T10:30:00Z',
    delegated_user: 'user-001',
    agent_id: 'agent-001',
    parent_agent: null,
    tool: 'customer-search',
    resource: 'customer-db',
    action: 'read',
    requested_scope: ['customer.read'],
    exercised_scope: ['customer.read'],
    policy_version: 'policy-4',
    decision: 'allow',
  },
]
const EXAMPLE_TEXT = JSON.stringify(EXAMPLE, null, 2)

const ALIASES: [string, string][] = [
  ['delegated_user', 'root_principal_id'],
  ['agent_id', 'actor_principal_id'],
  ['parent_agent', 'parent_principal_id'],
  ['tool', 'tool_id'],
  ['resource', 'resource_id'],
  ['action', 'operation'],
  ['decision', 'recorded_decision'],
]

type Mode = 'file' | 'paste' | 'generate'
type Format = 'json' | 'jsonl' | 'auto'

interface ValidateResponse {
  stats: ImportResponse['stats']
  issues: IngestIssue[]
  issue_count: number
  counts: { principals: number; delegations: number; actions: number }
}

interface LoadedFile {
  name: string
  size: number
  text: string
  format: Format
}

function formatOf(filename: string): Format {
  const f = filename.toLowerCase()
  if (f.endsWith('.jsonl') || f.endsWith('.ndjson')) return 'jsonl'
  if (f.endsWith('.json')) return 'json'
  return 'auto'
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function Import() {
  const qc = useQueryClient()
  const { can } = useSession()
  const analyst = can('analyst')
  const [mode, setMode] = useState<Mode>('file')
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [name, setName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [checked, setChecked] = useState<{ content: string; res: ValidateResponse } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const content = mode === 'file' ? (file?.text ?? '') : mode === 'paste' ? paste : ''
  const format: Format = mode === 'file' ? (file?.format ?? 'auto') : 'auto'
  const filename = mode === 'file' ? file?.name : 'pasted.json'
  const datasetName = name.trim() || (mode === 'file' && file ? file.name.replace(/\.(jsonl?|ndjson)$/i, '') : 'Pasted events')
  const contentBytes = useMemo(() => new Blob([content]).size, [content])
  const tooLarge = contentBytes > MAX_BYTES
  const report = checked && checked.content === content ? checked.res : null

  const validate = useMutation({
    mutationFn: (c: string) => api.post<ValidateResponse>('/api/events/validate', { name: datasetName.slice(0, 120), filename, format, content: c }),
    onSuccess: (res, c) => {
      setChecked({ content: c, res })
      setFilter(res.issues.some((i) => i.severity === 'error') ? 'error' : 'all')
    },
  })
  const importer = useMutation({
    mutationFn: (c: string) => api.post<ImportResponse>('/api/events', { name: datasetName.slice(0, 120), filename, format, content: c }),
    onSuccess: async () => {
      await afterDatasetChange(qc)
    },
  })

  const readFile = async (f: File) => {
    setFileError(null)
    importer.reset()
    validate.reset()
    if (f.size > MAX_BYTES) {
      setFile(null)
      setFileError(`${f.name} is ${bytes(f.size)}. Imports are limited to 5 MB; split the file and import it in parts.`)
      return
    }
    try {
      const text = await f.text()
      setFile({ name: f.name, size: f.size, text, format: formatOf(f.name) })
      if (!name.trim()) setName(f.name.replace(/\.(jsonl?|ndjson)$/i, '').slice(0, 120))
    } catch {
      setFileError(`${f.name} could not be read as text.`)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) void readFile(f)
  }

  const loadExample = () => {
    setMode('paste')
    setPaste(EXAMPLE_TEXT)
    if (!name.trim()) setName('Legacy example events')
    importer.reset()
  }

  const issueRows = useMemo(() => (report?.issues ?? []).map((i, k) => ({ ...i, key: String(k) })).filter((i) => filter === 'all' || i.severity === filter), [report, filter])
  const errors = report?.issues.filter((i) => i.severity === 'error').length ?? 0
  const warnings = report?.issues.filter((i) => i.severity === 'warning').length ?? 0

  const columns: Column<IngestIssue & { key: string }>[] = [
    { key: 'sev', header: 'Severity', width: '92px', cell: (r) => <Badge tone={r.severity === 'error' ? 'amber' : 'neutral'}>{r.severity === 'error' ? '! error' : '· warning'}</Badge> },
    { key: 'code', header: 'Code', width: 'minmax(120px,170px)', cell: (r) => <span className="font-mono text-[11px] text-ink-2 [overflow-wrap:anywhere]">{r.code}</span> },
    { key: 'msg', header: 'Message', width: 'minmax(0,2fr)', cell: (r) => <span className="text-ink [overflow-wrap:anywhere]">{r.message}</span> },
    {
      key: 'rec',
      header: 'Record',
      width: 'minmax(0,1fr)',
      hideBelow: 'md',
      cell: (r) => (
        <span className="font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">
          {r.record_index !== null ? `#${r.record_index}` : '—'}
          {r.record_type ? ` · ${r.record_type}` : ''}
          {r.record_id ? ` · ${r.record_id}` : ''}
        </span>
      ),
    },
    { key: 'field', header: 'Field', width: 'minmax(0,120px)', hideBelow: 'lg', cell: (r) => <span className="font-mono text-[11px] text-ink-3">{r.field ?? '—'}</span> },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Build · Import events"
        title="Import events"
        description="Bring your own delegation and action records. Validate them first to see exactly what the normalizer accepts, rewrites and rejects, then import and verify them as a new dataset."
      />

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Note title="Untrusted evidence">Every imported record is treated as a claim by the system under audit. REGENT checks it; it never trusts declared roots, parents or decisions.</Note>
        <Note title="Kept separate">An import becomes its own dataset. The demo dataset is untouched; switch back or reset to the demo from the dataset switcher in the top bar.</Note>
        <Note title="Limits">JSON or JSONL, up to 5 MB and 50,000 records per import. Larger evidence should be split.</Note>
      </div>

      {!analyst ? (
        <p role="note" className="mb-4 rounded border border-amber/40 bg-amber/[0.06] px-3 py-2 text-[12.5px] text-amber-ink">
          ! Validating, importing and generating events requires the analyst role. You can still read the format and prepare a file.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Choose input" id="imp-input" bodyClassName="p-0">
          <Tabs
            label="Input method"
            value={mode}
            onChange={(m) => {
              setMode(m)
              importer.reset()
            }}
            className="px-2"
            tabs={[
              { id: 'file', label: 'Upload file' },
              { id: 'paste', label: 'Paste JSON' },
              { id: 'generate', label: 'Generate synthetic' },
            ]}
          />
          <div className="p-4">
            {mode === 'file' ? (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cx('flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-10 text-center transition-colors', dragging ? 'border-copper bg-copper/[0.06]' : 'border-[rgb(var(--line-strong)/0.22)] bg-s2/40')}
                >
                  <Upload size={20} className={dragging ? 'text-copper-ink' : 'text-ink-3'} aria-hidden />
                  <p className="text-[13px] text-ink">{dragging ? 'Drop to read the file' : 'Drop a .json or .jsonl file here'}</p>
                  <p className="text-[11.5px] text-ink-3">The file is read in your browser and sent only when you validate or import.</p>
                  <Button size="sm" onClick={() => inputRef.current?.click()} icon={<FileJson size={13} aria-hidden />}>
                    Choose a file
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".json,.jsonl,.ndjson,application/json"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Evidence file"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void readFile(f)
                      e.target.value = ''
                    }}
                  />
                </div>
                {fileError ? (
                  <p role="alert" className="text-[12.5px] text-amber-ink">
                    ! {fileError}
                  </p>
                ) : null}
                {file ? (
                  <div className="flex flex-wrap items-center gap-2 rounded border hairline bg-s2 px-3 py-2 text-[12.5px]">
                    <FileJson size={14} className="text-ink-3" aria-hidden />
                    <span className="id">{file.name}</span>
                    <span className="text-ink-3">
                      {bytes(file.size)} · read as {file.format === 'auto' ? 'JSON or JSONL (auto)' : file.format.toUpperCase()}
                    </span>
                    <button type="button" className="ml-auto text-[11.5px] text-ink-3 hover:text-ink" onClick={() => setFile(null)}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            ) : mode === 'paste' ? (
              <div>
                <label htmlFor="imp-paste" className="eyebrow mb-1.5 block">
                  JSON or JSONL
                </label>
                <textarea
                  id="imp-paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  spellCheck={false}
                  rows={14}
                  placeholder={'[\n  { "event_id": "evt-001", "agent_id": "agent-001", ... }\n]'}
                  className="w-full resize-y rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 p-3 font-mono text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus-visible:border-copper"
                />
                <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                  <span>An array of records, a bundle object, or one record per line.</span>
                  <span className={tooLarge ? 'text-amber-ink' : undefined}>{bytes(contentBytes)} of 5 MB</span>
                </div>
              </div>
            ) : (
              <Generate canGenerate={analyst} />
            )}

            {mode !== 'generate' ? (
              <div className="mt-4 flex flex-col gap-3 border-t hairline pt-4 md:flex-row md:items-end">
                <TextInput label="Dataset name" value={name} maxLength={120} placeholder={datasetName} onChange={(e) => setName(e.target.value)} className="md:flex-1" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => validate.mutate(content)} loading={validate.isPending} disabled={!analyst || !content.trim() || tooLarge}>
                    Validate
                  </Button>
                  <Button variant="primary" onClick={() => importer.mutate(content)} loading={importer.isPending} disabled={!analyst || !report || report.stats.records_accepted === 0 || tooLarge} title={!report ? 'Validate first' : undefined}>
                    Import and verify
                  </Button>
                </div>
              </div>
            ) : null}
            {mode !== 'generate' && tooLarge ? <p className="mt-2 text-[12px] text-amber-ink">! This input is over the 5 MB limit. Split it before importing.</p> : null}
            {mode !== 'generate' && content.trim() && !report && !validate.isPending ? <p className="mt-2 text-[11.5px] text-ink-3">Validate to see the import report. Import is enabled once at least one record is accepted.</p> : null}
          </div>
        </Panel>

        <Panel
          title="Event format"
          eyebrow="Documented legacy shape"
          id="imp-format"
          actions={
            <Button size="sm" onClick={loadExample}>
              Load example
            </Button>
          }
        >
          <CodeBlock value={EXAMPLE_TEXT} maxHeight={300} />
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">Legacy field names are accepted as aliases and rewritten to canonical names during normalization. Each rewrite is reported as an ALIAS_APPLIED warning so nothing changes silently.</p>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">Legacy aliases and the canonical field each one becomes</caption>
            <thead>
              <tr>
                <th scope="col" className="eyebrow pb-1 font-normal">Legacy</th>
                <th scope="col" className="eyebrow pb-1 font-normal">Canonical</th>
              </tr>
            </thead>
            <tbody>
              {ALIASES.map(([a, b]) => (
                <tr key={a} className="border-t hairline">
                  <td className="py-1 font-mono text-[11.5px] text-ink-3">{a}</td>
                  <td className="py-1 font-mono text-[11.5px] text-ink">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">Typed records (with record_type) and bundle objects such as {'{ "principals": [...], "delegations": [...], "actions": [...] }'} are also accepted.</p>
        </Panel>
      </div>

      {mode !== 'generate' ? (
        <section aria-labelledby="imp-report" className="mt-5">
          <h2 id="imp-report" className="sr-only">
            Import report
          </h2>
          {validate.isPending ? (
            <LoadingState label="Validating records" className="min-h-[140px]" />
          ) : validate.isError ? (
            <ErrorState error={validate.error} retry={() => validate.mutate(content)} />
          ) : report ? (
            <Panel title="Import report" eyebrow="Validation only · nothing stored yet" id="imp-rep" bodyClassName="p-0">
              <div className="grid grid-cols-2 border-b hairline md:grid-cols-4">
                <Metric label="Records read" value={report.stats.records_read} className="border-b border-r hairline md:border-b-0" />
                <Metric label="Accepted" value={report.stats.records_accepted} tone={report.stats.records_accepted > 0 ? 'sage' : 'neutral'} className="border-b hairline md:border-b-0 md:border-r" />
                <Metric label="Rejected" value={report.stats.records_rejected} tone={report.stats.records_rejected > 0 ? 'amber' : 'neutral'} className="border-r hairline" />
                <Metric label="Normalized" value={<span className="text-[15px] font-normal">{`${report.counts.principals} principals · ${report.counts.delegations} delegations · ${report.counts.actions} actions`}</span>} />
              </div>
              {Object.keys(report.stats.by_type).length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-2.5">
                  <span className="eyebrow">By record type</span>
                  {Object.entries(report.stats.by_type).map(([t, n]) => (
                    <span key={t} className="font-mono text-[11.5px] text-ink-2">
                      {t} <span className="text-ink-3">{n}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <Tabs
                label="Filter issues"
                value={filter}
                onChange={setFilter}
                className="px-2"
                tabs={[
                  { id: 'all', label: 'All issues', count: report.issues.length },
                  { id: 'error', label: 'Errors', count: errors },
                  { id: 'warning', label: 'Warnings', count: warnings },
                ]}
              />
              <DataTable
                rows={issueRows}
                columns={columns}
                rowKey={(r) => r.key}
                caption="Import issues"
                height={420}
                empty={<EmptyState title={report.issues.length === 0 ? 'No issues' : 'No issues of this kind'} body={report.issues.length === 0 ? 'Every record parsed and passed schema validation.' : undefined} action={report.issues.length > 0 ? <Button size="sm" onClick={() => setFilter('all')}>Show all issues</Button> : undefined} />}
              />
              {report.issue_count > report.issues.length ? <p className="border-t hairline px-4 py-2 text-[11.5px] text-ink-3">Showing the first {report.issues.length} of {report.issue_count} issues.</p> : null}
              {report.stats.records_accepted === 0 ? <p className="border-t hairline px-4 py-2.5 text-[12.5px] text-amber-ink">! No record passed validation, so there is nothing to import. Fix the errors above and validate again.</p> : null}
            </Panel>
          ) : null}
        </section>
      ) : null}

      {mode !== 'generate' && (importer.isPending || importer.isSuccess || importer.isError) ? (
        <section aria-labelledby="imp-result" className="mt-5">
          <h2 id="imp-result" className="sr-only">
            Import result
          </h2>
          <VerificationSequence running={importer.isPending} done={importer.isSuccess} failed={importer.isError} className="mb-3" />
          {importer.isError ? <ErrorState error={importer.error} retry={() => importer.mutate(content)} /> : null}
          {importer.isSuccess ? <ImportSuccess res={importer.data} /> : null}
        </section>
      ) : null}
    </div>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border hairline px-3.5 py-3">
      <div className="eyebrow mb-1">{title}</div>
      <p className="text-[12px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

function ImportSuccess({ res }: { res: ImportResponse }) {
  const s = res.summary
  return (
    <div className="panel anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-3">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-sage-ink text-[9px] text-sage-ink" aria-hidden>
          ✓
        </span>
        <h3 className="text-[13.5px] font-medium text-ink">Imported and verified "{res.dataset.name}"</h3>
        <SourceTag source={res.dataset.source} />
        <span className="ml-auto font-mono text-[10.5px] text-ink-3">run {res.run_id}</span>
      </div>
      <div className="grid grid-cols-2 border-b hairline md:grid-cols-4">
        <Metric label="Records accepted" value={res.stats.records_accepted} sub={`${res.stats.records_rejected} rejected`} className="border-b border-r hairline md:border-b-0" />
        <Metric label="Actions verified" value={s.total_actions} sub={`${s.attributable_actions} attributable`} className="border-b hairline md:border-b-0 md:border-r" />
        <Metric label="Findings" value={totalFindings(s)} sub={`${s.authority_violations} authority violations`} className="border-r hairline" />
        <Metric label="Unattributable" value={s.unattributable_actions} tone={s.unattributable_actions > 0 ? 'amber' : 'neutral'} sub={`${s.broken_chains} broken chains`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <LinkButton to="/app" variant="primary">
          Open Command Center
        </LinkButton>
        <LinkButton to="/app/findings">View findings</LinkButton>
        <LinkButton to="/app/chains" variant="ghost">
          Browse chains
        </LinkButton>
        <span className="text-[11.5px] text-ink-3">This dataset is now active. Return to the demo from the dataset switcher.</span>
      </div>
    </div>
  )
}

function Generate({ canGenerate }: { canGenerate: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['scenarios'], queryFn: () => api.get<{ scenarios: ScenarioCard[] }>('/api/scenarios'), staleTime: 5 * 60_000 })
  const [picked, setPicked] = useState<string[]>([])
  const gen = useMutation({
    mutationFn: (slugs: string[]) => api.post<ImportResponse>('/api/events/generate', { scenarios: slugs }),
    onSuccess: async () => {
      await afterDatasetChange(qc)
    },
  })
  if (q.isLoading) return <LoadingState label="Loading scenarios" className="min-h-[160px]" />
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />
  const all = q.data?.scenarios ?? []
  if (all.length === 0) return <EmptyState icon={<FlaskConical size={20} aria-hidden />} title="No scenarios to generate from" body="Paste or upload your own events instead." />
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]))
  return (
    <div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">Combine scenario records into one synthetic dataset. Scenarios share a registry, so identical records collapse during normalization. The result is labelled synthetic.</p>
      <fieldset>
        <legend className="eyebrow mb-2 flex w-full items-center justify-between">
          <span>Scenarios</span>
          <span className="flex gap-2 font-sans normal-case tracking-normal">
            <button type="button" className="text-[11.5px] text-ink-3 hover:text-ink" onClick={() => setPicked(all.map((s) => s.slug))}>
              Select all
            </button>
            <button type="button" className="text-[11.5px] text-ink-3 hover:text-ink" onClick={() => setPicked([])}>
              Clear
            </button>
          </span>
        </legend>
        <ul className="grid gap-1 sm:grid-cols-2">
          {all.map((s) => (
            <li key={s.slug}>
              <label className={cx('flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2 transition-colors', picked.includes(s.slug) ? 'border-copper/45 bg-copper/[0.06]' : 'hairline hover:bg-s2')}>
                <input type="checkbox" className="mt-[3px] accent-[rgb(var(--copper))]" checked={picked.includes(s.slug)} onChange={() => toggle(s.slug)} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-ink">
                    <span className="tnum mr-1.5 font-mono text-ink-3">{String(s.number).padStart(2, '0')}</span>
                    {s.title}
                  </span>
                  <span className="block font-mono text-[10.5px] text-ink-3">{plural(s.record_count, 'record')}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t hairline pt-4">
        <Button variant="primary" onClick={() => gen.mutate(picked)} loading={gen.isPending} disabled={!canGenerate || picked.length === 0}>
          Generate and verify {picked.length > 0 ? plural(picked.length, 'scenario') : ''}
        </Button>
        <Badge tone="fog">Synthetic</Badge>
        <VerificationSequence running={gen.isPending} done={gen.isSuccess} failed={gen.isError} />
      </div>
      {gen.isError ? <ErrorState error={gen.error} retry={() => gen.mutate(picked)} /> : null}
      {gen.isSuccess ? (
        <div className="mt-4">
          <ImportSuccess res={gen.data} />
        </div>
      ) : null}
    </div>
  )
}
