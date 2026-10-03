import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { day, plural, stamp } from '../lib/format'
import type { Delegation, ExecutionIdentity, PrincipalType } from '../lib/types'
import { IconDelegation, IconExecution } from '../brand/icons'
import { Badge, LinkButton, PageHeader, Panel, KV } from '../ui/primitives'
import { LifecycleBadge } from '../ui/status'
import { ScopeChips } from '../ui/scope'
import { CopyButton } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { ActionsTable, FindingsList, INTEGRITY, PrincipalGlyph, TYPE_LABEL, useIdentities, useStagger } from '../components/registry/common'
import type { DelegationsResponse, IdentityDetailResponse, RegistryDelegation } from '../components/registry/types'

export default function IdentityDetail() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: wsKey('identity', id), queryFn: () => api.get<IdentityDetailResponse>(`/api/identities/${encodeURIComponent(id)}`), enabled: !!id })
  // Secondary: names, types and lifecycle for the delegations listed here.
  const reg = useIdentities()
  const dq = useQuery({ queryKey: wsKey('delegations'), queryFn: () => api.get<DelegationsResponse>('/api/delegations') })
  const stagger = useStagger()

  const people = useMemo(() => new Map((reg.data?.principals ?? []).map((p) => [p.principal_id, p])), [reg.data])
  const contracts = useMemo(() => new Map((dq.data?.delegations ?? []).map((d) => [d.delegation_id, d])), [dq.data])

  const back = (
    <Link to="/app/identities" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft size={13} aria-hidden /> Identity registry
    </Link>
  )

  if (q.isLoading) return <>{back}<LoadingState label="Loading identity" /></>
  if (q.isError) return <>{back}<ErrorState error={q.error} retry={() => void q.refetch()} /></>
  const d = q.data
  if (!d) return null

  const p = d.principal
  const registered = people.get(id)
  const lifecycle = registered?.lifecycle ?? (d.known ? null : 'UNKNOWN')
  const typeLabel = p ? TYPE_LABEL[p.principal_type] : 'Unknown identity'

  return (
    <div className="min-w-0">
      {back}
      <PageHeader
        eyebrow={`Identity · ${typeLabel}`}
        title={p?.display_name ?? id}
        description={
          d.known
            ? `Where ${p?.display_name ?? id} receives authority from, whom it delegates to, what it executes as, and every action that relied on it.`
            : 'This identity is referenced by the evidence but has no principal record in the active dataset.'
        }
      />

      {/* Identity card */}
      <section aria-label="Identity card" className="panel mb-5 anim-fade-up overflow-hidden" style={stagger(0)}>
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-start">
          <div className={d.known ? 'flex h-14 w-14 shrink-0 items-center justify-center rounded-md border hairline-strong bg-s2 text-ink' : 'flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-fog/50 bg-fog/[0.06]'} aria-hidden>
            <PrincipalGlyph type={p?.principal_type} size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="id text-[12.5px] text-ink">{id}</span>
              <CopyButton text={id} label="Copy ID" />
            </div>
            <KV
              className="mt-3"
              rows={[
                ['Type', p ? TYPE_LABEL[p.principal_type] : <span className="italic text-fog-ink">not recorded</span>],
                ['Issuer', p?.issuer ? <span className="id">{p.issuer}</span> : <span className="text-ink-3">—</span>],
                [
                  'Status',
                  <span key="s" className="inline-flex flex-wrap items-center gap-2">
                    {lifecycle ? <LifecycleBadge state={lifecycle} /> : <span className="text-ink-3">—</span>}
                    {reg.data?.as_of && lifecycle ? <span className="text-[11.5px] text-ink-3">as of {stamp(reg.data.as_of)}</span> : null}
                    {p && p.recorded_status !== lifecycle ? <span className="text-[11.5px] text-ink-3">recorded at export: {p.recorded_status.toLowerCase()}</span> : null}
                  </span>,
                ],
                ['Created', <span key="c" className="font-mono text-[12px]">{stamp(p?.created_at)}</span>],
                ...(p?.suspended_at ? ([['Suspended', <span key="su" className="font-mono text-[12px]">{stamp(p.suspended_at)}</span>]] as [string, React.ReactNode][]) : []),
                ...(p?.revoked_at ? ([['Revoked', <span key="r" className="font-mono text-[12px]">{stamp(p.revoked_at)}</span>]] as [string, React.ReactNode][]) : []),
                ...(p?.expires_at ? ([['Expires', <span key="e" className="font-mono text-[12px]">{stamp(p.expires_at)}</span>]] as [string, React.ReactNode][]) : []),
                ['Root principal', p ? (p.root_eligible ? 'Eligible to originate a delegation chain' : 'Not root-eligible') : <span className="italic text-fog-ink">unknown</span>],
                [
                  'Provisioned scope',
                  p && (p.principal_type === 'agent' || p.principal_type === 'sub_agent') && p.provisioned_scope === null ? (
                    <span className="text-ink-3">Not recorded. Agents hold only delegated authority.</span>
                  ) : (
                    <ScopeChips key="ps" scope={p ? p.provisioned_scope : null} />
                  ),
                ],
              ]}
            />
          </div>
          <dl className="grid shrink-0 grid-cols-3 gap-px overflow-hidden rounded border hairline bg-[rgb(var(--line)/0.08)] text-center md:w-[260px]">
            {[
              ['Inbound', d.inbound.length],
              ['Outbound', d.outbound.length],
              ['Findings', d.findings.length],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-s1 px-2 py-2.5">
                <dt className="eyebrow">{k}</dt>
                <dd className="tnum mt-1 font-mono text-[16px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {!d.known ? (
          <div className="border-t border-fog/30 bg-fog/[0.05] px-5 py-4" role="note">
            <h2 className="flex items-center gap-2 text-[13px] font-medium text-fog-ink">
              <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]">?</span>
              Unknown identity
            </h2>
            <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">
              No principal record exists for <span className="id">{id}</span>, so its type, issuer, lifecycle and provisioned scope are unknown. An unknown identity cannot receive implicit authority: REGENT never assumes it is legitimate, and chains that pass through it are reported as incomplete or unknown under <span className="font-mono">AUTH-009</span>. Missing evidence here is not the same as a violation. Register the identity in the source system and re-import to verify it.
            </p>
          </div>
        ) : null}
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="anim-fade-up min-w-0" style={stagger(1)}>
          <Panel title="Receives authority from" eyebrow="Inbound delegations" id="inbound" bodyClassName="p-0">
            <DelegationList
              items={d.inbound}
              direction="in"
              contracts={contracts}
              people={people}
              empty={p?.principal_type === 'human' || p?.root_eligible ? 'No inbound delegation. A root principal holds its provisioned scope directly.' : 'No inbound delegation is recorded. An agent with no delegation holds no authority to act on.'}
            />
          </Panel>
        </div>
        <div className="anim-fade-up min-w-0" style={stagger(2)}>
          <Panel title="Delegates authority to" eyebrow="Outbound delegations" id="outbound" bodyClassName="p-0">
            <DelegationList items={d.outbound} direction="out" contracts={contracts} people={people} empty="This identity has not delegated authority to any principal." />
          </Panel>
        </div>
      </div>

      <div className="mt-5 anim-fade-up" style={stagger(3)}>
        <Panel title="Execution identities" eyebrow="Issued to act for this principal" id="exec" bodyClassName="p-0">
          <ExecList items={d.execution_identities} />
        </Panel>
      </div>

      <div className="mt-5 anim-fade-up" style={stagger(4)}>
        <Panel title={`Actions · ${d.actions.length}`} eyebrow="Actions this identity performed or delegated authority for" id="actions" bodyClassName="p-0">
          <ActionsTable rows={d.actions} caption={`Actions involving ${p?.display_name ?? id}`} empty="No action in this dataset relied on this identity." />
        </Panel>
      </div>

      <div className="mt-5 anim-fade-up" style={stagger(5)}>
        <Panel title={`Findings · ${d.findings.length}`} eyebrow="Findings that name this identity" id="findings" bodyClassName="p-0">
          <FindingsList findings={d.findings} empty="No finding names this identity." />
        </Panel>
      </div>
    </div>
  )
}

