import { useCallback, useEffect, useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Lock, RotateCcw, Save } from 'lucide-react'
import { api } from '../lib/api'
import { useRunVerification, wsKey } from '../lib/queries'
import { useSession } from '../lib/session'
import type { PrincipalType, RuleConfig, RuleSet, Severity } from '../lib/types'
import { IconPolicy, IconVerification } from '../brand/icons'
import { Badge, Button, cx, LinkButton, PageHeader, Panel, Select, Tabs } from '../ui/primitives'
import { SeverityBadge } from '../ui/status'
import { ScopeChips } from '../ui/scope'
import { EmptyState, ErrorState, LoadingState, useToast } from '../ui/feedback'
import { Modal } from '../ui/overlay'
import { TYPE_LABEL, useStagger } from '../components/registry/common'
import type { PoliciesResponse } from '../components/registry/types'

type Tab = 'rules' | 'policies'
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const PTYPES: PrincipalType[] = ['human', 'agent', 'sub_agent', 'workload', 'service']
type RulePatch = Partial<Pick<RuleConfig, 'enabled' | 'severity' | 'applies_to' | 'remediation'>>

export default function PolicyEngine() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'policies' ? 'policies' : 'rules'
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'rules') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Registry"
        title="Policy engine"
        description="REGENT's verification rules, which you configure here, beside the authorization policies the system under audit recorded, which REGENT only reads."
      />

      <div className="mb-6 grid gap-px overflow-hidden rounded-md border hairline bg-[rgb(var(--line)/0.08)] md:grid-cols-2">
        <div className="bg-s1 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <IconVerification size={15} className="text-ink-2" /> Verification rules
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">REGENT&apos;s own invariants, AUTH-001 to AUTH-010. They decide which findings a verification run reports. Owned and versioned here.</p>
        </div>
        <div className="bg-s1 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <IconPolicy size={15} className="text-ink-2" /> Authorization policies
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Recorded by the system under audit with each decision and delegation. REGENT reads their ceilings and approval requirements and never edits them.</p>
        </div>
      </div>

      <Tabs<Tab>
        label="Policy engine sections"
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { id: 'rules', label: 'Verification rules' },
          { id: 'policies', label: 'Authorization policies' },
        ]}
      />
      <div role="tabpanel" aria-label={tab === 'rules' ? 'Verification rules' : 'Authorization policies'} className="min-w-0">
        {tab === 'rules' ? <RulesTab /> : <PoliciesTab />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ rules

function RulesTab() {
  const q = useQuery({ queryKey: wsKey('rules'), queryFn: () => api.get<RuleSet>('/api/rules') })
  const { can } = useSession()
  const admin = can('admin')
  const qc = useQueryClient()
  const toast = useToast()
  const stagger = useStagger(30)
  const run = useRunVerification()
  const [changed, setChanged] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const closeReset = useCallback(() => setConfirmReset(false), [])

  const applied = async (rs: RuleSet, title: string) => {
    qc.setQueryData(wsKey('rules'), rs)
    await qc.invalidateQueries({ queryKey: ['ws'] })
    setChanged(true)
    toast({ title, body: 'Run verification to apply it to the active dataset. A disabled rule reports SKIPPED, never PASS.', tone: 'success' })
  }

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RulePatch }) => api.put<RuleSet>(`/api/rules/${encodeURIComponent(id)}`, patch),
    onSuccess: (rs, v) => applied(rs, `${v.id} updated`),
    onError: (e) => toast({ title: 'Rule not updated', body: e instanceof Error ? e.message : 'The change was rejected.', tone: 'error' }),
  })
  const reset = useMutation({
    mutationFn: () => api.post<RuleSet>('/api/rules/reset'),
    onSuccess: async (rs) => {
      setConfirmReset(false)
      await applied(rs, 'Default rules restored')
    },
    onError: (e) => toast({ title: 'Defaults not restored', body: e instanceof Error ? e.message : 'The request failed.', tone: 'error' }),
  })

  if (q.isLoading) return <LoadingState label="Loading verification rules" />
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />
  const rs = q.data
  if (!rs) return null

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span>
            Rule set <span className="id text-ink-2">{rs.ruleset_id}</span>
          </span>
          <span>
            Version <span className="id text-ink-2">{rs.version}</span>
          </span>
          <span>
            {rs.rules.filter((r) => r.enabled).length} of {rs.rules.length} enabled
          </span>
        </div>
        {admin ? (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setConfirmReset(true)}>
            Restore defaults
          </Button>
        ) : null}
      </div>

      {!admin ? (
        <p className="mb-4 flex items-start gap-2 rounded border hairline bg-s1 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
          <Lock size={13} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
          Read only. Only administrators can change verification rules; every rule and its configuration is shown here.
        </p>
      ) : null}

      {changed ? (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded border border-copper/40 bg-copper/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] leading-relaxed text-ink">
            Rules changed since the last verification run. Findings on screen still reflect the previous rule set until you run verification.
          </p>
          {can('analyst') ? (
            <Button
              size="sm"
              variant="primary"
              loading={run.isPending}
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: (r) => {
                    setChanged(false)
                    toast({ title: 'Verification complete', body: `${r.summary.total_actions} actions verified under rule set ${r.ruleset_version}.`, tone: 'success' })
                  },
                  onError: (e) => toast({ title: 'Verification did not run', body: e instanceof Error ? e.message : 'The request failed.', tone: 'error' }),
                })
              }
            >
              Run verification
            </Button>
          ) : (
            <span className="text-[12px] text-ink-3">An analyst or administrator can run verification.</span>
          )}
        </div>
      ) : null}

      {rs.rules.length === 0 ? (
        <Panel>
          <EmptyState title="No verification rules returned" body="The API returned an empty rule set. Restore the defaults to bring back AUTH-001 to AUTH-010." action={admin ? <Button size="sm" onClick={() => setConfirmReset(true)}>Restore defaults</Button> : null} />
        </Panel>
      ) : (
        <ul className="space-y-3" aria-label="Verification rules">
          {rs.rules.map((r, i) => (
            <li key={r.rule_id}>
              <RuleCard rule={r} editable={admin} pending={update.isPending && update.variables?.id === r.rule_id} onPatch={(patch) => update.mutate({ id: r.rule_id, patch })} style={stagger(i)} />
            </li>
          ))}
        </ul>
      )}

      <Modal open={confirmReset} onClose={closeReset} title="Restore default rules?">
        <div className="px-5 py-4 text-[12.5px] leading-relaxed text-ink-2">
          Every rule returns to its default: enabled, with its default severity, scope of principal types and remediation. The rule set version changes. Findings change only when verification runs again.
        </div>
        <div className="flex justify-end gap-2 border-t hairline px-5 py-3">
          <Button size="sm" variant="ghost" onClick={closeReset}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>
            Restore defaults
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function RuleCard({ rule, editable, pending, onPatch, style }: { rule: RuleConfig; editable: boolean; pending: boolean; onPatch: (p: RulePatch) => void; style?: CSSProperties }) {
  const [draft, setDraft] = useState(rule.remediation)
  useEffect(() => setDraft(rule.remediation), [rule.remediation])
  const dirty = draft.trim() !== rule.remediation.trim()
  const valid = draft.trim().length > 0 && draft.length <= 1000
  const remId = useId()
  const titleId = `rule-${rule.rule_id}`
  const disabled = !editable || pending

  const toggleType = (t: PrincipalType) => {
    const next = rule.applies_to.includes(t) ? rule.applies_to.filter((x) => x !== t) : [...rule.applies_to, t]
    onPatch({ applies_to: PTYPES.filter((x) => next.includes(x)) })
  }

  return (
    <article aria-labelledby={titleId} aria-busy={pending || undefined} style={style} className={cx('panel min-w-0 anim-fade-up transition-opacity', !rule.enabled && 'bg-transparent')}>
      <header className="flex items-start gap-3 border-b hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-medium text-copper-ink">{rule.rule_id}</span>
            <SeverityBadge severity={rule.severity} />
            {!rule.enabled ? <Badge tone="neutral">Disabled · reports skipped</Badge> : null}
            {pending ? <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-3 border-t-transparent" aria-label="Saving" /> : null}
          </div>
          <h3 id={titleId} className={cx('mt-1.5 text-[13.5px] font-medium', rule.enabled ? 'text-ink' : 'text-ink-3')}>
            {rule.title}
          </h3>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">{rule.description}</p>
        </div>
        <Switch checked={rule.enabled} disabled={disabled} label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.rule_id}`} onChange={(v) => onPatch({ enabled: v })} />
      </header>

      <div className="grid gap-4 px-4 py-3.5 md:grid-cols-[180px_minmax(0,1fr)]">
        <Select label="Severity" value={rule.severity} disabled={disabled} onChange={(e) => onPatch({ severity: e.target.value as Severity })}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <fieldset className="min-w-0">
          <legend className="eyebrow mb-1.5">Applies to</legend>
          <div className="flex flex-wrap gap-1.5">
            {PTYPES.map((t) => {
              const on = rule.applies_to.includes(t)
              return (
                <label key={t} className={cx('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-[12px] transition-colors', on ? 'border-copper/45 bg-copper/[0.08] text-ink' : 'border-[rgb(var(--line-strong)/0.16)] text-ink-2 hover:border-[rgb(var(--line-strong)/0.28)]', disabled && 'cursor-not-allowed opacity-60')}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--copper))]" checked={on} disabled={disabled} onChange={() => toggleType(t)} />
                  {TYPE_LABEL[t]}
                </label>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">{rule.applies_to.length === 0 ? 'None selected: applies to every principal type.' : `Applies only to ${rule.applies_to.map((t) => TYPE_LABEL[t].toLowerCase()).join(', ')} principals.`}</p>
        </fieldset>
      </div>

      <div className="border-t hairline px-4 py-3.5">
        <label htmlFor={remId} className="eyebrow mb-1.5 block">
          Remediation
        </label>
        <textarea
          id={remId}
          value={draft}
          disabled={disabled}
          maxLength={1000}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          className="block min-h-[64px] w-full resize-y rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper disabled:opacity-70"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className={cx('font-mono text-[10.5px]', draft.length > 950 ? 'text-amber-ink' : 'text-ink-3')}>{draft.length} / 1000</span>
          {editable && dirty ? (
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(rule.remediation)} disabled={pending}>
                Revert
              </Button>
              <Button size="sm" variant="primary" icon={<Save size={13} />} disabled={!valid} loading={pending} onClick={() => onPatch({ remediation: draft.trim() })}>
                Save remediation
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex shrink-0 items-center gap-2 rounded px-1 py-1 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className={cx('font-mono text-[10.5px] uppercase tracking-[0.1em]', checked ? 'text-ink' : 'text-ink-3')} aria-hidden>
        {checked ? 'On' : 'Off'}
      </span>
      <span className={cx('relative inline-flex h-[18px] w-[32px] items-center rounded-full border transition-colors duration-150', checked ? 'border-copper bg-copper/80' : 'border-[rgb(var(--line-strong)/0.3)] bg-s3')} aria-hidden>
        <span className={cx('absolute h-3 w-3 rounded-full transition-transform duration-150 ease-out', checked ? 'translate-x-[16px] bg-[rgb(var(--canvas))]' : 'translate-x-[2px] bg-ink-3')} />
      </span>
    </button>
  )
}

// ------------------------------------------------------------------ policies

function PoliciesTab() {
  const q = useQuery({ queryKey: wsKey('policies'), queryFn: () => api.get<PoliciesResponse>('/api/policies') })
  const stagger = useStagger(36)
  if (q.isLoading) return <LoadingState label="Loading authorization policies" />
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />
  const d = q.data
  if (!d) return null
  const schema = d.completeness_schema
  const critical = schema.fields.filter((f) => f.critical).length

  return (
    <div className="min-w-0 space-y-8">
      <section aria-labelledby="pol-h">
        <h2 id="pol-h" className="mb-3 text-[14px] font-medium text-ink">
          Recorded policies <span className="tnum ml-1 font-mono text-[11px] text-ink-3">{d.policies.length}</span>
        </h2>
        {d.policies.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<IconPolicy size={26} />}
              title="No authorization policy recorded"
              body="The system under audit recorded no policy with its decisions or delegations, so no policy ceiling narrows any effective scope and no approval requirement can be checked."
              action={<LinkButton to="/app/import" size="sm">Import events with policies</LinkButton>}
            />
          </Panel>
        ) : (
          <ul className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.policies.map((p, i) => (
              <li key={`${p.policy_id}@${p.policy_version}`} className="flex min-w-0">
                <article className="panel flex w-full min-w-0 flex-col anim-fade-up" style={stagger(i)} aria-labelledby={`pol-${p.policy_id}-${p.policy_version}`}>
                  <header className="flex items-start justify-between gap-3 border-b hairline px-4 py-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <IconPolicy size={16} className="mt-0.5 shrink-0 text-ink-2" />
                      <div className="min-w-0">
                        <h3 id={`pol-${p.policy_id}-${p.policy_version}`} className="text-[13px] font-medium text-ink [overflow-wrap:anywhere]">
                          {p.display_name}
                        </h3>
                        <div className="id text-[11px] text-ink-3">{p.policy_id}</div>
                      </div>
                    </div>
                    <Badge tone="neutral">v{p.policy_version}</Badge>
                  </header>
                  <dl className="flex-1 space-y-3 px-4 py-3 text-[12px]">
                    <div>
                      <dt className="eyebrow mb-1">Scope ceiling</dt>
                      <dd>{p.scope_ceiling ? <ScopeChips scope={p.scope_ceiling} /> : <span className="text-ink-3">No ceiling recorded. Effective scope is not narrowed by this policy.</span>}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow mb-1">Approval required for</dt>
                      <dd>
                        <ScopeChips scope={p.approval_required_for} empty="no permission requires approval" />
                      </dd>
                    </div>
                  </dl>
                  <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t hairline px-4 py-2.5 font-mono text-[11px] text-ink-3">
                    <span>
                      <span className="tnum text-ink-2">{p.decisions}</span> {p.decisions === 1 ? 'decision' : 'decisions'}
                    </span>
                    <span>
                      <span className="tnum text-ink-2">{p.delegations}</span> {p.delegations === 1 ? 'delegation' : 'delegations'}
                    </span>
                  </footer>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="unv-h">
        {d.unversioned_decisions.length === 0 ? (
          <p className="flex items-center gap-2 rounded border hairline px-4 py-3 text-[12.5px] text-ink-2">
            <span className="text-sage-ink" aria-hidden>
              ✓
            </span>
            <span id="unv-h">Every recorded decision names the policy version that made it.</span>
          </p>
        ) : (
          <div className="rounded-md border border-amber/40 bg-amber/[0.05]">
            <div className="flex items-start gap-2.5 border-b border-amber/25 px-4 py-3">
              <AlertTriangle size={15} className="mt-[2px] shrink-0 text-amber-ink" aria-hidden />
              <div className="min-w-0">
                <h2 id="unv-h" className="text-[13px] font-medium text-amber-ink">
                  {d.unversioned_decisions.length} {d.unversioned_decisions.length === 1 ? 'decision has' : 'decisions have'} no policy version
                </h2>
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-2">
                  These authorization decisions were recorded without the policy version that made them, so REGENT cannot tell which revision applied. AUTH-007 reports them as missing decision evidence; the evidence is incomplete, not proof of a violation.
                </p>
              </div>
            </div>
            <ul className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto px-4 py-3">
              {d.unversioned_decisions.map((e) => (
                <li key={e}>
                  <Link to={`/app/chains/${encodeURIComponent(e)}`} className="id inline-block rounded border border-amber/30 px-1.5 py-[1px] text-[11px] transition-colors hover:border-copper/50 hover:text-copper-ink">
                    {e}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="schema-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="schema-h" className="text-[14px] font-medium text-ink">
              Record schema
            </h2>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-2">
              The fields an audit-grade action record must carry. Record completeness is present fields over required fields. A missing critical field leaves the checks that depend on it UNKNOWN; it is never reported as a violation.
            </p>
          </div>
          <span className="font-mono text-[11px] text-ink-3">
            <span className="id text-ink-2">{schema.schema_id}</span> · {schema.fields.length} fields · {critical} critical
          </span>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <caption className="sr-only">Audit record completeness schema: each field, whether it is critical, and why it is required.</caption>
            <thead>
              <tr className="border-b hairline-strong">
                <th scope="col" className="eyebrow px-4 py-2 font-normal">
                  Field
                </th>
                <th scope="col" className="eyebrow w-[110px] px-4 py-2 font-normal">
                  Weight
                </th>
                <th scope="col" className="eyebrow px-4 py-2 font-normal">
                  Why it is required
                </th>
              </tr>
            </thead>
            <tbody>
              {schema.fields.map((f) => (
                <tr key={f.name} className="border-b hairline last:border-b-0">
                  <th scope="row" className="px-4 py-2 align-top font-normal">
                    <span className="font-mono text-[12px] text-ink">{f.name}</span>
                  </th>
                  <td className="px-4 py-2 align-top">
                    {f.critical ? (
                      <span className="inline-flex h-[20px] items-center gap-1 rounded-[3px] border border-[rgb(var(--line-strong)/0.3)] px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink">
                        <span aria-hidden>◆</span> Critical
                      </span>
                    ) : (
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">Standard</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top text-[12.5px] leading-relaxed text-ink-2">{f.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
