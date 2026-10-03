import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, KeyRound, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { afterDatasetChange, useActivateDataset, useDatasets, useResetDemo } from '../lib/queries'
import { useSession } from '../lib/session'
import { useTheme } from '../lib/prefs'
import { plural, stamp } from '../lib/format'
import type { DatasetRow, Role } from '../lib/types'
import { Badge, Button, LinkButton, PageHeader, TextInput, cx } from '../ui/primitives'
import { SourceTag } from '../ui/status'
import { CopyButton } from '../ui/data'
import { EmptyState, ErrorState, LoadingState, useToast } from '../ui/feedback'
import { Modal } from '../ui/overlay'

const SECTIONS: { id: string; label: string; min?: Role }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'datasets', label: 'Datasets' },
  { id: 'tokens', label: 'API tokens', min: 'analyst' },
  { id: 'audit', label: 'Audit log', min: 'admin' },
  { id: 'account', label: 'Account' },
]

export default function Settings() {
  const { can } = useSession()
  const visible = SECTIONS.filter((s) => !s.min || can(s.min))
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Settings" description="Preferences for this browser, the datasets in your organization, API access, and REGENT's own audit log." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {visible.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="inline-flex h-7 items-center rounded px-2.5 text-[12.5px] text-ink-2 transition-colors hover:bg-s2 hover:text-ink lg:flex lg:w-full">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          <Appearance />
          <Datasets />
          {can('analyst') ? <Tokens /> : null}
          {can('admin') ? <AuditLog /> : null}
          <Account />
        </div>
      </div>
    </div>
  )
}

