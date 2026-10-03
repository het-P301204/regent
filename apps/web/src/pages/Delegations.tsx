import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, RotateCcw, Rows3 } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { day } from '../lib/format'
import { IconDelegation } from '../brand/icons'
import { Button, LinkButton, PageHeader, Panel, Select } from '../ui/primitives'
import { LifecycleBadge } from '../ui/status'
import { DataTable } from '../ui/data'
import type { Column } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { DelegationCard } from '../components/registry/DelegationCard'
import { ApprovalBadge, CompactScope, CountStrip, INTEGRITY, Segmented, usePrincipalIndex, useStagger } from '../components/registry/common'
import type { ContractIntegrity, DelegationsResponse, RegistryDelegation } from '../components/registry/types'

const INTEGRITIES: ContractIntegrity[] = ['VIOLATION', 'WARN', 'PASS', 'UNVERIFIED']
type View = 'contracts' | 'table'

export default function Delegations() {
  const q = useQuery({ queryKey: wsKey('delegations'), queryFn: () => api.get<DelegationsResponse>('/api/delegations') })
  const index = usePrincipalIndex()
  const nav = useNavigate()
  const stagger = useStagger(28, 12)
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'table' ? 'table' : 'contracts'
  const integrityParam = params.get('integrity')
  const integrity = integrityParam && (INTEGRITIES as string[]).includes(integrityParam) ? (integrityParam as ContractIntegrity) : 'all'
  const delegator = params.get('delegator') ?? 'all'
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v === null) n.delete(k)
        else n.set(k, v)
        return n
      },
      { replace: true },
    )

  const all = useMemo(() => q.data?.delegations ?? [], [q.data])
  const delegators = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of all) if (d.delegator_principal_id) m.set(d.delegator_principal_id, d.delegator_name ?? d.delegator_principal_id)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [all])
  // Names for the root column: registry first, then any name seen on a delegation.
  const nameOf = (id: string | null) => {
    if (!id) return null
    return index.get(id)?.name ?? all.find((d) => d.delegator_principal_id === id)?.delegator_name ?? id
  }

  const rows = all.filter((d) => (integrity === 'all' || d.contract_integrity === integrity) && (delegator === 'all' || d.delegator_principal_id === delegator))
  const filtered = integrity !== 'all' || delegator !== 'all'
  const reset = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('integrity')
        n.delete('delegator')
        return n
      },
      { replace: true },
    )

  const columns: Column<RegistryDelegation>[] = [
    { key: 'id', header: 'Delegation ID', width: 'minmax(0,1.1fr)', cell: (d) => <span className="id text-[11.5px] text-ink">{d.delegation_id}</span> },
    { key: 'from', header: 'Delegator', width: 'minmax(0,1fr)', hideBelow: 'sm', cell: (d) => <span className="block text-[12px] text-ink [overflow-wrap:anywhere]">{d.delegator_name ?? d.delegator_principal_id ?? <span className="italic text-fog-ink">not recorded</span>}</span> },
    { key: 'to', header: 'Delegatee', width: 'minmax(0,1fr)', cell: (d) => <span className="block text-[12px] text-ink [overflow-wrap:anywhere]">{d.delegatee_name ?? d.delegatee_principal_id ?? <span className="italic text-fog-ink">not recorded</span>}</span> },
    { key: 'root', header: 'Root principal', width: 'minmax(0,0.9fr)', hideBelow: 'lg', cell: (d) => <span className="block text-[12px] text-ink-2 [overflow-wrap:anywhere]">{nameOf(d.root_principal_id) ?? <span className="italic text-fog-ink">not recorded</span>}</span> },
    { key: 'granted', header: 'Granted', width: 'minmax(0,1.3fr)', hideBelow: 'md', cell: (d) => <CompactScope scope={d.granted_scope} highlight={d.amplified} max={2} /> },
    { key: 'requested', header: 'Requested', width: 'minmax(0,1fr)', hideBelow: 'lg', cell: (d) => <CompactScope scope={d.requested_scope} max={2} /> },
    { key: 'effective', header: 'Effective', width: 'minmax(0,1fr)', hideBelow: 'lg', cell: (d) => <CompactScope scope={d.effective_scope} max={2} unknown="unknown" /> },
    { key: 'policy', header: 'Policy', width: '104px', hideBelow: 'lg', cell: (d) => (d.policy_id ? <span className="id text-[11px]">{d.policy_id} v{d.policy_version ?? '?'}</span> : <span className="text-[11.5px] italic text-amber-ink">none</span>) },
    { key: 'created', header: 'Created', width: '96px', hideBelow: 'lg', cell: (d) => <span className="font-mono text-[11px] text-ink-2">{day(d.created_at)}</span> },
    { key: 'expires', header: 'Expires', width: '96px', hideBelow: 'lg', cell: (d) => <span className="font-mono text-[11px] text-ink-2">{day(d.expires_at)}</span> },
    { key: 'approval', header: 'Approval', width: '112px', hideBelow: 'md', cell: (d) => <ApprovalBadge state={d.approval_state} /> },
    {
      key: 'status',
      header: 'Status',
      width: '132px',
      cell: (d) => {
        const s = INTEGRITY[d.contract_integrity]
        return (
          <span className="flex flex-col items-start gap-1">
            <LifecycleBadge state={d.recorded_status} />
            <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] ${s.text}`} title={s.explain}>
              <span aria-hidden>{s.glyph}</span>
              {s.short}
            </span>
          </span>
        )
      },
    },
  ]

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Registry"
        title="Delegation registry"
        description="Every delegation read as a contract between a delegator and a delegatee, sealed with REGENT's verdict on whether it stayed within the authority the delegator held."
        actions={
          <Segmented<View>
            label="View"
            value={view}
            onChange={(v) => setParam('view', v === 'table' ? 'table' : null)}
            options={[
              { id: 'contracts', label: 'Contracts', icon: <LayoutGrid size={13} aria-hidden /> },
              { id: 'table', label: 'Table', icon: <Rows3 size={13} aria-hidden /> },
            ]}
          />
        }
      />
      {q.isLoading ? (
        <LoadingState label="Loading delegations" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : all.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<IconDelegation size={28} />}
            title="No delegations in this dataset"
            body="Without delegation records no action can be traced back to a human principal. Run a scenario or build a chain to see delegation contracts."
            action={
              <span className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/app/scenarios" variant="primary" size="sm">Open scenario lab</LinkButton>
                <LinkButton to="/app/builder" size="sm">Build a chain</LinkButton>
              </span>
            }
          />
        </Panel>
      ) : (
        <>
          <CountStrip
            label="Delegations by contract integrity"
            items={INTEGRITIES.map((k) => ({
              key: k,
              icon: <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${INTEGRITY[k].text} ${INTEGRITY[k].border}`}>{INTEGRITY[k].glyph}</span>,
              count: all.filter((d) => d.contract_integrity === k).length,
              label: INTEGRITY[k].short.toLowerCase(),
            }))}
          />
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select label="Contract integrity" value={integrity} onChange={(e) => setParam('integrity', e.target.value === 'all' ? null : e.target.value)} className="w-[calc(50%-6px)] sm:w-48">
              <option value="all">All verdicts</option>
              {INTEGRITIES.map((k) => (
                <option key={k} value={k}>
                  {INTEGRITY[k].short}
                </option>
              ))}
            </Select>
            <Select label="Delegator" value={delegator} onChange={(e) => setParam('delegator', e.target.value === 'all' ? null : e.target.value)} className="w-[calc(50%-6px)] sm:w-56">
              <option value="all">All delegators</option>
              {delegators.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            {filtered ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset}>
                Clear filters
              </Button>
            ) : null}
            <span className="ml-auto self-center font-mono text-[11px] text-ink-3" aria-live="polite">
              {rows.length} of {all.length}
            </span>
          </div>

          {rows.length === 0 ? (
            <Panel>
              <EmptyState title="No delegation matches these filters" body="Clear the filters to see every delegation contract." action={<Button size="sm" icon={<RotateCcw size={13} />} onClick={reset}>Clear filters</Button>} />
            </Panel>
          ) : view === 'contracts' ? (
            <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Delegation contracts">
              {rows.map((d, i) => (
                <li key={d.delegation_id} className="flex min-w-0">
                  <DelegationCard d={d} delegatorType={d.delegator_principal_id ? index.get(d.delegator_principal_id)?.type : null} delegateeType={d.delegatee_principal_id ? index.get(d.delegatee_principal_id)?.type : null} style={{ ...stagger(i), width: '100%' }} />
                </li>
              ))}
            </ul>
          ) : (
            <Panel bodyClassName="p-0">
              <DataTable rows={rows} columns={columns} rowKey={(d) => d.delegation_id} onRowClick={(d) => nav(`/app/delegations/${encodeURIComponent(d.delegation_id)}`)} caption="Delegations" />
            </Panel>
          )}
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
            The seal is the API&apos;s contract integrity verdict. A contract no action relied on is <span className="text-fog-ink">unverified</span>, which is not the same as violated. Crimson + chips mark granted permissions the delegator did not hold.
          </p>
        </>
      )}
    </div>
  )
}
