import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { LoadingMark } from '../brand/Logo'
import { cx } from './primitives'

export function EmptyState({ title, body, action, icon, className }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      {body ? <p className="max-w-md text-[12.5px] leading-relaxed text-ink-2">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex min-h-[220px] items-center justify-center', className)}>
      <LoadingMark label={label} />
    </div>
  )
}

const RECOVERY: Record<string, { title: string; body: string }> = {
  SERVER_UNAVAILABLE: { title: 'Server unavailable', body: 'The REGENT API did not respond. Start it with `npm run dev`, then retry.' },
  DATABASE_UNAVAILABLE: { title: 'Database unavailable', body: 'The API is running but cannot reach its database. Check DATABASE_URL or the PGlite data directory.' },
  NO_DATASET: { title: 'No dataset loaded', body: 'Load the demo environment, run a scenario, or import your own events.' },
  NOT_FOUND: { title: 'Not found', body: 'It is not in the active dataset. It may belong to a different dataset — switch datasets from the top bar.' },
  UNAUTHENTICATED: { title: 'Signed out', body: 'Your session ended. Sign in again to continue.' },
  FORBIDDEN: { title: 'Not permitted', body: 'Your role does not allow this. An administrator can change your role.' },
  VALIDATION_FAILED: { title: 'Invalid input', body: 'The request did not match the expected shape. Details are below.' },
}

export function ErrorState({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const e = error instanceof ApiError ? error : null
  const r = (e && RECOVERY[e.code]) ?? { title: 'Verification failed', body: e?.message ?? 'Something went wrong while loading this view.' }
  const [open, setOpen] = useState(false)
  return (
    <div role="alert" className={cx('panel mx-auto my-8 max-w-lg p-6', className)}>
      <div className="eyebrow mb-1 text-crimson-ink">{e?.code ?? 'ERROR'}</div>
      <h3 className="text-[15px] font-medium text-ink">{r.title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{e && RECOVERY[e.code] ? `${e.message} ${r.body}` : r.body}</p>
      <div className="mt-4 flex items-center gap-3">
        {retry ? (
          <button onClick={retry} className="h-8 rounded border border-[rgb(var(--line-strong)/0.2)] bg-s2 px-3 text-[12.5px] text-ink hover:bg-s3">
            Retry
          </button>
        ) : null}
        <button onClick={() => setOpen((o) => !o)} className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline" aria-expanded={open}>
          Technical details
        </button>
      </div>
      {open ? (
        <pre className="mt-3 overflow-x-auto rounded bg-s2 p-3 font-mono text-[11px] text-ink-2">
          {JSON.stringify({ status: e?.status, code: e?.code, request_id: e?.requestId, details: e?.details ?? String(error) }, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------- toasts

type Toast = { id: number; title: string; body?: string; tone: 'neutral' | 'success' | 'error' }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((xs) => [...xs.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 4800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx('panel-raised pointer-events-auto border-l-2 px-4 py-3 anim-fade-up', t.tone === 'success' ? 'border-l-sage' : t.tone === 'error' ? 'border-l-crimson' : 'border-l-copper')}>
            <div className="text-[13px] font-medium text-ink">{t.title}</div>
            {t.body ? <div className="mt-0.5 text-[12px] text-ink-2">{t.body}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
