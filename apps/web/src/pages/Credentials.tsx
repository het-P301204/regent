import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, Lock, RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { stamp, day } from '../lib/format'
import type { Health, PrincipalType } from '../lib/types'
import { IconCredential, IconExecution, IconReplay } from '../brand/icons'
import { Button, cx, LinkButton, PageHeader, Panel, Select } from '../ui/primitives'
import { HealthBadge, LifecycleBadge } from '../ui/status'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { CountStrip, FindingIdLinks, PrincipalGlyph, usePrincipalIndex, useStagger } from '../components/registry/common'
import type { CredentialCondition, CredentialLineage, CredentialsResponse } from '../components/registry/types'

/** Plain-language meaning of each condition the API reports. Tone carries state: crimson = violated, amber = incomplete. */
const CONDITION: Record<CredentialCondition, { label: string; tone: 'crimson' | 'amber'; explain: string }> = {
  USED_OUTSIDE_BINDING: {
    label: 'Reused outside its binding',
    tone: 'crimson',
    explain: 'A principal other than the one this credential is bound to acted with it. The credential binding does not match the acting principal.',
  },
  REVOKED_CREDENTIAL_USED: {
    label: 'Revoked credential used',
    tone: 'crimson',
    explain: 'An action executed with this credential at or after its revocation time.',
  },
  STALE_CREDENTIAL_USED: {
    label: 'Stale credential used',
    tone: 'crimson',
    explain: 'An action executed with this credential at or after its expiry time.',
  },
  BINDING_TO_UNKNOWN_IDENTITY: {
    label: 'Bound to unknown identity',
    tone: 'amber',
    explain: 'The credential names an execution identity that is not registered, so its binding cannot be verified. Unknown, not violated.',
  },
  NO_BINDING: {
    label: 'No credential binding',
    tone: 'amber',
    explain: 'The credential records no execution identity, so REGENT cannot tell whom it authenticates.',
  },
  NO_PARENT_LINEAGE: {
    label: 'Without parent lineage',
    tone: 'amber',
    explain: 'The execution identity is not issued to any principal, so the credential cannot be traced to a delegation chain.',
  },
}
const CONDITIONS = Object.keys(CONDITION) as CredentialCondition[]
const HEALTHS: Health[] = ['violated', 'incomplete', 'unknown', 'verified']

