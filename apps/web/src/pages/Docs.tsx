import { useEffect, useRef } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Wordmark } from '../brand/Logo'
import { LinkButton, Select, cx } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'
import { DOC_SECTIONS } from '../components/docs/sections'

const GROUPS = [...new Set(DOC_SECTIONS.map((s) => s.group))]

export default function Docs() {
  const { section } = useParams()
  const navigate = useNavigate()
  const slug = section ?? 'overview'
  const index = DOC_SECTIONS.findIndex((s) => s.slug === slug)
  const current = index >= 0 ? DOC_SECTIONS[index]! : null
  const headingRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  useEffect(() => {
    document.title = current ? `${current.title} · REGENT docs` : 'Not found · REGENT docs'
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [current])

  const prev = index > 0 ? DOC_SECTIONS[index - 1] : undefined
  const next = index >= 0 ? DOC_SECTIONS[index + 1] : undefined

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#docs-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-copper focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b hairline bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" aria-label="REGENT home" className="rounded">
              <Wordmark compact />
            </Link>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 sm:inline">Documentation</span>
          </div>
          <LinkButton to="/app" size="sm" variant="primary">
            Open console
          </LinkButton>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-8 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:pt-10">
        <div className="lg:hidden">
          <Select label="Section" value={current?.slug ?? ''} onChange={(e) => navigate(`/docs/${e.target.value}`)}>
            {current ? null : <option value="">Choose a section</option>}
            {DOC_SECTIONS.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.group} · {s.title}
              </option>
            ))}
          </Select>
        </div>

        <nav aria-label="Documentation sections" className="hidden lg:block">
          <div className="sticky top-24 flex flex-col gap-5">
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="eyebrow mb-1.5">{g}</div>
                <ul className="flex flex-col border-l hairline">
                  {DOC_SECTIONS.filter((s) => s.group === g).map((s) => (
                    <li key={s.slug}>
                      <NavLink
                        to={`/docs/${s.slug}`}
                        end
                        className={({ isActive }) => cx('-ml-px block border-l-2 py-1 pl-3 text-[13px] transition-colors', isActive || (s.slug === 'overview' && !section) ? 'border-copper text-ink' : 'border-transparent text-ink-3 hover:border-[rgb(var(--line-strong)/0.3)] hover:text-ink-2')}
                        aria-current={s.slug === current?.slug ? 'page' : undefined}
                      >
                        {s.title}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <main id="docs-main" tabIndex={-1} className="min-w-0 outline-none">
          {current ? (
            <article aria-labelledby="doc-title" key={current.slug} className="anim-fade-up">
              <header className="mb-8 max-w-[72ch] border-b hairline pb-6">
                <div className="eyebrow mb-2">{current.group}</div>
                <h1 id="doc-title" ref={headingRef} tabIndex={-1} className="page-title outline-none">
                  {current.title}
                </h1>
                <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{current.lead}</p>
              </header>
              <div className="min-w-0">{current.body()}</div>
              <nav aria-label="Previous and next section" className="mt-12 flex max-w-[72ch] items-stretch justify-between gap-3 border-t hairline pt-5">
                {prev ? (
                  <Link to={`/docs/${prev.slug}`} className="group flex min-w-0 flex-col rounded px-1 py-1">
                    <span className="eyebrow inline-flex items-center gap-1">
                      <ArrowLeft size={11} aria-hidden /> Previous
                    </span>
                    <span className="truncate text-[13.5px] text-ink-2 group-hover:text-ink">{prev.title}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link to={`/docs/${next.slug}`} className="group flex min-w-0 flex-col items-end rounded px-1 py-1 text-right">
                    <span className="eyebrow inline-flex items-center gap-1">
                      Next <ArrowRight size={11} aria-hidden />
                    </span>
                    <span className="truncate text-[13.5px] text-ink-2 group-hover:text-ink">{next.title}</span>
                  </Link>
                ) : null}
              </nav>
            </article>
          ) : (
            <div className="panel">
              <EmptyState
                title="No such section"
                body={`The documentation has no section called "${slug}". It may have been renamed.`}
                action={
                  <LinkButton to="/docs" variant="primary">
                    Go to the overview
                  </LinkButton>
                }
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
