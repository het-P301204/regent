import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Info, Lock, RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { stamp, day } from '../lib/format'
import type { PrincipalType } from '../lib/types'
import { IconCredential, IconExecution, IconHuman, IconResource, IconTool, IconAgent, IconSubAgent } from '../brand/icons'
import { Badge, Button, LinkButton, PageHeader, Panel, Select, Tabs, TextInput } from '../ui/primitives'
import { LifecycleBadge } from '../ui/status'
import { DataTable } from '../ui/data'
import type { Column } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { CompactScope, CountStrip, PrincipalGlyph, TYPE_LABEL, useIdentities } from '../components/registry/common'
import type { DelegationsResponse, IdentitiesResponse, LifecycleStatus, RegistryPrincipal } from '../components/registry/types'

type Tab = 'principals' | 'execution' | 'credentials' | 'tools' | 'resources' | 'unknown'
const TABS: Tab[] = ['principals', 'execution', 'credentials', 'tools', 'resources', 'unknown']
const LIFECYCLES: LifecycleStatus[] = ['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'UNKNOWN']
const TYPES: PrincipalType[] = ['human', 'agent', 'sub_agent', 'workload', 'service']

type ExecRow = IdentitiesResponse['execution_identities'][number]
type CredRow = IdentitiesResponse['credentials'][number]
type ToolRow = IdentitiesResponse['tools'][number]
type ResRow = IdentitiesResponse['resources'][number]
type UnknownRow = IdentitiesResponse['unknown'][number]

export default function Identities() {
  const q = useIdentities()
  // Delegations are only used to show the policy each principal received authority under.
  const dq = useQuery({ queryKey: wsKey('delegations'), queryFn: () => api.get<DelegationsResponse>('/api/delegations') })
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'principals'
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'principals') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  const data = q.data
  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Registry"
        title="Identity registry"
        description="Every principal, execution identity, credential, tool and resource in the active dataset, with lifecycle status at the latest action time."
        actions={<LinkButton to="/app/delegations" size="sm">Open delegations</LinkButton>}
      />
      {q.isLoading ? (
        <LoadingState label="Loading identity registry" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : !data ? null : data.principals.length + data.unknown.length + data.execution_identities.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<IconHuman size={28} />}
            title="No identities in this dataset"
            body="The active dataset has no principal, execution identity or credential records. Load the demo environment or import events that register identities."
            action={<LinkButton to="/app/import" variant="primary" size="sm">Import events</LinkButton>}
          />
        </Panel>
      ) : (
        <>
          <TypeSummary data={data} />
          <AsOfNote asOf={data.as_of} />
          <Tabs<Tab>
            label="Identity registry sections"
            value={tab}
            onChange={setTab}
            className="mb-4"
            tabs={[
              { id: 'principals', label: 'Principals', count: data.principals.length },
              { id: 'execution', label: 'Execution identities', count: data.execution_identities.length },
              { id: 'credentials', label: 'Credentials', count: data.credentials.length },
              { id: 'tools', label: 'Tools', count: data.tools.length },
              { id: 'resources', label: 'Resources', count: data.resources.length },
              { id: 'unknown', label: 'Unknown', count: data.unknown.length },
            ]}
          />
          <div role="tabpanel" aria-label={tab} className="min-w-0">
            {tab === 'principals' ? <PrincipalsTab data={data} delegations={dq.data} /> : null}
            {tab === 'execution' ? <ExecutionTab data={data} /> : null}
            {tab === 'credentials' ? <CredentialsTab data={data} /> : null}
            {tab === 'tools' ? <ToolsTab rows={data.tools} /> : null}
            {tab === 'resources' ? <ResourcesTab rows={data.resources} /> : null}
            {tab === 'unknown' ? <UnknownTab rows={data.unknown} /> : null}
          </div>
        </>
      )}
    </div>
  )
}

function TypeSummary({ data }: { data: IdentitiesResponse }) {
  const count = (t: PrincipalType) => data.principals.filter((p) => p.principal_type === t).length
  const workloads = count('workload') + count('service')
  const items = [
    { key: 'human', icon: <IconHuman size={15} />, count: count('human'), label: count('human') === 1 ? 'human principal' : 'human principals' },
    { key: 'agent', icon: <IconAgent size={15} />, count: count('agent'), label: count('agent') === 1 ? 'agent' : 'agents' },
    { key: 'sub', icon: <IconSubAgent size={15} />, count: count('sub_agent'), label: count('sub_agent') === 1 ? 'sub-agent' : 'sub-agents' },
    ...(workloads > 0 ? [{ key: 'workload', icon: <IconExecution size={15} />, count: workloads, label: 'workload or service principals' }] : []),
    { key: 'exec', icon: <IconExecution size={15} />, count: data.execution_identities.length, label: data.execution_identities.length === 1 ? 'execution identity' : 'execution identities' },
    { key: 'cred', icon: <IconCredential size={15} />, count: data.credentials.length, label: data.credentials.length === 1 ? 'credential' : 'credentials' },
    ...(data.unknown.length > 0 ? [{ key: 'unknown', icon: <PrincipalGlyph type={null} size={15} />, count: data.unknown.length, label: 'unknown, referenced but unregistered', tone: 'text-fog-ink' }] : []),
  ]
  return <CountStrip items={items} label="Identity counts by type" />
}

