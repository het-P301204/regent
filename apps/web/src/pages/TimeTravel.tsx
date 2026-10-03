import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { api } from '../lib/api'
import { useActiveDataset, wsKey } from '../lib/queries'
import { useReducedMotion } from '../lib/prefs'
import { day, hhmm, plural, stamp } from '../lib/format'
import type { AuthorityAtTime } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Panel, Tooltip } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { ScopeChips } from '../ui/scope'
import { LifecycleBadge, SourceTag } from '../ui/status'

/**
 * Time travel: the authority that existed at an instant, as the engine
 * reconstructs it (GET /api/time-travel?at=). The page only scrubs time and
 * renders the answer; it highlights what changed since the previous instant.
 */

type Checkpoint = { at: string; label: string }
type View = AuthorityAtTime & { checkpoints: Checkpoint[]; names: Record<string, string> }

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function TimeTravel() {
  const reduced = useReducedMotion()
  const { active } = useActiveDataset()
  const [params, setParams] = useSearchParams()
  const cps = useQuery({ queryKey: wsKey('time-travel', 'checkpoints'), queryFn: () => api.get<{ checkpoints: Checkpoint[] }>('/api/time-travel') })
  const checkpoints = useMemo(() => cps.data?.checkpoints ?? [], [cps.data])
  const fromUrl = params.get('at')
  const [at, setAtState] = useState<string | null>(fromUrl)
  const current = at ?? checkpoints[checkpoints.length - 1]?.at ?? null
  const debAt = useDebounced(current, 140)
  const view = useQuery({
    queryKey: wsKey('time-travel', debAt),
    queryFn: () => api.get<View>(`/api/time-travel?at=${encodeURIComponent(debAt!)}`),
    enabled: !!debAt,
    placeholderData: keepPreviousData,
  })

  const setAt = (iso: string) => {
    setAtState(iso)
    const next = new URLSearchParams(params)
    next.set('at', iso)
    setParams(next, { replace: true })
  }

  // What the previous instant looked like, to mark changes.
  const lastRef = useRef<View | null>(null)
  const [base, setBase] = useState<View | null>(null)
  useEffect(() => {
    if (view.data && view.data !== lastRef.current) {
      setBase(lastRef.current)
      lastRef.current = view.data
    }
  }, [view.data])

  const idx = useMemo(() => {
    if (!current) return 0
    let i = 0
    checkpoints.forEach((c, k) => {
      if (c.at <= current) i = k
    })
    return i
  }, [checkpoints, current])
  const prev = current ? [...checkpoints].reverse().find((c) => c.at < current) : undefined
  const next = current ? checkpoints.find((c) => c.at > current) : undefined
  const dayIso = checkpoints[0]?.at.slice(0, 10) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input,select,textarea,[contenteditable="true"],[role="slider"]') || e.metaKey || e.ctrlKey || e.altKey)) return
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault()
        setAt(prev.at)
      }
      if (e.key === 'ArrowRight' && next) {
        e.preventDefault()
        setAt(next.at)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const header = (
    <PageHeader
      eyebrow="Analyze · Time travel"
      title="Authority at a point in time"
      description="Scrub through the active dataset's recorded authority changes. At each instant the engine reports who held what authority, through which delegations, and which identities and credentials were still valid."
      actions={active ? <SourceTag source={active.source} /> : null}
    />
  )

  if (cps.isLoading) return (
    <div>
      {header}
      <LoadingState label="Loading checkpoints" />
    </div>
  )
  if (cps.isError) return (
    <div>
      {header}
      <ErrorState error={cps.error} retry={() => cps.refetch()} />
    </div>
  )
  if (checkpoints.length === 0)
    return (
      <div>
        {header}
        <EmptyState icon={<History size={22} aria-hidden />} title="No recorded authority changes" body="The active dataset has no timestamped delegations, revocations or actions, so there is nothing to travel through. Load a scenario or import events with timestamps." action={<LinkButton to="/app/scenarios">Open the scenario lab</LinkButton>} />
      </div>
    )

  const here = checkpoints.filter((c) => c.at === current)
  const d = view.data
  const nm = (id: string | null) => (id ? (d?.names[id] ?? id) : 'unknown')
  const baseState = <T extends { state: string }>(list: T[] | undefined, key: (x: T) => string, id: string) => list?.find((x) => key(x) === id)?.state
  const listAnim = reduced ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, x: -8 }, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const } }

  return (
    <div>
      {header}

      <Panel id="tt-scrub" bodyClassName="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="eyebrow mb-1">Instant</div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tnum font-mono text-[26px] font-light leading-none text-ink">{hhmm(current)}</span>
              <span className="text-[12.5px] text-ink-3">UTC · {day(current)}</span>
            </div>
            <p className="mt-1.5 min-h-[18px] text-[12px] text-ink-2 [overflow-wrap:anywhere]">{here.length > 0 ? here.map((c) => c.label).join(' · ') : 'Between checkpoints'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} aria-hidden />} disabled={!prev} onClick={() => prev && setAt(prev.at)} aria-keyshortcuts="ArrowLeft">
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && setAt(next.at)} aria-keyshortcuts="ArrowRight">
              Next
              <ChevronRight size={14} aria-hidden />
            </Button>
            {dayIso
              ? ['10:00', '10:15', '10:30', '11:00'].map((t) => {
                  const iso = `${dayIso}T${t}:00.000Z`
                  return (
                    <Button key={t} size="sm" variant={current === iso ? 'primary' : 'secondary'} onClick={() => setAt(iso)} aria-pressed={current === iso}>
                      {t}
                    </Button>
                  )
                })
              : null}
          </div>
        </div>
        <Scrubber checkpoints={checkpoints} index={idx} onIndex={(i) => setAt(checkpoints[i]!.at)} />
        <p className="mt-2 text-[11px] text-ink-3">Arrow keys on the scrubber move one checkpoint. Elsewhere on the page, ← and → jump to the previous or next checkpoint.</p>
      </Panel>

      {view.isError && !d ? (
        <ErrorState error={view.error} retry={() => view.refetch()} />
      ) : !d ? (
        <LoadingState label="Reconstructing authority" />
      ) : (
        <div className={cx('mt-4 space-y-4 transition-opacity duration-200', view.isFetching && 'opacity-70')} aria-busy={view.isFetching}>
          <p className="sr-only" aria-live="polite">
            At {stamp(d.at)}: {plural(d.holders.length, 'principal')} holding authority, {plural(d.delegations.filter((x) => x.state === 'VALID').length, 'delegation')} in force, {plural(d.actions_so_far.length, 'action')} so far.
          </p>
          <div className="panel grid grid-cols-2 md:grid-cols-4">
            <Count label="Holding authority" value={d.holders.length} className="border-b border-r hairline md:border-b-0" />
            <Count label="Delegations in force" value={d.delegations.filter((x) => x.state === 'VALID').length} of={d.delegations.length} className="border-b hairline md:border-b-0 md:border-r" />
            <Count label="Credentials valid" value={d.credentials.filter((x) => x.state === 'VALID').length} of={d.credentials.length} className="border-r hairline" />
            <Count label="Actions so far" value={d.actions_so_far.length} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Panel title="Authority that existed" eyebrow={`At ${hhmm(d.at)} UTC`} id="tt-holders">
              {d.holders.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-ink-2">No principal held delegated authority at this instant: every delegation was not yet valid, expired or revoked, or sat on a path that was.</p>
              ) : (
                <ul className="space-y-3">
                  <AnimatePresence initial={false}>
                    {d.holders.map((h) => (
                      <motion.li key={h.principal_id} layout={!reduced} {...listAnim} className="border-l-2 border-copper/50 pl-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/app/identities/${encodeURIComponent(h.principal_id)}`} className="text-[13px] font-medium text-ink hover:text-copper-ink hover:underline">
                            {nm(h.principal_id)}
                          </Link>
                          <span className="id">{h.principal_id}</span>
                          {h.unverified ? (
                            <Tooltip content="Something upstream is unknown, so this scope is only an upper bound on what the principal could exercise.">
                              <Badge tone="amber" className="cursor-help">
                                ! Unverified
                              </Badge>
                            </Tooltip>
                          ) : null}
                        </div>
                        <div className="mt-1.5">
                          <ScopeChips scope={h.scope} />
                        </div>
                        <div className="mt-1 font-mono text-[10.5px] text-ink-3 [overflow-wrap:anywhere]">via {h.via.join(', ')}</div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Panel>

            <Panel title="Delegations" eyebrow={`${d.delegations.length} recorded`} id="tt-dels" bodyClassName="p-0">
              {d.delegations.length === 0 ? (
                <p className="p-4 text-[12.5px] text-ink-3">The dataset records no delegations.</p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
                  {d.delegations.map((x) => {
                    const was = baseState(base?.delegations, (y) => y.delegation_id, x.delegation_id)
                    const changed = was !== undefined && was !== x.state
                    return (
                      <li key={x.delegation_id} className={cx('grid gap-x-3 gap-y-1 px-4 py-2.5 transition-colors duration-500 sm:grid-cols-[minmax(0,1fr)_auto]', changed && 'bg-copper/[0.06]')}>
                        <div className="min-w-0">
                          <div className="text-[12.5px] text-ink [overflow-wrap:anywhere]">
                            {nm(x.delegator_principal_id)} <span className="text-ink-3">→</span> {nm(x.delegatee_principal_id)}
                          </div>
                          <Link to={`/app/delegations/${encodeURIComponent(x.delegation_id)}`} className="id hover:text-copper-ink">
                            {x.delegation_id}
                          </Link>
                          <div className="mt-1">
                            <ScopeChips scope={x.effective_scope} tone={x.state === 'VALID' ? 'neutral' : 'muted'} />
                          </div>
                        </div>
                        <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                          <LifecycleBadge state={x.state} />
                          {changed ? <span className="font-mono text-[10px] text-copper-ink">was {was!.replace(/_/g, ' ')}</span> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StateList title="Principals" items={d.principals.map((p) => ({ id: p.principal_id, label: nm(p.principal_id), state: p.state, was: baseState(base?.principals, (y) => y.principal_id, p.principal_id) }))} href={(id) => `/app/identities/${encodeURIComponent(id)}`} />
            <StateList title="Credentials" items={d.credentials.map((c) => ({ id: c.credential_id, label: c.credential_id, state: c.state, was: baseState(base?.credentials, (y) => y.credential_id, c.credential_id) }))} href={() => '/app/credentials'} />
          </div>

          <Panel title="Actions so far" eyebrow={plural(d.actions_so_far.length, 'action')} id="tt-actions">
            {d.actions_so_far.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">No action had run by this instant.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {d.actions_so_far.slice(-24).map((a) => (
                  <li key={a}>
                    <Link to={`/app/chains/${encodeURIComponent(a)}`} className="inline-flex rounded-[3px] border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-1.5 py-[1px] font-mono text-[11px] text-ink-2 hover:border-copper/50 hover:text-ink">
                      {a}
                    </Link>
                  </li>
                ))}
                {d.actions_so_far.length > 24 ? <li className="self-center text-[11.5px] text-ink-3">and {d.actions_so_far.length - 24} earlier</li> : null}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

function Scrubber({ checkpoints, index, onIndex }: { checkpoints: Checkpoint[]; index: number; onIndex: (i: number) => void }) {
  const id = useId()
  const n = checkpoints.length
  const every = Math.max(1, Math.ceil(n / 8))
  const pos = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  return (
    <div className="mt-4">
      <label htmlFor={id} className="sr-only">
        Checkpoint
      </label>
      <div className="relative px-2">
        <input
          id={id}
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={index}
          onChange={(e) => onIndex(Number(e.target.value))}
          aria-valuetext={`${hhmm(checkpoints[index]?.at)} UTC: ${checkpoints[index]?.label ?? ''}`}
          className="relative z-10 w-full accent-[rgb(var(--copper))]"
          list={`${id}-ticks`}
        />
        <datalist id={`${id}-ticks`}>
          {checkpoints.map((_, i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
        <div className="pointer-events-none relative mx-[6px] mt-1 h-6" aria-hidden>
          {checkpoints.map((c, i) => (
            <span key={`${c.at}-${i}`} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pos(i)}%` }}>
              <span className={cx('w-px', i === index ? 'h-2.5 bg-copper' : c.label.startsWith('evt-') ? 'h-1.5 bg-ink-3' : 'h-2 bg-ink-2')} />
              {i % every === 0 || i === n - 1 ? <span className={cx('mt-0.5 font-mono text-[9.5px]', i === index ? 'text-copper-ink' : 'text-ink-3')}>{hhmm(c.at)}</span> : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Count({ label, value, of, className }: { label: string; value: number; of?: number; className?: string }) {
  return (
    <div className={cx('px-4 py-3', className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-sans text-[22px] font-light leading-none text-ink">
        <span className="tnum">{value}</span>
        {of !== undefined ? <span className="text-[13px] text-ink-3"> / {of}</span> : null}
      </div>
    </div>
  )
}

function StateList({ title, items, href }: { title: string; items: { id: string; label: string; state: string; was: string | undefined }[]; href: (id: string) => string }) {
  const notValid = items.filter((i) => i.state !== 'VALID').length
  return (
    <Panel title={title} eyebrow={notValid > 0 ? `${notValid} not valid at this instant` : 'All valid at this instant'} id={`tt-${title.toLowerCase()}`} bodyClassName="p-0">
      {items.length === 0 ? (
        <p className="p-4 text-[12.5px] text-ink-3">None recorded.</p>
      ) : (
        <ul className="max-h-[300px] divide-y divide-[rgb(var(--line)/0.08)] overflow-y-auto">
          {items.map((i) => {
            const changed = i.was !== undefined && i.was !== i.state
            return (
              <li key={i.id} className={cx('flex items-center justify-between gap-3 px-4 py-2 transition-colors duration-500', changed && 'bg-copper/[0.06]')}>
                <Link to={href(i.id)} className="min-w-0 truncate text-[12.5px] text-ink hover:text-copper-ink hover:underline">
                  {i.label}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  {changed ? <span className="font-mono text-[10px] text-copper-ink">was {i.was!.replace(/_/g, ' ')}</span> : null}
                  <LifecycleBadge state={i.state} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