export default function Credentials() {
  const q = useQuery({ queryKey: wsKey('credentials'), queryFn: () => api.get<CredentialsResponse>('/api/credentials') })
  const index = usePrincipalIndex()
  const stagger = useStagger(36, 8)
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus')
  const [cond, setCond] = useState<'all' | 'any' | 'none' | CredentialCondition>('all')

  const all = useMemo(() => q.data?.lineage ?? [], [q.data])
  const rows = all.filter((l) => (cond === 'all' ? true : cond === 'any' ? l.conditions.length > 0 : cond === 'none' ? l.conditions.length === 0 : l.conditions.includes(cond)))
  const isFocused = (l: CredentialLineage) => !!focus && (l.credential.credential_id === focus || l.credential.execution_identity_id === focus)
  const focusedVisible = rows.some(isFocused)

  // Scroll to and focus the requested credential once its card is rendered.
  const focusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!focus || !q.data) return
    const el = focusRef.current
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }, [focus, q.data, focusedVisible])

  const counts = useMemo(() => {
    const m = new Map<CredentialCondition, number>()
    for (const l of all) for (const c of l.conditions) m.set(c, (m.get(c) ?? 0) + 1)
    return m
  }, [all])

  const clearFocus = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('focus')
        return n
      },
      { replace: true },
    )

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Registry"
        title="Credential lineage"
        description="Each credential traced back through the execution identity it authenticates to the principals whose delegated authority it carries, then forward to the actions it executed."
        actions={<LinkButton to="/app/identities?tab=credentials" size="sm">Credential registry</LinkButton>}
      />
      <div className="mb-5 flex items-start gap-2.5 rounded border hairline bg-s1 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
        <Lock size={14} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
        <p>
          <span className="font-medium text-ink">REGENT stores credential metadata only:</span> type, credential binding, and the issued, expiry and revocation times. It never receives or stores token values, keys or other secret material.
        </p>
      </div>

      {q.isLoading ? (
        <LoadingState label="Tracing credential lineage" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : !q.data ? null : all.length === 0 && q.data.unknown_credentials.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<IconCredential size={28} />}
            title="No credentials in this dataset"
            body="No credential metadata is registered and no action names a credential, so credential binding cannot be checked. Import events that record credential_id and execution_identity_id."
            action={<LinkButton to="/app/import" variant="primary" size="sm">Import events</LinkButton>}
          />
        </Panel>
      ) : (
        <>
          <CountStrip
            label="Credential conditions"
            items={[
              { key: 'total', icon: <IconCredential size={15} />, count: all.length, label: all.length === 1 ? 'registered credential' : 'registered credentials' },
              ...CONDITIONS.filter((c) => counts.get(c)).map((c) => ({
                key: c,
                icon: <ConditionGlyph tone={CONDITION[c].tone} />,
                count: counts.get(c) ?? 0,
                label: CONDITION[c].label.toLowerCase(),
                tone: CONDITION[c].tone === 'crimson' ? 'text-crimson-ink' : 'text-amber-ink',
              })),
              ...(q.data.unknown_credentials.length ? [{ key: 'unknown', icon: <PrincipalGlyph type={null} size={15} />, count: q.data.unknown_credentials.length, label: 'unregistered, used by actions', tone: 'text-fog-ink' }] : []),
            ]}
          />

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select label="Condition" value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} className="w-full sm:w-64">
              <option value="all">All credentials</option>
              <option value="any">With any condition</option>
              <option value="none">With no condition</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION[c].label}
                </option>
              ))}
            </Select>
            {focus ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={clearFocus}>
                Clear highlight on <span className="id max-w-[180px] truncate">{focus}</span>
              </Button>
            ) : null}
            <span className="ml-auto self-center font-mono text-[11px] text-ink-3" aria-live="polite">
              {rows.length} of {all.length}
            </span>
          </div>
          {focus && !all.some(isFocused) ? (
            <p role="status" className="mb-4 rounded border border-amber/40 bg-amber/[0.06] px-3 py-2 text-[12px] text-amber-ink">
              No registered credential or execution identity matches <span className="id">{focus}</span>. It may be unregistered; see below.
            </p>
          ) : null}

          {rows.length === 0 ? (
            <Panel>
              <EmptyState title="No credential matches this condition" body="Show every credential to see the full lineage." action={<Button size="sm" icon={<RotateCcw size={13} />} onClick={() => setCond('all')}>Show all credentials</Button>} />
            </Panel>
          ) : (
            <ul className="space-y-4" aria-label="Credential lineage">
              {rows.map((l, i) => (
                <li key={l.credential.credential_id}>
                  <LineageCard l={l} focused={isFocused(l)} refCb={isFocused(l) ? (el) => { focusRef.current = el } : undefined} typeOf={(id) => index.get(id)?.type} style={stagger(i)} />
                </li>
              ))}
            </ul>
          )}

          <section aria-labelledby="unknown-creds" className="mt-8">
            <Panel title="Unknown credentials" eyebrow="Used by actions, never registered" id="unknown-creds" bodyClassName="p-0">
              <p className="border-b hairline px-4 py-3 text-[12px] leading-relaxed text-ink-2">
                These credential IDs appear on action records but have no credential metadata. Their binding and validity window are unknown, so REGENT cannot treat them as bound to any execution identity. Unknown is reported as unknown, not as a violation.
              </p>
              {q.data.unknown_credentials.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-ink-3">Every credential used by an action is registered.</p>
              ) : (
                <ul className="flex flex-wrap gap-2 px-4 py-4">
                  {q.data.unknown_credentials.map((c) => (
                    <li key={c} className={cx('inline-flex items-center gap-1.5 rounded-[3px] border border-dashed px-2 py-1', focus === c ? 'border-copper/60 bg-copper/[0.08]' : 'border-fog/45')}>
                      <PrincipalGlyph type={null} size={13} />
                      <span className="id text-[11.5px]">{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </>
      )}
    </div>
  )
}

function ConditionGlyph({ tone }: { tone: 'crimson' | 'amber' }) {
  return <span className={cx('inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]', tone === 'crimson' ? 'border-crimson/55 text-crimson-ink' : 'border-amber/50 text-amber-ink')}>{tone === 'crimson' ? '✕' : '!'}</span>
}

// ------------------------------------------------------------------ lineage card

function LineageCard({ l, focused, refCb, typeOf, style }: { l: CredentialLineage; focused: boolean; refCb?: (el: HTMLElement | null) => void; typeOf: (id: string) => PrincipalType | undefined; style?: CSSProperties }) {
  const c = l.credential
  const ex = l.execution_identity
  const violated = l.conditions.some((x) => CONDITION[x].tone === 'crimson')
  const healthCounts = HEALTHS.map((h) => [h, l.uses.filter((u) => u.health === h).length] as const).filter(([, n]) => n > 0)
  const headingId = `cred-${c.credential_id}`

  // Principal part of the path: the resolved delegators, then the bound principal.
  const principals: { id: string | null; name: string }[] = [...l.lineage]
  if (l.bound_principal && !principals.some((p) => p.id === l.bound_principal!.id)) principals.push(l.bound_principal)

  return (
    <article
      ref={refCb}
      tabIndex={focused ? -1 : undefined}
      aria-labelledby={headingId}
      style={style}
      className={cx('panel min-w-0 overflow-hidden outline-none anim-fade-up', focused && 'shadow-glow', violated && !focused && 'border-crimson/35')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b hairline px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <IconCredential size={16} className="mt-0.5 shrink-0 text-ink-2" />
          <div className="min-w-0">
            <h2 id={headingId} className="id text-[12.5px] font-medium text-ink">
              {c.credential_id}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {c.credential_type.replace(/_/g, ' ')} · issued {day(c.issued_at)} · expires {day(c.expires_at)}
              {c.revoked_at ? ` · revoked ${stamp(c.revoked_at)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focused ? <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper-ink">Highlighted</span> : null}
          <span className="text-[11px] text-ink-3">recorded</span>
          <LifecycleBadge state={c.recorded_status} />
        </div>
      </header>

      {/* The path: principals -> execution identity -> credential -> executions */}
      <div className="overflow-x-auto px-4 py-4">
        <ol className="flex min-w-0 flex-col gap-0 md:flex-row md:items-stretch" aria-label={`Lineage of credential ${c.credential_id}`}>
          {principals.length === 0 ? (
            <Step kind="Principal" icon={<PrincipalGlyph type={null} size={18} />} title="No principal resolved" sub={ex?.bound_principal_id ? 'bound principal never acted' : 'no binding'} muted />
          ) : (
            principals.map((p, i) => (
              <Step
                key={`${p.id ?? 'x'}-${i}`}
                kind={p.id === l.bound_principal?.id ? 'Bound principal' : i === 0 ? 'Root principal' : 'Delegator'}
                icon={<PrincipalGlyph type={p.id ? typeOf(p.id) : null} size={18} />}
                title={p.name}
                sub={p.id ?? 'not recorded'}
                to={p.id ? `/app/identities/${encodeURIComponent(p.id)}` : undefined}
                muted={!p.id}
              />
            ))
          )}
          <Step
            kind="Execution identity"
            icon={<IconExecution size={18} />}
            title={ex ? ex.execution_identity_id : (c.execution_identity_id ?? 'No binding')}
            sub={ex ? (ex.spiffe_id ?? ex.kind) : c.execution_identity_id ? 'not registered' : 'credential binds to nothing'}
            mono
            muted={!ex}
          />
          <Step kind="Credential" icon={<IconCredential size={18} />} title={c.credential_id} sub={c.credential_type.replace(/_/g, ' ')} mono current />
          <Step
            kind="Executions"
            icon={<IconReplay size={18} />}
            title={`${l.uses.length} ${l.uses.length === 1 ? 'use' : 'uses'}`}
            sub={healthCounts.length ? healthCounts.map(([h, n]) => `${n} ${h}`).join(' · ') : 'never used'}
            last
          />
        </ol>
      </div>

      {l.conditions.length > 0 ? (
        <div className="border-t hairline px-4 py-3">
          <h3 className="eyebrow mb-2">Conditions</h3>
          <ul className="space-y-2">
            {l.conditions.map((x) => {
              const m = CONDITION[x]
              return (
                <li key={x} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                  <span className={cx('inline-flex h-[20px] w-fit shrink-0 items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]', m.tone === 'crimson' ? 'border-crimson/50 bg-crimson/12 text-crimson-ink' : 'border-amber/45 bg-amber/10 text-amber-ink')}>
                    <span aria-hidden>{m.tone === 'crimson' ? '✕' : '!'}</span>
                    {m.label}
                  </span>
                  <span className="text-[12px] leading-relaxed text-ink-2">{m.explain}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="border-t hairline px-4 py-2.5 text-[12px] text-ink-3">
          <span className="text-sage-ink" aria-hidden>
            ✓{' '}
          </span>
          No lineage condition reported for this credential.
        </p>
      )}

      {l.used_by_actors.length > 0 || l.uses.length > 0 || l.finding_ids.length > 0 ? (
        <div className="grid gap-4 border-t hairline px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="min-w-0">
            <h3 className="eyebrow mb-2">Acting principals</h3>
            {l.used_by_actors.length === 0 ? (
              <p className="text-[12px] text-ink-3">No action names an acting principal.</p>
            ) : (
              <ul className="space-y-1.5">
                {l.used_by_actors.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <Link to={`/app/identities/${encodeURIComponent(a.id)}`} className="inline-flex min-w-0 items-center gap-1.5 text-ink hover:text-copper-ink">
                      <PrincipalGlyph type={typeOf(a.id)} size={13} className="text-ink-2" />
                      <span className="[overflow-wrap:anywhere]">{a.name}</span>
                    </Link>
                    {a.matches_binding ? (
                      <span className="font-mono text-[10.5px] text-sage-ink">✓ matches binding</span>
                    ) : (
                      <span className="font-mono text-[10.5px] text-crimson-ink">✕ outside binding</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {l.finding_ids.length ? (
              <div className="mt-3">
                <h3 className="eyebrow mb-1.5">Findings</h3>
                <FindingIdLinks ids={l.finding_ids} />
              </div>
            ) : null}
          </div>
          <details className="group min-w-0">
            <summary className="eyebrow cursor-pointer list-none select-none hover:text-ink-2">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>
              Executions · {l.uses.length}
            </summary>
            {l.uses.length === 0 ? (
              <p className="mt-2 text-[12px] text-ink-3">No action used this credential.</p>
            ) : (
              <ul className="mt-2 max-h-56 divide-y divide-[rgb(var(--line)/0.08)] overflow-y-auto rounded border hairline">
                {l.uses.map((u) => (
                  <li key={u.event_id}>
                    <Link to={`/app/chains/${encodeURIComponent(u.event_id)}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-s2">
                      <span className="min-w-0">
                        <span className="id block text-[11.5px] text-ink">{u.event_id}</span>
                        <span className="font-mono text-[10.5px] text-ink-3">{stamp(u.timestamp)}</span>
                      </span>
                      <HealthBadge health={u.health} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      ) : null}
    </article>
  )
}

function Step({ kind, icon, title, sub, to, mono, muted, current, last }: { kind: string; icon: ReactNode; title: string; sub: string; to?: string; mono?: boolean; muted?: boolean; current?: boolean; last?: boolean }) {
  const body = (
    <span
      className={cx(
        'flex min-w-0 items-start gap-2.5 rounded border px-3 py-2.5 transition-colors md:w-[176px]',
        current ? 'border-copper/45 bg-copper/[0.06]' : muted ? 'border-dashed border-fog/45' : 'hairline-strong bg-s2',
        to && 'hover:border-copper/45',
      )}
    >
      <span className={cx('mt-0.5 shrink-0', muted ? 'text-fog-ink' : current ? 'text-copper-ink' : 'text-ink-2')}>{icon}</span>
      <span className="min-w-0">
        <span className="eyebrow block text-[9.5px]">{kind}</span>
        <span className={cx('block leading-snug [overflow-wrap:anywhere]', mono ? 'font-mono text-[11.5px]' : 'text-[12.5px]', muted ? 'italic text-fog-ink' : 'text-ink')}>{title}</span>
        <span className="block truncate font-mono text-[10.5px] text-ink-3" title={sub}>
          {sub}
        </span>
      </span>
    </span>
  )
  return (
    <li className="flex min-w-0 flex-col md:flex-row md:items-center">
      {to ? (
        <Link to={to} className="block min-w-0 rounded">
          {body}
        </Link>
      ) : (
        body
      )}
      {!last ? (
        <span className="flex items-center justify-start py-1 pl-[22px] text-ink-4 md:px-1.5 md:py-0" aria-hidden>
          <span className="hidden h-px w-4 bg-[rgb(var(--line-strong)/0.25)] md:block" />
          <ArrowRight size={12} className="hidden md:block" />
          <ArrowDown size={12} className="md:hidden" />
        </span>
      ) : null}
    </li>
  )
}
