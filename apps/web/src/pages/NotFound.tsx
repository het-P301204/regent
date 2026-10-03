import { Link, useLocation } from 'react-router'
import { Mark } from '../brand/Logo'
import { LinkButton } from '../ui/primitives'

/** Calm 404. Renders inside the app shell for /app/* and full-page elsewhere. */
export default function NotFound() {
  const { pathname } = useLocation()
  const inShell = pathname.startsWith('/app')
  const body = (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <svg width="132" height="40" viewBox="0 0 132 40" aria-hidden className="mb-6">
        <line x1="8" y1="20" x2="70" y2="20" stroke="rgb(var(--copper))" strokeWidth="2" strokeLinecap="round" />
        <circle cx="8" cy="20" r="4" fill="rgb(var(--ink))" />
        <circle cx="70" cy="20" r="4" fill="rgb(var(--ink))" />
        <line x1="78" y1="20" x2="122" y2="20" stroke="rgb(var(--fog))" strokeWidth="1.5" strokeDasharray="3 4" />
        <circle cx="124" cy="20" r="4.5" fill="none" stroke="rgb(var(--fog))" strokeWidth="1.5" strokeDasharray="2 2" />
      </svg>
      <div className="eyebrow mb-2">404 · Not found</div>
      <h1 className="page-title">The chain ends here</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
        Nothing is recorded at <code className="font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">{pathname}</code>. The link may be mistyped, or it may point at a record in a dataset that is not active.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <LinkButton to="/app" variant="primary">
          Command Center
        </LinkButton>
        <LinkButton to="/docs">Documentation</LinkButton>
      </div>
    </div>
  )
  if (inShell) return body
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-14 items-center border-b hairline px-4 sm:px-6">
        <Link to="/" aria-label="REGENT home" className="inline-flex items-center gap-2.5 rounded">
          <Mark size={24} />
          <span className="font-sans text-[13px] font-semibold tracking-[0.32em] text-ink">REGENT</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center">{body}</main>
    </div>
  )
}
