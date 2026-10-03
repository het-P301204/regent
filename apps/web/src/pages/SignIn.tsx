import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { api, ApiError, setCsrf } from '../lib/api'
import { useSession } from '../lib/session'
import type { Role, SessionInfo } from '../lib/types'
import { Mark } from '../brand/Logo'
import { Badge, Button, TextInput, cx } from '../ui/primitives'
import { LoadingState } from '../ui/feedback'

const ROLE_SUMMARY: Record<Role, string> = {
  admin: 'Everything below, plus verification rules and the audit log.',
  analyst: 'Import evidence, re-run verification, triage findings, create API tokens.',
  auditor: 'Read everything; download PDF reports and the evidence package.',
  viewer: 'Read chains, findings, registry and controls.',
}
const ROLE_ORDER: Role[] = ['admin', 'analyst', 'auditor', 'viewer']

/** Only same-origin paths: never follow `next` to another host. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/app'
  // Reject control characters and encoded slashes/backslashes that could re-form "//host".
  for (const ch of raw) if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) return '/app'
  if (/%(2f|5c|09|0a|0d)/i.test(raw)) return '/app'
  return raw
}

export default function SignIn() {
  const { session, loading, refresh } = useSession()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  if (loading) return <LoadingState label="Checking session" className="min-h-screen" />
  if (session?.authenticated) return <Navigate to={next} replace />

  return (
    <div className="grid min-h-screen grid-cols-1 bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="dotgrid relative flex flex-col justify-between gap-10 border-b hairline px-6 py-8 sm:px-10 lg:border-b-0 lg:border-r lg:py-12">
        <Link to="/" className="inline-flex w-max items-center gap-2.5 rounded" aria-label="REGENT home">
          <span className="font-sans text-[13px] font-semibold tracking-[0.32em] text-ink">REGENT</span>
        </Link>
        <div className="max-w-md">
          <Mark size={72} />
          <h1 className="mt-6 font-display text-[44px] leading-[1.02] tracking-[-0.01em] text-ink">Authority, traced.</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
            REGENT reconstructs the delegation chain behind every AI-agent action and verifies that delegated authority never silently expands.
          </p>
        </div>
        <p className="hidden font-mono text-[10.5px] tracking-[0.06em] text-ink-4 lg:block">principal → agent → sub-agent → tool → execution identity → resource</p>
      </aside>

      <main className="flex items-start justify-center px-4 py-10 sm:px-10 lg:items-center">
        <div className="w-full max-w-[460px]">
          <h2 className="text-[20px] font-medium text-ink">Sign in</h2>
          <p className="mt-1 text-[13px] text-ink-3">to the REGENT console</p>

          {!session ? (
            <div role="alert" className="mt-5 rounded border border-amber/50 bg-amber/[0.06] px-3.5 py-3 text-[12.5px] text-ink-2">
              <span className="font-medium text-amber-ink">REGENT is not reachable.</span> The session check failed. Start the API with <code className="font-mono text-[12px]">npm run dev</code>, then{' '}
              <button type="button" onClick={() => refresh()} className="text-copper-ink underline underline-offset-2">
                retry
              </button>
              .
            </div>
          ) : null}

          {session?.demo_mode && session.personas && session.personas.length > 0 ? <Personas personas={session.personas} next={next} onDone={refresh} /> : null}

          <PasswordForm next={next} onDone={refresh} hasPersonas={!!session?.demo_mode} />

          <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <Link to="/docs" className="hover:text-ink-2 hover:underline">
              Documentation
            </Link>
            <Link to="/docs/security" className="hover:text-ink-2 hover:underline">
              Security model
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

function Personas({ personas, next, onDone }: { personas: NonNullable<SessionInfo['personas']>; next: string; onDone: () => Promise<void> }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sorted = [...personas].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const pick = async (role: Role) => {
    setBusy(role)
    setError(null)
    try {
      const r = await api.post<{ ok: boolean; csrf_token?: string }>('/api/auth/demo', { persona: role })
      if (r.csrf_token) setCsrf(r.csrf_token)
      await onDone()
      navigate(next, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in as that persona.')
      setBusy(null)
    }
  }
  return (
    <section aria-labelledby="personas-h" className="mt-6">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="personas-h" className="eyebrow">
          Demo personas
        </h3>
        <Badge tone="fog">Demo mode</Badge>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">These personas exist only because this server runs in demo mode. They share the fictional Acme AI Operations organization.</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sorted.map((p) => (
          <li key={p.role}>
            <button
              type="button"
              onClick={() => pick(p.role)}
              disabled={busy !== null}
              aria-busy={busy === p.role || undefined}
              className={cx('group flex h-full w-full flex-col items-start gap-1 rounded-md border bg-s1 px-3.5 py-3 text-left transition-colors hover:border-copper/50 hover:bg-s2 disabled:opacity-60', busy === p.role ? 'border-copper/60' : 'hairline-strong')}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium text-ink">{p.display_name}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper-ink">{p.role}</span>
              </span>
              <span className="text-[12px] text-ink-2">{p.title}</span>
              <span className="text-[11.5px] leading-snug text-ink-3">{ROLE_SUMMARY[p.role]}</span>
              <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-copper-ink opacity-80 group-hover:opacity-100">
                {busy === p.role ? 'Signing in' : `Continue as ${p.role}`} <ArrowRight size={12} aria-hidden />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-amber-ink">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function PasswordForm({ next, onDone, hasPersonas }: { next: string; onDone: () => Promise<void>; hasPersonas: boolean }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ ok: boolean; csrf_token?: string }>('/api/auth/login', { email: email.trim(), password })
      if (r.csrf_token) setCsrf(r.csrf_token)
      setPassword('')
      await onDone()
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.')
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="pw-h" className={cx(hasPersonas ? 'mt-7 border-t hairline pt-6' : 'mt-6')}>
      <h3 id="pw-h" className="eyebrow">
        {hasPersonas ? 'Or sign in with an account' : 'Account'}
      </h3>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3" noValidate>
        <TextInput label="Email" type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        <TextInput label="Password" type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={512} />
        {error ? (
          <p role="alert" className="text-[12.5px] text-amber-ink">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </section>
  )
}
