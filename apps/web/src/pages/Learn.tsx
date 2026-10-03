import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react'
import { PageHeader, Select, cx } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'
import { CONCEPTS } from '../components/learn/concepts'
import type { Concept } from '../components/learn/concepts'

export default function Learn() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('c')
  const index = Math.max(0, CONCEPTS.findIndex((c) => c.slug === requested))
  const unknown = requested !== null && !CONCEPTS.some((c) => c.slug === requested)
  const concept = CONCEPTS[index]!
  const headingRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView({ block: 'nearest' })
  }, [concept.slug])

  const go = (slug: string) => setParams({ c: slug })
  const prev = CONCEPTS[index - 1]
  const next = CONCEPTS[index + 1]

  return (
    <div>
      <PageHeader
        eyebrow="Learn · Concepts"
        title="How delegated authority fails"
        description="Eleven concepts behind REGENT's checks, each with an example from the Acme demo dataset and a link to the live view where you can see the engine's result."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <Select label="Concept" value={concept.slug} onChange={(e) => go(e.target.value)}>
            {CONCEPTS.map((c, i) => (
              <option key={c.slug} value={c.slug}>
                {String(i + 1).padStart(2, '0')} {c.title}
              </option>
            ))}
          </Select>
        </div>

        <nav aria-label="Concepts" className="hidden lg:block">
          <ol className="sticky top-20 flex flex-col border-l hairline">
            {CONCEPTS.map((c, i) => {
              const active = c.slug === concept.slug
              return (
                <li key={c.slug}>
                  <Link
                    to={{ search: `?c=${c.slug}` }}
                    aria-current={active ? 'page' : undefined}
                    className={cx('-ml-px flex items-baseline gap-2.5 border-l-2 py-1.5 pl-3 pr-2 text-[13px] transition-colors', active ? 'border-copper text-ink' : 'border-transparent text-ink-3 hover:border-[rgb(var(--line-strong)/0.3)] hover:text-ink-2')}
                  >
                    <span className="tnum font-mono text-[10.5px] text-ink-4">{String(i + 1).padStart(2, '0')}</span>
                    {c.title}
                  </Link>
                </li>
              )
            })}
          </ol>
        </nav>

        <div className="min-w-0">
          {unknown ? (
            <div className="panel mb-4">
              <EmptyState
                title="No concept by that name"
                body={`"${requested}" is not one of the concepts. Showing the first concept instead; pick another from the list.`}
                className="py-6"
              />
            </div>
          ) : null}
          <ConceptDetail key={concept.slug} concept={concept} number={index + 1} headingRef={headingRef} />
          <nav aria-label="Previous and next concept" className="mt-6 flex items-center justify-between gap-3 border-t hairline pt-4">
            {prev ? (
              <Link to={{ search: `?c=${prev.slug}` }} className="inline-flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
                <ArrowLeft size={14} aria-hidden />
                <span className="truncate">
                  <span className="sr-only">Previous: </span>
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={{ search: `?c=${next.slug}` }} className="inline-flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
                <span className="truncate">
                  <span className="sr-only">Next: </span>
                  {next.title}
                </span>
                <ArrowRight size={14} aria-hidden />
              </Link>
            ) : (
              <Link to="/app/standards" className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
                Standards mapping <ArrowRight size={14} aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('border-t hairline pt-4', className)}>
      <h3 className="eyebrow mb-2.5">{title}</h3>
      {children}
    </section>
  )
}

function ConceptDetail({ concept: c, number, headingRef }: { concept: Concept; number: number; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <article aria-labelledby="concept-title" className="anim-fade-up">
      <header className="mb-5">
        <div className="eyebrow mb-1.5">
          Concept {String(number).padStart(2, '0')} of {CONCEPTS.length}
        </div>
        <h2 id="concept-title" ref={headingRef} tabIndex={-1} className="font-display text-[28px] leading-[1.1] text-ink outline-none">
          {c.title}
        </h2>
        <p className="mt-1.5 text-[14px] text-ink-2">{c.kicker}</p>
      </header>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section title="Concept">{c.concept}</Section>
          <div className="flex flex-col gap-5">
            <Section title="Why it matters">{c.why}</Section>
            <Section title="Example">{c.example}</Section>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-labelledby="concept-viz" className="panel p-4">
            <h3 id="concept-viz" className="eyebrow mb-3">
              In REGENT
            </h3>
            <figure>
              <div className="min-w-0">{c.viz}</div>
              <figcaption className="mt-3 border-t hairline pt-2.5 text-[11.5px] leading-relaxed text-ink-3">{c.vizCaption}</figcaption>
            </figure>
          </section>
          <section aria-labelledby="concept-try" className="panel self-start p-4">
            <h3 id="concept-try" className="eyebrow mb-2">
              Try it
            </h3>
            <ul className="flex flex-col">
              {c.tryIt.map((t) => (
                <li key={t.to + t.label} className="border-b hairline last:border-b-0">
                  <Link to={t.to} className="group flex items-start justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[13px] text-copper-ink group-hover:underline">{t.label}</span>
                      <span className="block text-[12px] text-ink-3">{t.note}</span>
                    </span>
                    <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-ink-3 group-hover:text-copper-ink" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </article>
  )
}
