import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { stamp } from '../lib/format'
import type { Delegation, ResolvedHop } from '../lib/types'
import { IconPolicy } from '../brand/icons'
import { cx, KV, LinkButton, PageHeader, Panel } from '../ui/primitives'
import { LifecycleBadge, ResultBadge } from '../ui/status'
import { ScopeChip, ScopeChips } from '../ui/scope'
import { CopyButton } from '../ui/data'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { ActionsTable, ApprovalBadge, FindingsList, INTEGRITY, PrincipalGlyph, PrincipalLink, usePrincipalIndex, useStagger } from '../components/registry/common'
import type { ContractIntegrity, DelegationDetailResponse } from '../components/registry/types'

export default function DelegationDetail() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: wsKey('delegation', id), queryFn: () => api.get<DelegationDetailResponse>(`/api/delegations/${encodeURIComponent(id)}`), enabled: !!id })
  const index = usePrincipalIndex()
  const stagger = useStagger(40)

  const back = (
    <Link to="/app/delegations" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft size={13} aria-hidden /> Delegation registry
    </Link>
  )
  if (q.isLoading) return <>{back}<LoadingState label="Loading delegation contract" /></>
  if (q.isError) return <>{back}<ErrorState error={q.error} retry={() => void q.refetch()} /></>
  const r = q.data
  if (!r) return null

  const d = r.delegation
  const fromName = r.delegator_name ?? d.delegator_principal_id ?? 'An unrecorded delegator'
  const toName = r.delegatee_name ?? d.delegatee_principal_id ?? 'an unrecorded delegatee'
  const resources = [...new Set(r.used_by.map((u) => u.resource_name ?? u.resource_id).filter((x): x is string => !!x))]
  const nameOf = (pid: string | null) => (pid ? (index.get(pid)?.name ?? pid) : null)

  return (
    <div className="min-w-0">
      {back}
      <PageHeader
        eyebrow={`Delegation contract · ${d.delegation_id}`}
        title={`${fromName} to ${toName}`}
        description="The delegation as a written instrument, sealed with REGENT's verdict and the reasoning behind it, then the lineage and every action that relied on it."
        actions={<CopyButton text={d.delegation_id} label="Copy delegation ID" />}
      />

      {/* ------------------------------------------------ the instrument */}
      <article aria-labelledby="contract-title" className="relative mx-auto max-w-3xl anim-fade-up" style={stagger(0)}>
        <div className={cx('rounded-[3px] border-[3px] border-double bg-s1 px-5 pb-14 pt-8 sm:px-12 sm:pt-10', r.contract_integrity === 'VIOLATION' ? 'border-crimson/45' : 'border-[rgb(var(--line-strong)/0.22)]')}>
          <header className="text-center">
            <h2 id="contract-title" className="eyebrow">Delegation contract</h2>
            <p className="id mt-1.5 text-[12.5px] uppercase tracking-[0.04em] text-ink">{d.delegation_id}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-3">executed {stamp(d.created_at)}</p>
            <div className="mx-auto mt-5 h-px w-16 bg-[rgb(var(--line-strong)/0.25)]" aria-hidden />
          </header>

          <p className="mt-8 text-center font-display text-[26px] leading-[1.25] text-ink sm:text-[32px]">
            <Party id={d.delegator_principal_id} name={fromName} type={d.delegator_principal_id ? index.get(d.delegator_principal_id)?.type : null} /> <span className="italic text-ink-2">authorizes</span>{' '}
            <Party id={d.delegatee_principal_id} name={toName} type={d.delegatee_principal_id ? index.get(d.delegatee_principal_id)?.type : null} />
          </p>

          <dl className="mx-auto mt-8 max-w-xl space-y-4">
            <Clause term="to exercise">
              <ScopeChips scope={d.granted_scope} highlight={r.hop?.amplified ?? []} empty="no permissions" />
            </Clause>
            <Clause term="against">
              {resources.length > 0 ? (
                <span className="text-[13.5px] text-ink [overflow-wrap:anywhere]">{resources.join(', ')}</span>
              ) : (
                <span className="text-[13.5px] text-ink-2">any resource within scope</span>
              )}
            </Clause>
            <Clause term="until">
              <span className="font-mono text-[12.5px] text-ink">{d.expires_at ? stamp(d.expires_at) : <span className="italic text-ink-2">no expiry recorded</span>}</span>
              {d.revoked_at ? <span className="ml-2 font-mono text-[11.5px] text-crimson-ink">revoked {stamp(d.revoked_at)}</span> : null}
            </Clause>
            <Clause term="under">
              {d.policy_id ? (
                <span className="text-[13.5px] text-ink">
                  Policy <span className="font-mono text-[12.5px]">{d.policy_id}</span> v<span className="font-mono text-[12.5px]">{d.policy_version ?? '?'}</span>
                  {r.policy ? <span className="ml-1.5 text-ink-3">· {r.policy.display_name}</span> : null}
                </span>
              ) : (
                <span className="text-[13.5px] italic text-amber-ink">no policy recorded</span>
              )}
            </Clause>
            <Clause term="Approval">
              <ApprovalBadge state={d.approval_state} />
            </Clause>
            {d.restrictions.length > 0 ? (
              <Clause term="subject to">
                <ul className="space-y-1">
                  {d.restrictions.map((x) => (
                    <li key={x} className="flex items-baseline gap-2 text-[13px] text-ink">
                      <span className="text-ink-4" aria-hidden>
                        §
                      </span>
                      <span className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{x}</span>
                    </li>
                  ))}
                </ul>
              </Clause>
            ) : null}
          </dl>

          <footer className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t hairline pt-4 text-[11.5px] text-ink-3">
            <span>
              Root principal: <span className="text-ink-2">{nameOf(d.root_principal_id) ?? 'not recorded'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              Recorded status <LifecycleBadge state={d.recorded_status} />
            </span>
            {d.requested_scope ? (
              <span>
                Requested: <span className="font-mono text-ink-2">{d.requested_scope.join(', ') || 'none'}</span>
              </span>
            ) : null}
          </footer>
        </div>
        <Seal integrity={r.contract_integrity} />
      </article>
      <p className="mx-auto mt-12 max-w-xl text-center text-[12px] leading-relaxed text-ink-2">{sealExplanation(r)}</p>

      {/* ------------------------------------------------ reasoning */}
      <div className="mt-10 anim-fade-up" style={stagger(1)}>
        <Panel title="Why this verdict" eyebrow="Delegation hop as resolved by the engine" id="reasoning">
          {r.hop ? <HopReasoning hop={r.hop} requested={d.requested_scope} /> : (
            <EmptyState
              className="py-6"
              title="This delegation was never resolved as a hop"
              body="No action relied on it, so REGENT never computed what the delegator held, the effective scope or any amplification. Those values are unknown, not empty, and nothing here is a violation."
              action={<LinkButton to="/app/chains" size="sm">Browse chains</LinkButton>}
            />
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------ lineage + policy */}
      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 anim-fade-up" style={stagger(2)}>
          <Panel title="Lineage" eyebrow="Parent delegation, this contract, sub-delegations" id="lineage">
            <Lineage d={d} parent={r.parent} children={r.children} nameOf={nameOf} />
          </Panel>
        </div>
        <div className="min-w-0 anim-fade-up" style={stagger(3)}>
          <Panel title="Governing policy" eyebrow="Recorded by the system under audit" id="policy">
            {r.policy ? (
              <div>
                <div className="mb-3 flex items-start gap-2.5">
                  <IconPolicy size={16} className="mt-0.5 shrink-0 text-ink-2" />
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{r.policy.display_name}</div>
                    <div className="id text-[11px] text-ink-3">
                      {r.policy.policy_id} v{r.policy.policy_version}
                    </div>
                  </div>
                </div>
                <KV
                  rows={[
                    ['Scope ceiling', r.policy.scope_ceiling ? <ScopeChips key="c" scope={r.policy.scope_ceiling} /> : <span className="text-ink-3">no ceiling recorded</span>],
                    ['Approval required for', <ScopeChips key="a" scope={r.policy.approval_required_for} empty="nothing" />],
                  ]}
                />
                <LinkButton to="/app/policy?tab=policies" size="sm" variant="ghost" className="mt-3">
                  Open policy engine
                </LinkButton>
              </div>
            ) : d.policy_id ? (
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                The delegation names <span className="font-mono">{d.policy_id}</span> v<span className="font-mono">{d.policy_version ?? '?'}</span>, but that policy version is not in the evidence. Its ceiling and approval requirements are unknown.
              </p>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-ink-2">No policy is recorded for this delegation, so no policy ceiling narrows its effective scope. AUTH-007 asks for the policy version with every decision.</p>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-5 anim-fade-up" style={stagger(4)}>
        <Panel title={`Used by · ${r.used_by.length}`} eyebrow="Actions whose delegation chain passes through this contract" id="used-by" bodyClassName="p-0">
          <ActionsTable rows={r.used_by} caption={`Actions relying on delegation ${d.delegation_id}`} empty="No action relied on this delegation." />
        </Panel>
      </div>

      <div className="mt-5 anim-fade-up" style={stagger(5)}>
        <Panel title={`Findings · ${r.findings.length}`} eyebrow="Findings located on this delegation or citing it as evidence" id="findings" bodyClassName="p-0">
          <FindingsList findings={r.findings} empty="No finding is located on this delegation." />
        </Panel>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ instrument parts

function Party({ id, name, type }: { id: string | null; name: string; type: Parameters<typeof PrincipalGlyph>[0]['type'] }) {
  if (!id) return <span className="italic text-fog-ink">{name}</span>
  return (
    <Link to={`/app/identities/${encodeURIComponent(id)}`} className="inline-flex items-baseline gap-2 text-ink underline decoration-[rgb(var(--line-strong)/0.25)] decoration-1 underline-offset-[6px] transition-colors hover:text-copper-ink hover:decoration-copper/60">
      <PrincipalGlyph type={type} size={20} className="translate-y-[2px] text-ink-2" />
      {name}
    </Link>
  )
}

function Clause({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="font-display text-[19px] italic leading-tight text-ink-2 sm:text-right">{term}:</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function Seal({ integrity }: { integrity: ContractIntegrity }) {
  const s = INTEGRITY[integrity]
  const text = integrity === 'VIOLATION' ? 'Contract violation' : `Contract integrity: ${integrity}`
  return (
    <div className="absolute inset-x-0 -bottom-7 flex justify-center px-4">
      <div role="status" aria-label={text} className={cx('flex items-center gap-3 rounded-[3px] border-[3px] border-double bg-canvas px-5 py-3', s.border)}>
        <span className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-[16px] font-semibold', s.border, s.text, s.bg)} aria-hidden>
          {s.glyph}
        </span>
        <span className={cx('font-mono text-[13px] font-semibold uppercase tracking-[0.18em] sm:text-[15px]', s.text)}>{text}</span>
      </div>
    </div>
  )
}

function sealExplanation(r: DelegationDetailResponse): string {
  const n = r.findings.length
  switch (r.contract_integrity) {
    case 'PASS':
      return `${r.used_by.length} ${r.used_by.length === 1 ? 'action' : 'actions'} relied on this delegation and no finding is located on it.`
    case 'WARN':
      return `${n} ${n === 1 ? 'finding' : 'findings'} of medium or lower severity ${n === 1 ? 'is' : 'are'} located on this delegation. None is high or critical.`
    case 'VIOLATION':
      return 'At least one high or critical finding is located on this delegation. The reasoning and findings below show where authority broke.'
    case 'UNVERIFIED':
      return 'No action relied on this delegation, so there is nothing to verify it against. Unverified is not violated.'
  }
}

// ------------------------------------------------------------------ reasoning

const TEMPORAL_TEXT: Record<ResolvedHop['temporal'], string> = {
  VALID: 'The delegation was within its validity window at action time.',
  NOT_YET_VALID: 'The action ran before the delegation was created.',
  EXPIRED: 'The action ran after the delegation expired.',
  REVOKED: 'The action ran after the delegation was revoked.',
  UNKNOWN: 'The action time or the delegation window is not recorded, so validity cannot be established.',
}

function HopReasoning({ hop, requested }: { hop: ResolvedHop; requested: readonly string[] | null }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-2">
          Hop result <ResultBadge result={hop.result} />
        </span>
        <span className="inline-flex items-center gap-2">
          Hop index <span className="tnum font-mono text-ink-2">{hop.hop_index}</span>
        </span>
        <span>
          Linked by <span className="text-ink-2">{hop.link === 'explicit' ? 'a recorded reference' : 'a unique registry lookup'}</span>
        </span>
      </div>

      <HopScopeTable hop={hop} requested={requested} />

      <div className="grid gap-4 md:grid-cols-3">
        <ScopeBlock title="Amplified" tone="crimson" note="Authority that appeared from nowhere: granted, but not held by the delegator." scope={hop.amplified} empty="Nothing. Every granted permission was held by the delegator." chipTone="excess" />
        <ScopeBlock title="Carried amplification" tone="crimson" note="Authority amplified at an earlier hop and passed through this one." scope={hop.inherited_amplified} empty="None carried from earlier hops." chipTone="excess" />
        <ScopeBlock title="Policy restricted" tone="neutral" note="Removed from the effective scope by the governing policy ceiling." scope={hop.policy_restricted} empty="The policy ceiling removed nothing." chipTone="restricted" />
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded border hairline p-3.5">
          <div className="eyebrow mb-2">Temporal validity at action time</div>
          <div className="flex items-center gap-2">
            <LifecycleBadge state={hop.temporal} />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{TEMPORAL_TEXT[hop.temporal]}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Evaluated at the time of the first action that relied on this delegation.</p>
        </div>
        <div className="rounded border hairline p-3.5">
          <div className="eyebrow mb-2">Engine reasons</div>
          {hop.reasons.length ? (
            <ol className="space-y-1.5">
              {hop.reasons.map((x, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink">
                  <span className="tnum mt-[1px] font-mono text-[10.5px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{x}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] text-ink-3">The engine recorded no reasons for this hop.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ScopeBlock({ title, note, scope, empty, chipTone, tone }: { title: string; note: string; scope: readonly string[]; empty: string; chipTone: 'excess' | 'restricted'; tone: 'crimson' | 'neutral' }) {
  const active = scope.length > 0
  return (
    <div className={cx('rounded border p-3.5', active && tone === 'crimson' ? 'border-crimson/40 bg-crimson/[0.05]' : 'hairline')}>
      <div className={cx('eyebrow mb-1', active && tone === 'crimson' && 'text-crimson-ink')}>
        {active && tone === 'crimson' ? <span aria-hidden>✕ </span> : null}
        {title}
      </div>
      <p className="mb-2 text-[11.5px] leading-snug text-ink-3">{note}</p>
      {active ? (
        <span className="flex flex-wrap gap-1">
          {scope.map((p) => (
            <ScopeChip key={p} perm={p} tone={chipTone} />
          ))}
        </span>
      ) : (
        <p className="text-[12px] text-ink-2">{empty}</p>
      )}
    </div>
  )
}

/**
 * Held / granted / requested / effective, aligned by permission. A local
 * variant of AuthorityDiff without the Exercised column, which does not apply
 * to a delegation. The amplified and restricted lists come from the engine.
 */
function HopScopeTable({ hop, requested }: { hop: ResolvedHop; requested: readonly string[] | null }) {
  const cols: { key: string; label: string; set: readonly string[] | null }[] = [
    { key: 'available', label: 'Delegator held', set: hop.available_scope },
    { key: 'granted', label: 'Granted', set: hop.granted_scope },
    { key: 'requested', label: 'Requested', set: requested },
    { key: 'effective', label: 'Effective', set: hop.effective_scope },
  ]
  const all = [...new Set([...(hop.available_scope ?? []), ...(hop.granted_scope ?? []), ...(requested ?? []), ...(hop.effective_scope ?? []), ...hop.amplified, ...hop.policy_restricted])].sort()
  if (all.length === 0) return <p className="text-[12.5px] text-ink-3">No permissions are recorded on this hop.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left">
        <caption className="sr-only">For each permission: whether the delegator held it, and whether it was granted, requested and effective at this hop.</caption>
        <thead>
          <tr>
            <th scope="col" className="eyebrow pb-2 pr-4 font-normal">
              Permission
            </th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className="eyebrow pb-2 pr-3 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((p) => {
            const amp = hop.amplified.includes(p)
            const restricted = hop.policy_restricted.includes(p)
            return (
              <tr key={p} className={cx('border-t hairline', amp && 'bg-crimson/[0.07]')}>
                <th scope="row" className="py-1.5 pr-4 font-normal">
                  <span className={cx('font-mono text-[12px]', amp ? 'text-crimson-ink' : restricted ? 'text-ink-3 line-through' : 'text-ink')}>{p}</span>
                  {amp ? <span className="ml-2 font-mono text-[10px] font-semibold tracking-[0.1em] text-crimson-ink">← AMPLIFIED</span> : null}
                  {restricted ? <span className="ml-2 font-mono text-[10px] tracking-[0.1em] text-ink-3">removed by policy ceiling</span> : null}
                </th>
                {cols.map((c) => {
                  const unknown = c.set === null
                  const has = !unknown && c.set!.includes(p)
                  return (
                    <td key={c.key} className="py-1.5 pr-3 text-center font-mono text-[12px]">
                      {unknown ? (
                        <span className="text-fog-ink" title="Not recorded" aria-label="unknown">
                          ?
                        </span>
                      ) : has ? (
                        <span className={amp && c.key === 'granted' ? 'text-crimson-ink' : 'text-ink'} aria-label="present">
                          ●
                        </span>
                      ) : (
                        <span className="text-ink-4" aria-label="absent">
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-ink-3">● present · absent · ? not recorded (unknown, not empty)</p>
    </div>
  )
}

// ------------------------------------------------------------------ lineage

function Lineage({ d, parent, children, nameOf }: { d: Delegation; parent: Delegation | null; children: Delegation[]; nameOf: (id: string | null) => string | null }) {
  const node = (x: Delegation, current = false) => {
    const body = (
      <>
        <span className="eyebrow block">{current ? 'This contract' : 'Delegation'}</span>
        <span className="id mt-0.5 block text-[11.5px] text-ink">{x.delegation_id}</span>
        <span className="mt-1 block text-[12px] text-ink-2 [overflow-wrap:anywhere]">
          {nameOf(x.delegator_principal_id) ?? 'unrecorded'} <span className="text-ink-4">→</span> {nameOf(x.delegatee_principal_id) ?? 'unrecorded'}
        </span>
      </>
    )
    return current ? (
      <div className="rounded border border-copper/45 bg-copper/[0.06] px-3 py-2.5" aria-current="page">
        {body}
      </div>
    ) : (
      <Link to={`/app/delegations/${encodeURIComponent(x.delegation_id)}`} className="block rounded border hairline-strong px-3 py-2.5 transition-colors hover:border-copper/45 hover:bg-s2">
        {body}
      </Link>
    )
  }
  const arrow = (
    <span className="flex items-center justify-center text-ink-4" aria-hidden>
      <ArrowDown size={14} className="md:hidden" />
      <ArrowRight size={14} className="hidden md:block" />
    </span>
  )
  return (
    <ol className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)]" aria-label="Delegation lineage">
      <li className="min-w-0">
        {parent ? (
          node(parent)
        ) : d.parent_delegation_id ? (
          <div className="rounded border border-dashed border-amber/45 px-3 py-2.5">
            <span className="eyebrow block text-amber-ink">Parent not in evidence</span>
            <span className="id mt-0.5 block text-[11.5px]">{d.parent_delegation_id}</span>
          </div>
        ) : (
          <div className="rounded border border-dashed hairline-strong px-3 py-2.5">
            <span className="eyebrow block">Root delegation</span>
            <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
              Issued directly by <PrincipalLink id={d.root_principal_id ?? d.delegator_principal_id} name={nameOf(d.root_principal_id ?? d.delegator_principal_id)} />
            </span>
          </div>
        )}
      </li>
      <li aria-hidden>{arrow}</li>
      <li className="min-w-0">{node(d, true)}</li>
      <li aria-hidden>{arrow}</li>
      <li className="min-w-0">
        {children.length === 0 ? (
          <div className="rounded border border-dashed hairline-strong px-3 py-2.5">
            <span className="eyebrow block">No sub-delegations</span>
            <span className="mt-1 block text-[12px] text-ink-3">The delegatee has not passed this authority on.</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {children.map((c) => (
              <li key={c.delegation_id}>{node(c)}</li>
            ))}
          </ul>
        )}
      </li>
    </ol>
  )
}