function DelegationList({
  items,
  direction,
  contracts,
  people,
  empty,
}: {
  items: Delegation[]
  direction: 'in' | 'out'
  contracts: Map<string, RegistryDelegation>
  people: Map<string, { display_name: string; principal_type: PrincipalType }>
  empty: string
}) {
  if (items.length === 0) {
    return <EmptyState className="py-8" icon={<IconDelegation size={22} />} title={direction === 'in' ? 'No inbound delegation' : 'No outbound delegation'} body={empty} />
  }
  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
      {items.map((dl) => {
        const other = direction === 'in' ? dl.delegator_principal_id : dl.delegatee_principal_id
        const op = other ? people.get(other) : undefined
        const c = contracts.get(dl.delegation_id)
        const seal = c ? INTEGRITY[c.contract_integrity] : null
        return (
          <li key={dl.delegation_id}>
            <Link to={`/app/delegations/${encodeURIComponent(dl.delegation_id)}`} className="group block px-4 py-3 transition-colors hover:bg-s2 focus-visible:bg-s2" aria-label={`Open delegation contract ${dl.delegation_id}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-ink-2">
                  <PrincipalGlyph type={op?.principal_type} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="eyebrow">{direction === 'in' ? 'from' : 'to'}</span>
                    <span className="text-[13px] text-ink [overflow-wrap:anywhere] group-hover:text-copper-ink">{op?.display_name ?? other ?? 'unknown principal'}</span>
                  </span>
                  <span className="id mt-0.5 block text-[11px] text-ink-3">{dl.delegation_id}</span>
                  <span className="mt-2 block">
                    <span className="eyebrow mr-2">Granted</span>
                    <ScopeChips scope={dl.granted_scope} highlight={c?.amplified ?? []} />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                    <span>{dl.policy_id ? <span className="font-mono">{dl.policy_id} v{dl.policy_version ?? '?'}</span> : 'no policy recorded'}</span>
                    <span>expires {day(dl.expires_at)}</span>
                    {seal && c ? (
                      <span className={`inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] ${seal.text}`}>
                        <span aria-hidden>{seal.glyph}</span>
                        {seal.short}
                      </span>
                    ) : null}
                  </span>
                </span>
                <ChevronRight size={14} className="mt-1 shrink-0 text-ink-4 group-hover:text-ink-2" aria-hidden />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function ExecList({ items }: { items: ExecutionIdentity[] }) {
  if (items.length === 0) {
    return <EmptyState className="py-8" icon={<IconExecution size={22} />} title="No execution identity bound" body="No workload identity is recorded as issued to this principal, so credential binding for its actions cannot be checked." action={<LinkButton to="/app/credentials" size="sm">Open credential lineage</LinkButton>} />
  }
  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
      {items.map((e) => (
        <li key={e.execution_identity_id}>
          <Link to={`/app/credentials?focus=${encodeURIComponent(e.execution_identity_id)}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-s2 focus-visible:bg-s2">
            <IconExecution size={15} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="id block text-[12px] text-ink group-hover:text-copper-ink">{e.execution_identity_id}</span>
              {e.spiffe_id ? <span className="id block text-[11px] text-ink-3">{e.spiffe_id}</span> : null}
            </span>
            <Badge>{e.kind}</Badge>
            <span className="text-[11.5px] text-ink-3">standing scope: {e.provisioned_scope ? plural(e.provisioned_scope.length, 'permission') : 'not recorded'}</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              recorded <LifecycleBadge state={e.recorded_status} />
            </span>
            <ChevronRight size={14} className="shrink-0 text-ink-4 group-hover:text-ink-2" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}
