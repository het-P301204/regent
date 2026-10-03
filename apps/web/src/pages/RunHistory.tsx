import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useRunVerification, wsKey } from '../lib/queries'
import { useSession } from '../lib/session'
import { stamp } from '../lib/format'
import type { RunSummary } from '../lib/types'
import { Button, LinkButton, PageHeader, Tooltip } from '../ui/primitives'
import { CopyButton, DataTable } from '../ui/data'
import type { Column } from '../ui/data'
import { EmptyState, ErrorState, LoadingState, useToast } from '../ui/feedback'
import { IconVerification } from '../brand/icons'
import { shortDigest } from '../components/chains/ChainPath'
import { useResponsiveColumns } from '../components/chains/responsive'

interface RunRow {
  id: string
  input_digest: string
  ruleset_version: string
  engine_version: string
  duration_ms: number | null
  created_at: string | null
  created_by: string | null
  summary: Partial<RunSummary> | null
}
interface RunsResponse {
  dataset_id: string
  runs: RunRow[]
}

export default function RunHistory() {
  const { can } = useSession()
  const toast = useToast()
  const run = useRunVerification()
  const q = useQuery({ queryKey: wsKey('runs'), queryFn: () => api.get<RunsResponse>('/api/runs') })

  // Runs that share an input digest and rule set version: the engine is
  // deterministic, so these produced the same results. Grouping is by string
  // equality only; nothing is recomputed here.
  const sameInput = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of q.data?.runs ?? []) {
      const k = `${r.input_digest}|${r.ruleset_version}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [q.data])

  const runNow = () =>
    run.mutate(undefined, {
      onSuccess: (r) => toast({ title: 'Verification complete', body: `${r.summary.total_actions} actions, ${r.summary.authority_violations} authority violations`, tone: 'success' }),
      onError: (e) => toast({ title: 'Verification failed', body: e.message, tone: 'error' }),
    })

  const columns = useResponsiveColumns<RunRow>([
    {
      key: 'when',
      header: 'Started (UTC)',
      width: '132px',
      cell: (r) => (
        <div className="min-w-0">
          <div className="tnum whitespace-nowrap font-mono text-[11.5px] text-ink-2">{stamp(r.created_at).replace(' UTC', '')}</div>
          <div className="truncate font-mono text-[10.5px] text-ink-3" title={r.id}>
            {r.id.slice(0, 12)}
          </div>
        </div>
      ),
    },
    {
      key: 'digest',
      header: 'Input digest',
      width: 'minmax(0,1.4fr)',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-[11.5px] text-ink" title={r.input_digest}>
            {shortDigest(r.input_digest, 10, 4)}
          </span>
          <CopyButton text={r.input_digest} label="Copy" />
        </span>
      ),
    },
    { key: 'ruleset', header: 'Rule set', width: 'minmax(0,0.8fr)', hideBelow: 'sm', cell: (r) => <span className="truncate font-mono text-[11.5px] text-ink-2">{r.ruleset_version}</span> },
    { key: 'engine', header: 'Engine', width: 'minmax(0,0.7fr)', hideBelow: 'lg', cell: (r) => <span className="truncate font-mono text-[11.5px] text-ink-3">{r.engine_version}</span> },
    {
      key: 'duration',
      header: 'Duration',
      width: '80px',
      hideBelow: 'md',
      cell: (r) => <span className="tnum font-mono text-[11.5px] text-ink-2">{r.duration_ms === null || r.duration_ms === undefined ? '—' : `${r.duration_ms} ms`}</span>,
    },
    { key: 'actions', header: 'Actions', width: '72px', hideBelow: 'md', cell: (r) => <span className="tnum font-mono text-[12px] text-ink">{r.summary?.total_actions ?? '—'}</span> },
    {
      key: 'violations',
      header: 'Violations',
      width: '84px',
      cell: (r) => {
        const n = r.summary?.authority_violations
        if (n === undefined || n === null) return <span className="font-mono text-[12px] text-ink-4">—</span>
        return n > 0 ? (
          <span className="tnum inline-flex items-center gap-1 font-mono text-[12px] text-crimson-ink">
            <span aria-hidden>✕</span>
            {n}
          </span>
        ) : (
          <span className="tnum font-mono text-[12px] text-ink-2">0</span>
        )
      },
    },
    {
      key: 'same',
      header: 'Same input',
      width: '104px',
      hideBelow: 'md',
      cell: (r) => {
        const n = sameInput.get(`${r.input_digest}|${r.ruleset_version}`) ?? 1
        return n > 1 ? (
          <span className="inline-flex h-[20px] items-center gap-1 rounded-[3px] border border-copper/40 px-1.5 font-mono text-[10.5px] text-copper-ink" title={`${n} runs share this input digest and rule set version, so they produced identical results`}>
            <span aria-hidden>≡</span> {n} runs
          </span>
        ) : (
          <span className="font-mono text-[11px] text-ink-4">unique</span>
        )
      },
    },
    { key: 'by', header: 'Run by', width: 'minmax(0,0.9fr)', hideBelow: 'lg', cell: (r) => <span className="truncate text-[12px] text-ink-2">{r.created_by ?? 'system'}</span> },
  ] satisfies Column<RunRow>[])

  const runButton = can('analyst') ? (
    <Button variant="primary" icon={<IconVerification size={14} />} loading={run.isPending} onClick={runNow}>
      Run verification
    </Button>
  ) : (
    <Tooltip content="Running verification requires the analyst role.">
      <Button variant="primary" icon={<IconVerification size={14} />} disabled>
        Run verification
      </Button>
    </Tooltip>
  )

  return (
    <div className="min-w-0">
      <PageHeader eyebrow="Workspace · Activity" title="Run history" description="Every verification run on the active dataset, with the input digest and rule set that determine its results." actions={runButton} />

      <aside className="panel anim-fade-up mb-4 flex min-w-0 gap-3 px-4 py-3" aria-label="Determinism">
        <span aria-hidden className="mt-0.5 font-mono text-[15px] leading-none text-copper-ink">
          ≡
        </span>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          The engine is deterministic. Two runs with the same <span className="text-ink">input digest</span> and <span className="text-ink">rule set version</span> produce identical findings and verdicts, so a result can be reproduced from those two values alone. The input digest is SHA-256 over the normalized evidence and the rule set.
        </p>
      </aside>

      {q.isLoading ? (
        <LoadingState label="Loading runs" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data || q.data.runs.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<IconVerification size={28} />}
            title="No verification runs yet"
            body="Run verification on the active dataset to reconstruct its delegation chains and record the result here."
            action={can('analyst') ? runButton : <LinkButton to="/app/scenarios">Open the scenario lab</LinkButton>}
          />
        </div>
      ) : (
        <section aria-labelledby="runs-title" className="panel anim-fade-up min-w-0 overflow-hidden" style={{ animationDelay: '60ms' }}>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-4 py-2.5">
            <h2 id="runs-title" className="text-[13px] font-medium text-ink">
              <span className="tnum">{q.data.runs.length}</span> {q.data.runs.length === 1 ? 'run' : 'runs'}
              <span className="font-normal text-ink-3"> · newest first</span>
            </h2>
            <span className="min-w-0 truncate font-mono text-[11px] text-ink-3" title={q.data.dataset_id}>
              dataset {q.data.dataset_id}
            </span>
          </header>
          <DataTable rows={q.data.runs} columns={columns} rowKey={(r) => r.id} caption="Verification runs on the active dataset, newest first" />
          {q.data.runs.length >= 50 ? <p className="border-t hairline px-4 py-2 text-[11.5px] text-ink-3">Showing the 50 most recent runs.</p> : null}
        </section>
      )}
    </div>
  )
}