function AsOfNote({ asOf }: { asOf: string | null }) {
  return (
    <p className="mb-4 flex items-start gap-2 text-[12px] leading-relaxed text-ink-3">
      <Info size={13} className="mt-[3px] shrink-0" aria-hidden />
      {asOf ? (
        <span>
          Status is evaluated as of <span className="font-mono text-ink-2">{stamp(asOf)}</span>, the latest action time in this dataset, from each record&apos;s revoked, suspended and expiry times. It is not the status the source system exported.
        </span>
      ) : (
        <span>No action in this dataset has a timestamp, so lifecycle status cannot be evaluated and is shown as Unknown.</span>
      )}
    </p>
  )
}

// ------------------------------------------------------------------ principals

function PrincipalsTab({ data, delegations }: { data: IdentitiesResponse; delegations: DelegationsResponse | undefined }) {
  const nav = useNavigate()
  const [type, setType] = useState<'all' | PrincipalType>('all')
  const [life, setLife] = useState<'all' | LifecycleStatus>('all')
  const [text, setText] = useState('')
  const names = useMemo(() => new Map(data.principals.map((p) => [p.principal_id, p.display_name])), [data.principals])
  const delegationById = useMemo(() => new Map((delegations?.delegations ?? []).map((d) => [d.delegation_id, d])), [delegations])
  const credsByExec = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of data.credentials) if (c.execution_identity_id) m.set(c.execution_identity_id, (m.get(c.execution_identity_id) ?? 0) + 1)
    return m
  }, [data.credentials])

  const rows = data.principals.filter((p) => {
    if (type !== 'all' && p.principal_type !== type) return false
    if (life !== 'all' && p.lifecycle !== life) return false
    const t = text.trim().toLowerCase()
    if (t && !p.principal_id.toLowerCase().includes(t) && !p.display_name.toLowerCase().includes(t)) return false
    return true
  })
  const filtered = type !== 'all' || life !== 'all' || text.trim() !== ''
  const reset = () => {
    setType('all')
    setLife('all')
    setText('')
  }

  const columns: Column<RegistryPrincipal>[] = [
    {
      key: 'name',
      header: 'Identity',
      width: 'minmax(0,1.5fr)',
      cell: (p) => (
        <span className="flex min-w-0 items-start gap-2">
          <PrincipalGlyph type={p.principal_type} size={16} className="mt-0.5 text-ink-2" />
          <span className="min-w-0">
            <span className="block text-[13px] text-ink [overflow-wrap:anywhere]">{p.display_name}</span>
            <span className="id block text-[11px] text-ink-3">{p.principal_id}</span>
          </span>
        </span>
      ),
    },
    { key: 'type', header: 'Type', width: '92px', hideBelow: 'sm', cell: (p) => <span className="text-[12px] text-ink-2">{TYPE_LABEL[p.principal_type]}</span> },
    { key: 'issuer', header: 'Issuer', width: 'minmax(0,1fr)', hideBelow: 'lg', cell: (p) => (p.issuer ? <span className="id text-[11.5px]">{p.issuer}</span> : <span className="text-[12px] text-ink-4">—</span>) },
    {
      key: 'parent',
      header: 'Delegators',
      width: 'minmax(0,1fr)',
      hideBelow: 'md',
      cell: (p) =>
        p.parents.length === 0 ? (
          <span className="text-[12px] text-ink-3">{p.principal_type === 'human' || p.root_eligible ? 'root' : 'none recorded'}</span>
        ) : (
          <span className="block text-[12px] text-ink-2 [overflow-wrap:anywhere]">{p.parents.map((id) => (id ? (names.get(id) ?? id) : 'unknown')).join(', ')}</span>
        ),
    },
    { key: 'created', header: 'Created', width: '104px', hideBelow: 'lg', cell: (p) => <span className="font-mono text-[11.5px] text-ink-2">{day(p.created_at)}</span> },
    { key: 'status', header: 'Status', width: '104px', cell: (p) => <LifecycleBadge state={p.lifecycle} /> },
    {
      key: 'scope',
      header: 'Provisioned scope',
      width: 'minmax(0,1.4fr)',
      hideBelow: 'lg',
      cell: (p) =>
        (p.principal_type === 'agent' || p.principal_type === 'sub_agent') && p.provisioned_scope === null ? (
          <span className="text-[11.5px] text-ink-3" title="Agents hold only delegated authority, so no provisioned scope is expected.">
            not recorded · delegated only
          </span>
        ) : (
          <CompactScope scope={p.provisioned_scope} max={2} />
        ),
    },
    {
      key: 'exec',
      header: 'Execution identity',
      width: 'minmax(0,1fr)',
      hideBelow: 'lg',
      cell: (p) =>
        p.execution_identities.length === 0 ? (
          <span className="text-[12px] text-ink-4">—</span>
        ) : (
          <span className="block min-w-0">
            {p.execution_identities.map((e) => (
              <span key={e} className="id block text-[11px]">
                {e}
                <span className="ml-1 text-ink-3">· {credsByExec.get(e) ?? 0} cred.</span>
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'policy',
      header: 'Policy',
      width: '110px',
      hideBelow: 'lg',
      cell: (p) => {
        const pols = [...new Set(p.inbound_delegations.map((id) => delegationById.get(id)).filter((d) => d?.policy_id).map((d) => `${d!.policy_id} v${d!.policy_version ?? '?'}`))]
        return pols.length ? <span className="id block text-[11px]">{pols.join(', ')}</span> : <span className="text-[12px] text-ink-4">—</span>
      },
    },
    { key: 'activity', header: 'Last activity', width: '150px', hideBelow: 'md', cell: (p) => <span className="font-mono text-[11.5px] text-ink-2">{p.last_activity ? stamp(p.last_activity) : '—'}</span> },
    {
      key: 'findings',
      header: 'Findings',
      width: '72px',
      className: 'text-right',
      cell: (p) => (
        <span className={p.finding_count > 0 ? 'tnum font-mono text-[12.5px] text-ink' : 'tnum font-mono text-[12.5px] text-ink-4'} aria-label={`${p.finding_count} findings`}>
          {p.finding_count}
        </span>
      ),
    },
  ]

  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-end gap-3 border-b hairline px-4 py-3">
        <TextInput label="Search principals" placeholder="Name or identity ID" value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-64" />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as 'all' | PrincipalType)} className="w-[calc(50%-6px)] sm:w-40">
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select label="Status" value={life} onChange={(e) => setLife(e.target.value as 'all' | LifecycleStatus)} className="w-[calc(50%-6px)] sm:w-40">
          <option value="all">All statuses</option>
          {LIFECYCLES.map((l) => (
            <option key={l} value={l}>
              {l.charAt(0) + l.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <span className="ml-auto self-center font-mono text-[11px] text-ink-3" aria-live="polite">
          {rows.length} of {data.principals.length}
        </span>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(p) => p.principal_id}
        onRowClick={(p) => nav(`/app/identities/${encodeURIComponent(p.principal_id)}`)}
        caption="Principals: humans, agents and sub-agents"
        empty={
          <EmptyState
            title={filtered ? 'No principals match these filters' : 'No principals registered'}
            body={filtered ? 'Clear the filters to see every principal in the dataset.' : 'The dataset references identities but registers none. See the Unknown tab.'}
            action={
              filtered ? (
                <Button size="sm" icon={<RotateCcw size={13} />} onClick={reset}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        }
      />
    </Panel>
  )
}

// ------------------------------------------------------------------ execution identities

function ExecutionTab({ data }: { data: IdentitiesResponse }) {
  const nav = useNavigate()
  const names = new Map(data.principals.map((p) => [p.principal_id, p]))
  const columns: Column<ExecRow>[] = [
    {
      key: 'id',
      header: 'Execution identity',
      width: 'minmax(0,1.4fr)',
      cell: (e) => (
        <span className="flex min-w-0 items-start gap-2">
          <IconExecution size={15} className="mt-0.5 shrink-0 text-ink-2" />
          <span className="min-w-0">
            <span className="id block text-[12px] text-ink">{e.execution_identity_id}</span>
            {e.spiffe_id ? <span className="id block text-[11px] text-ink-3">{e.spiffe_id}</span> : null}
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', width: '88px', hideBelow: 'sm', cell: (e) => <span className="text-[12px] text-ink-2">{e.kind}</span> },
    {
      key: 'bound',
      header: 'Issued to principal',
      width: 'minmax(0,1fr)',
      hideBelow: 'md',
      cell: (e) => {
        if (!e.bound_principal_id) return <span className="text-[12px] italic text-amber-ink">no binding recorded</span>
        const p = names.get(e.bound_principal_id)
        return (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink">
            <PrincipalGlyph type={p?.principal_type} size={13} className="text-ink-2" />
            <span className="[overflow-wrap:anywhere]">{p?.display_name ?? e.bound_principal_id}</span>
          </span>
        )
      },
    },
    { key: 'scope', header: 'Standing scope', width: 'minmax(0,1.2fr)', hideBelow: 'lg', cell: (e) => <CompactScope scope={e.provisioned_scope} max={2} empty="none" /> },
    { key: 'issued', header: 'Issued', width: '104px', hideBelow: 'lg', cell: (e) => <span className="font-mono text-[11.5px] text-ink-2">{day(e.issued_at)}</span> },
    { key: 'expires', header: 'Expires', width: '104px', hideBelow: 'lg', cell: (e) => <span className="font-mono text-[11.5px] text-ink-2">{day(e.expires_at)}</span> },
    { key: 'status', header: 'Status', width: '104px', cell: (e) => <LifecycleBadge state={e.lifecycle} /> },
  ]
  return (
    <Panel bodyClassName="p-0">
      <p className="border-b hairline px-4 py-3 text-[12px] leading-relaxed text-ink-3">
        An execution identity is what an action runs as. Its standing scope belongs to the workload and is kept separate from delegated authority. Open a row to see its credential lineage.
      </p>
      <DataTable
        rows={data.execution_identities}
        columns={columns}
        rowKey={(e) => e.execution_identity_id}
        onRowClick={(e) => nav(`/app/credentials?focus=${encodeURIComponent(e.execution_identity_id)}`)}
        caption="Execution identities"
        empty={<EmptyState title="No execution identities registered" body="Actions in this dataset do not record the workload identity they ran as, so credential binding cannot be verified." action={<LinkButton to="/app/import" size="sm">Import events</LinkButton>} />}
      />
    </Panel>
  )
}

// ------------------------------------------------------------------ credentials

function CredentialsTab({ data }: { data: IdentitiesResponse }) {
  const nav = useNavigate()
  const columns: Column<CredRow>[] = [
    {
      key: 'id',
      header: 'Credential',
      width: 'minmax(0,1.3fr)',
      cell: (c) => (
        <span className="flex min-w-0 items-start gap-2">
          <IconCredential size={15} className="mt-0.5 shrink-0 text-ink-2" />
          <span className="id text-[12px] text-ink">{c.credential_id}</span>
        </span>
      ),
    },
    { key: 'type', header: 'Type', width: 'minmax(0,0.9fr)', hideBelow: 'sm', cell: (c) => <span className="text-[12px] text-ink-2">{c.credential_type.replace(/_/g, ' ')}</span> },
    { key: 'binding', header: 'Credential binding', width: 'minmax(0,1.1fr)', hideBelow: 'md', cell: (c) => (c.execution_identity_id ? <span className="id text-[11.5px]">{c.execution_identity_id}</span> : <span className="text-[12px] italic text-amber-ink">no binding recorded</span>) },
    { key: 'issued', header: 'Issued', width: '104px', hideBelow: 'lg', cell: (c) => <span className="font-mono text-[11.5px] text-ink-2">{day(c.issued_at)}</span> },
    { key: 'expires', header: 'Expires', width: '104px', hideBelow: 'lg', cell: (c) => <span className="font-mono text-[11.5px] text-ink-2">{day(c.expires_at)}</span> },
    { key: 'revoked', header: 'Revoked', width: '104px', hideBelow: 'lg', cell: (c) => <span className="font-mono text-[11.5px] text-ink-2">{day(c.revoked_at)}</span> },
    { key: 'status', header: 'Status', width: '104px', cell: (c) => <LifecycleBadge state={c.lifecycle} /> },
  ]
  return (
    <Panel bodyClassName="p-0">
      <div className="flex items-start gap-2.5 border-b hairline px-4 py-3 text-[12px] leading-relaxed text-ink-2">
        <Lock size={14} className="mt-[2px] shrink-0 text-ink-3" aria-hidden />
        <p>
          <span className="font-medium text-ink">Metadata only.</span> REGENT records a credential&apos;s type, binding and validity window. It never stores token values, keys or any other secret material. Open a row to trace its lineage.
        </p>
      </div>
      <DataTable
        rows={data.credentials}
        columns={columns}
        rowKey={(c) => c.credential_id}
        onRowClick={(c) => nav(`/app/credentials?focus=${encodeURIComponent(c.credential_id)}`)}
        caption="Credentials, metadata only"
        empty={<EmptyState title="No credentials registered" body="No credential metadata is in this dataset, so REGENT cannot check which credential authenticated each action." action={<LinkButton to="/app/import" size="sm">Import events</LinkButton>} />}
      />
    </Panel>
  )
}

// ------------------------------------------------------------------ tools and resources

function ToolsTab({ rows }: { rows: ToolRow[] }) {
  const columns: Column<ToolRow>[] = [
    {
      key: 'name',
      header: 'Tool',
      width: 'minmax(0,1.4fr)',
      cell: (t) => (
        <span className="flex min-w-0 items-start gap-2">
          <IconTool size={15} className="mt-0.5 shrink-0 text-ink-2" />
          <span className="min-w-0">
            <span className="block text-[13px] text-ink [overflow-wrap:anywhere]">{t.display_name}</span>
            <span className="id block text-[11px] text-ink-3">{t.tool_id}</span>
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', width: '120px', cell: (t) => <Badge>{t.kind}</Badge> },
    { key: 'event', header: 'Source event', width: 'minmax(0,1fr)', hideBelow: 'md', cell: (t) => <span className="id text-[11px]">{t.event_id ?? '—'}</span> },
  ]
  return (
    <Panel bodyClassName="p-0">
      <p className="border-b hairline px-4 py-3 text-[12px] leading-relaxed text-ink-3">A tool is the interface an action executes through. Tools are never principals: they hold no authority and never appear as a delegation hop.</p>
      <DataTable rows={rows} columns={columns} rowKey={(t) => t.tool_id} caption="Tools" empty={<EmptyState title="No tools registered" body="Actions that name an unregistered tool are reported under AUTH-009." action={<LinkButton to="/app/import" size="sm">Import events</LinkButton>} />} />
    </Panel>
  )
}

function ResourcesTab({ rows }: { rows: ResRow[] }) {
  const columns: Column<ResRow>[] = [
    {
      key: 'name',
      header: 'Resource',
      width: 'minmax(0,1.4fr)',
      cell: (r) => (
        <span className="flex min-w-0 items-start gap-2">
          <IconResource size={15} className="mt-0.5 shrink-0 text-ink-2" />
          <span className="min-w-0">
            <span className="block text-[13px] text-ink [overflow-wrap:anywhere]">{r.display_name}</span>
            <span className="id block text-[11px] text-ink-3">{r.resource_id}</span>
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', width: '120px', cell: (r) => <Badge>{r.kind}</Badge> },
    { key: 'event', header: 'Source event', width: 'minmax(0,1fr)', hideBelow: 'md', cell: (r) => <span className="id text-[11px]">{r.event_id ?? '—'}</span> },
  ]
  return (
    <Panel bodyClassName="p-0">
      <p className="border-b hairline px-4 py-3 text-[12px] leading-relaxed text-ink-3">A resource is what an action operates on. Resources are targets, never principals.</p>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.resource_id} caption="Resources" empty={<EmptyState title="No resources registered" body="Actions that target an unregistered resource are reported under AUTH-009." action={<LinkButton to="/app/import" size="sm">Import events</LinkButton>} />} />
    </Panel>
  )
}

// ------------------------------------------------------------------ unknown

function UnknownTab({ rows }: { rows: UnknownRow[] }) {
  const nav = useNavigate()
  const columns: Column<UnknownRow>[] = [
    {
      key: 'id',
      header: 'Referenced identity',
      width: 'minmax(0,1fr)',
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-2">
          <PrincipalGlyph type={null} size={16} />
          <span className="id text-[12px] text-ink">{u.principal_id}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', width: '104px', cell: (u) => <LifecycleBadge state={u.lifecycle} /> },
  ]
  return (
    <Panel bodyClassName="p-0">
      <div className="border-b hairline px-4 py-3.5">
        <h2 className="text-[13px] font-medium text-ink">Referenced by evidence, never registered</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-2">
          These identities appear as a delegator, delegatee or actor in the evidence but have no principal record. An unknown identity cannot hold implicit authority: REGENT never assumes it is legitimate, so chains through it are reported as incomplete or unknown under <span className="font-mono">AUTH-009</span>, not as verified.
        </p>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(u) => u.principal_id}
        onRowClick={(u) => nav(`/app/identities/${encodeURIComponent(u.principal_id)}`)}
        caption="Unknown identities referenced by evidence"
        empty={<EmptyState title="Every referenced identity is registered" body="Each delegator, delegatee and actor in this dataset has a principal record." />}
      />
    </Panel>
  )
}