function SectionPanel({ id, title, description, children, actions }: { id: string; title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="panel scroll-mt-20">
      <header className="flex flex-col gap-2 border-b hairline px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[14px] font-medium text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------- appearance

function readMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset['motion'] === 'reduced'
}

function applyMotion(reduced: boolean) {
  if (reduced) document.documentElement.dataset['motion'] = 'reduced'
  else delete document.documentElement.dataset['motion']
  try {
    if (reduced) localStorage.setItem('regent.motion', 'reduced')
    else localStorage.removeItem('regent.motion')
  } catch {
    /* storage blocked: the preference lasts for this page load only */
  }
}

function Appearance() {
  const [theme, setTheme] = useTheme()
  const [reduced, setReduced] = useState(readMotion)
  const systemReduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const options: { id: 'dark' | 'light'; label: string; note: string; swatch: string[] }[] = [
    { id: 'dark', label: 'Obsidian', note: 'Dark. The default.', swatch: ['#0D0D0C', '#1C1B19', '#C47A44', '#E9E4D8'] },
    { id: 'light', label: 'Warm paper', note: 'Light, for print-like reading.', swatch: ['#EFEADF', '#FBF9F4', '#A9573F', '#1C1B19'] },
  ]
  return (
    <SectionPanel id="appearance" title="Appearance" description="Stored in this browser only.">
      <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-2">
        <fieldset>
          <legend className="eyebrow mb-2">Theme</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            {options.map((o) => {
              const checked = theme === o.id
              return (
                <label key={o.id} className={cx('flex flex-1 cursor-pointer items-start gap-3 rounded border px-3 py-2.5 transition-colors', checked ? 'border-copper/60 bg-copper/[0.06]' : 'border-[rgb(var(--line-strong)/0.16)] hover:bg-s2')}>
                  <input type="radio" name="theme" value={o.id} checked={checked} onChange={() => setTheme(o.id)} className="mt-1 accent-[rgb(var(--copper))]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink">{o.label}</span>
                    <span className="block text-[11.5px] text-ink-3">{o.note}</span>
                    <span className="mt-2 flex gap-1" aria-hidden>
                      {o.swatch.map((c) => (
                        <span key={c} className="h-3 w-5 rounded-[2px] border border-[rgb(var(--line-strong)/0.2)]" style={{ background: c }} />
                      ))}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <div>
          <div className="eyebrow mb-2">Motion</div>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded border border-[rgb(var(--line-strong)/0.16)] px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[13px] text-ink">Reduce motion</span>
              <span className="block text-[11.5px] leading-snug text-ink-3">
                Turns off flow animations, transitions and counters.
                {systemReduced ? ' Your system already asks for reduced motion, which REGENT always respects.' : ''}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={reduced || systemReduced}
              disabled={systemReduced}
              aria-checked={reduced || systemReduced}
              onChange={(e) => {
                setReduced(e.target.checked)
                applyMotion(e.target.checked)
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--copper))]"
            />
          </label>
        </div>
      </div>
    </SectionPanel>
  )
}

// ------------------------------------------------------------------ datasets

function Datasets() {
  const q = useDatasets()
  const activate = useActivateDataset()
  const reset = useResetDemo()
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useSession()
  const [pending, setPending] = useState<DatasetRow | null>(null)
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/datasets/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      await afterDatasetChange(qc)
      toast({ title: 'Dataset deleted', body: pending ? `${pending.name} and its verification runs were removed.` : undefined, tone: 'success' })
      setPending(null)
    },
    onError: (e) => toast({ title: 'Delete failed', body: e instanceof Error ? e.message : undefined, tone: 'error' }),
  })

  const resetButton = (
    <Button
      size="sm"
      loading={reset.isPending}
      onClick={() =>
        reset.mutate(undefined, {
          onSuccess: () => toast({ title: 'Switched to the demo dataset', tone: 'success' }),
          onError: (e) => toast({ title: 'Could not switch to the demo', body: e instanceof Error ? e.message : undefined, tone: 'error' }),
        })
      }
    >
      Reset to demo
    </Button>
  )

  return (
    <SectionPanel id="datasets" title="Datasets" description="Each import, scenario and built chain is its own dataset. They are never mixed. The active dataset drives every view." actions={resetButton}>
      {q.isLoading ? (
        <LoadingState label="Loading datasets" className="min-h-[160px]" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} className="mx-4 my-4" />
      ) : !q.data || q.data.datasets.length === 0 ? (
        <EmptyState
          title="No datasets"
          body="This organization has no datasets yet. Reset to the demo, load a scenario, or import your own events."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton to="/app/scenarios" variant="primary">
                Open scenario lab
              </LinkButton>
              <LinkButton to="/app/import">Import events</LinkButton>
            </div>
          }
        />
      ) : (
        <ul aria-label="Datasets">
          {q.data.datasets.map((d) => {
            const active = d.id === q.data.active_dataset_id
            const canDelete = can('analyst') && d.source !== 'demo'
            return (
              <li key={d.id} className={cx('flex flex-col gap-3 border-b hairline px-4 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between', active && 'bg-copper/[0.05]')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceTag source={d.source} />
                    <span className="text-[13.5px] text-ink [overflow-wrap:anywhere]">{d.name}</span>
                    {active ? <Badge tone="copper">Active</Badge> : null}
                  </div>
                  <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-3">
                    <div className="flex gap-1">
                      <dt>Records</dt>
                      <dd className="tnum text-ink-2">
                        {d.records_accepted} accepted{d.records_rejected > 0 ? <span className="text-amber-ink"> · {d.records_rejected} rejected</span> : null}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Created</dt>
                      <dd className="font-mono text-ink-2">{stamp(d.created_at)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Latest run</dt>
                      <dd className="font-mono text-ink-2">{d.latest_run ? stamp(d.latest_run.created_at) : 'not verified yet'}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt>Id</dt>
                      <dd className="id min-w-0 text-[11px]">{d.id}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={active ? 'ghost' : 'secondary'}
                    disabled={active}
                    loading={activate.isPending && activate.variables === d.id}
                    onClick={() =>
                      activate.mutate(d.id, {
                        onSuccess: () => toast({ title: 'Dataset activated', body: d.name, tone: 'success' }),
                        onError: (e) => toast({ title: 'Could not activate', body: e instanceof Error ? e.message : undefined, tone: 'error' }),
                      })
                    }
                    aria-label={active ? `${d.name} is the active dataset` : `Activate ${d.name}`}
                  >
                    {active ? 'Active' : 'Activate'}
                  </Button>
                  {canDelete ? (
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setPending(d)} aria-label={`Delete ${d.name}`}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!can('analyst') ? <p className="border-t hairline px-4 py-2.5 text-[11.5px] text-ink-3">Deleting datasets requires the analyst role or higher. The demo dataset cannot be deleted.</p> : null}

      <Modal open={pending !== null} onClose={() => (del.isPending ? undefined : setPending(null))} title="Delete dataset?">
        {pending ? (
          <div className="px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink-2">
              <span className="font-medium text-ink [overflow-wrap:anywhere]">{pending.name}</span> and every verification run, finding status and ingestion issue recorded for it will be permanently removed. Exports already downloaded are unaffected.
            </p>
            <p className="mt-2 font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">{pending.id}</p>
            {pending.id === q.data?.active_dataset_id ? <p className="mt-2 text-[12px] text-amber-ink">This is your active dataset. You will be switched back to the demo.</p> : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPending(null)} disabled={del.isPending}>
                Cancel
              </Button>
              <Button variant="danger" icon={<Trash2 size={14} />} loading={del.isPending} onClick={() => del.mutate(pending.id)}>
                Delete dataset
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </SectionPanel>
  )
}

// -------------------------------------------------------------------- tokens

function Tokens() {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const create = useMutation({ mutationFn: (n: string) => api.post<{ token: string; prefix: string; note: string }>('/api/tokens', { name: n }) })
  const trimmed = name.trim()
  const invalid = trimmed.length === 0 || trimmed.length > 80
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!invalid) create.mutate(trimmed, { onSuccess: () => (setName(''), setTouched(false)) })
  }
  return (
    <SectionPanel id="tokens" title="API tokens" description="For the CLI, CI jobs and scripts. A token acts with your role. Send it as Authorization: Bearer; no CSRF header is needed.">
      <div className="p-4">
        {create.data ? (
          <div role="status" className="mb-4 rounded border border-amber/50 bg-amber/[0.06] p-3.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-amber-ink">
              <AlertTriangle size={14} aria-hidden /> Copy this token now. It is shown once.
            </div>
            <p className="mt-1 text-[12px] text-ink-2">REGENT stores only a hash. If you lose it, create a new one. Store it in a secret manager, not in source control.</p>
            <div className="mt-2.5 flex min-w-0 items-center gap-2 rounded border hairline-strong bg-s2 px-2.5 py-2">
              <code className="min-w-0 flex-1 font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{create.data.token}</code>
              <CopyButton text={create.data.token} label="Copy token" />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-ink-3">prefix {create.data.prefix}</span>
              <Button size="sm" onClick={() => create.reset()}>
                I have stored it
              </Button>
            </div>
          </div>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
          <TextInput
            label="Token name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci-verify"
            maxLength={80}
            autoComplete="off"
            aria-invalid={touched && invalid ? true : undefined}
            className="flex-1 sm:max-w-sm"
          />
          <Button type="submit" variant="primary" icon={<KeyRound size={14} />} loading={create.isPending}>
            Create token
          </Button>
        </form>
        {touched && invalid ? <p className="mt-1.5 text-[11.5px] text-amber-ink">Give the token a name of 1 to 80 characters, so you can tell it apart in the audit log.</p> : null}
        {create.isError ? (
          <p role="alert" className="mt-2 text-[12px] text-amber-ink">
            {create.error instanceof Error ? create.error.message : 'Could not create the token.'}
          </p>
        ) : null}
      </div>
    </SectionPanel>
  )
}

// ----------------------------------------------------------------- audit log

interface AuditEntry {
  id: number | string
  user_id: string | null
  user_name?: string | null
  user_email?: string | null
  action: string
  target: string | null
  detail: unknown
  request_id: string | null
  created_at: string
}

function AuditLog() {
  const q = useQuery({ queryKey: ['audit-log'], queryFn: () => api.get<{ entries: AuditEntry[] }>('/api/audit-log') })
  return (
    <SectionPanel
      id="audit"
      title="Audit log"
      description="REGENT's own record of sign-ins, exports, dataset changes, rule changes and triage. The latest 200 entries for your organization."
      actions={
        <Button size="sm" variant="ghost" onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading}>
          Refresh
        </Button>
      }
    >
      {q.isLoading ? (
        <LoadingState label="Loading audit log" className="min-h-[160px]" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} className="mx-4 my-4" />
      ) : !q.data || q.data.entries.length === 0 ? (
        <EmptyState title="No audit entries yet" body="Entries appear when someone signs in, exports a report, changes a rule or triages a finding." />
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead className="sticky top-0 bg-s1">
              <tr className="border-b hairline-strong">
                <th scope="col" className="eyebrow px-4 py-2 font-normal">Time</th>
                <th scope="col" className="eyebrow px-3 py-2 font-normal">User</th>
                <th scope="col" className="eyebrow px-3 py-2 font-normal">Action</th>
                <th scope="col" className="eyebrow px-3 py-2 font-normal">Target</th>
                <th scope="col" className="eyebrow px-4 py-2 font-normal">Request id</th>
              </tr>
            </thead>
            <tbody>
              {q.data.entries.map((e) => (
                <tr key={String(e.id)} className="border-b hairline align-top last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-ink-2">{stamp(String(e.created_at), true)}</td>
                  <td className="px-3 py-2">
                    <span className="text-[12px] text-ink" title={e.user_email ?? e.user_id ?? ''}>{e.user_name ?? e.user_id ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-ink">{e.action}</td>
                  <td className="px-3 py-2">
                    <span className="id text-[11.5px]">{e.target ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="id text-[11px] text-ink-3">{e.request_id ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data ? <p className="border-t hairline px-4 py-2 text-[11.5px] text-ink-3">{plural(q.data.entries.length, 'entry', 'entries')} shown.</p> : null}
    </SectionPanel>
  )
}

// ------------------------------------------------------------------- account

const ROLE_CAN: Record<Role, string> = {
  viewer: 'View chains, findings, registry and controls; download JSON and CSV exports.',
  auditor: 'Everything a viewer can, plus PDF reports and the evidence package.',
  analyst: 'Everything an auditor can, plus import evidence, re-run verification, triage findings, save built chains and create API tokens.',
  admin: 'Everything an analyst can, plus change verification rules and read the audit log.',
}

function Account() {
  const { session } = useSession()
  const [signingOut, setSigningOut] = useState(false)
  const u = session?.user
  if (!u) return null
  return (
    <SectionPanel id="account" title="Account">
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <dl className="grid grid-cols-[minmax(90px,max-content)_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <dt className="text-ink-3">Name</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">{u.display_name || '—'}</dd>
          <dt className="text-ink-3">Email</dt>
          <dd className="font-mono text-[12px] text-ink-2 [overflow-wrap:anywhere]">{u.email}</dd>
          <dt className="text-ink-3">Role</dt>
          <dd>
            <Badge tone="copper">{u.role}</Badge>
          </dd>
          <dt className="text-ink-3">Organization</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">{session?.organization?.name || '—'}</dd>
        </dl>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            <span className="text-ink-3">Your role can: </span>
            {ROLE_CAN[u.role]}
          </p>
          {u.is_demo_persona ? (
            <p className="rounded border border-dashed border-fog/50 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
              You are signed in as a demo persona. Demo personas exist only when the server runs in demo mode, share one demo organization, and should never be enabled on a deployment holding real evidence.
            </p>
          ) : null}
          <div>
            <Button
              size="sm"
              loading={signingOut}
              onClick={async () => {
                setSigningOut(true)
                try {
                  await api.post('/api/auth/logout')
                } finally {
                  window.location.assign('/signin')
                }
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </SectionPanel>
  )
}

