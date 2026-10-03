import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeftRight, GitCompare } from 'lucide-react'
import { api } from '../lib/api'
import { wsKey } from '../lib/queries'
import { hhmm, plural } from '../lib/format'
import type { ChainRow, DiffEntry } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Panel, Select } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../ui/feedback'
import { ScopeChips } from '../ui/scope'
import { DecisionBadge, HealthBadge } from '../ui/status'

/**
 * Chain diff: two reconstructed chains compared hop by hop by the engine
 * (GET /api/diff). The page picks the pair and groups the engine's entries;
 * it does not compare anything itself.
 */

const CATEGORY: { id: DiffEntry['category']; label: string }[] = [
  { id: 'root_changed', label: 'Root principal' },
  { id: 'hop_added', label: 'Delegation hops added' },
  { id: 'hop_removed', label: 'Delegation hops removed' },
  { id: 'identity_changed', label: 'Delegator or delegatee changed' },
  { id: 'authority_added', label: 'Authority added' },
  { id: 'authority_removed', label: 'Authority removed' },
  { id: 'policy_changed', label: 'Policy or policy version changed' },
  { id: 'execution_identity_changed', label: 'Execution identity changed' },
  { id: 'credential_changed', label: 'Credential changed' },
  { id: 'tool_changed', label: 'Tool changed' },
  { id: 'resource_changed', label: 'Resource changed' },
]

const SIG: Record<DiffEntry['significance'], { glyph: string; label: string; cls: string; row: string }> = {
  expansion: { glyph: '+', label: 'Expansion', cls: 'text-crimson-ink border-crimson/50 bg-crimson/12', row: 'border-l-crimson/70' },
  contraction: { glyph: '−', label: 'Contraction', cls: 'text-sage-ink border-sage/45 bg-sage/10', row: 'border-l-sage/70' },
  change: { glyph: '~', label: 'Change', cls: 'text-ink-2 border-[rgb(var(--line-strong)/0.2)] bg-s2', row: 'border-l-[rgb(var(--line-strong)/0.25)]' },
}

interface DiffResponse {
  left: ChainRow
  right: ChainRow
  entries: DiffEntry[]
}

/** A meaningful default: a verified chain and a violated chain sharing a root principal. */
function suggestPair(rows: ChainRow[]): [string, string] | null {
  const ok = rows.filter((r) => r.health === 'verified')
  const bad = rows.filter((r) => r.health === 'violated')
  let best: [ChainRow, ChainRow, number] | null = null
  for (const b of bad) {
    for (const g of ok) {
      if (!g.root_principal_id || g.root_principal_id !== b.root_principal_id) continue
      const score = 1 + (g.actor_principal_id === b.actor_principal_id ? 2 : 0) + (g.tool_id === b.tool_id ? 1 : 0) + (g.resource_id === b.resource_id ? 1 : 0)
      if (!best || score > best[2]) best = [g, b, score]
    }
  }
  if (best) return [best[0].event_id, best[1].event_id]
  if (ok[0] && bad[0]) return [ok[0].event_id, bad[0].event_id]
  const other = rows.find((r) => r.health !== 'verified')
  if (ok[0] && other) return [ok[0].event_id, other.event_id]
  if (rows.length >= 2) return [rows[0]!.event_id, rows[1]!.event_id]
  return null
}

const glyph = (h: ChainRow['health']) => (h === 'verified' ? '✓' : h === 'violated' ? '✕' : h === 'incomplete' ? '!' : '?')

export default function ChainDiff() {
  const [params, setParams] = useSearchParams()
  const left = params.get('left')
  const right = params.get('right')
  const chains = useQuery({ queryKey: wsKey('chains', { limit: 500 }), queryFn: () => api.get<{ total: number; rows: ChainRow[] }>('/api/chains?limit=500') })
  const rows = useMemo(() => [...(chains.data?.rows ?? [])].sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '') || a.event_id.localeCompare(b.event_id)), [chains.data])
  const suggested = useMemo(() => suggestPair(rows), [rows])

  useEffect(() => {
    if ((!left || !right) && suggested) {
      const next = new URLSearchParams(params)
      if (!left) next.set('left', suggested[0])
      if (!right) next.set('right', suggested[1])
      setParams(next, { replace: true })
    }
  }, [left, right, suggested, params, setParams])

  const diff = useQuery({
    queryKey: wsKey('diff', left, right),
    queryFn: () => api.get<DiffResponse>(`/api/diff?left=${encodeURIComponent(left!)}&right=${encodeURIComponent(right!)}`),
    enabled: !!left && !!right,
  })

  const set = (key: 'left' | 'right', v: string) => {
    const next = new URLSearchParams(params)
    next.set(key, v)
    setParams(next)
  }
  const swap = () => {
    if (!left || !right) return
    const next = new URLSearchParams(params)
    next.set('left', right)
    next.set('right', left)
    setParams(next)
  }

  const header = <PageHeader eyebrow="Analyze · Chain diff" title="Chain diff" description="Compare a production chain with the chain you expect, hop by hop. The engine aligns hops from the root and reports every place authority, identity, credential, policy or target differs." />

  if (chains.isLoading) return (
    <div>
      {header}
      <LoadingState label="Loading chains" />
    </div>
  )
  if (chains.isError) return (
    <div>
      {header}
      <ErrorState error={chains.error} retry={() => chains.refetch()} />
    </div>
  )
  if (rows.length < 2)
    return (
      <div>
        {header}
        <EmptyState icon={<GitCompare size={22} aria-hidden />} title="Not enough chains to compare" body="The active dataset needs at least two actions. Load the complex multi-agent scenario or import more events." action={<LinkButton to="/app/scenarios">Open the scenario lab</LinkButton>} />
      </div>
    )

  const label = (r: ChainRow) => `${glyph(r.health)} ${r.event_id} · ${r.path.map((p) => p.name).join(' → ') || r.actor_name || 'no chain'}${r.tool_name ? ` → ${r.tool_name}` : ''}`
  const isSuggested = suggested && left === suggested[0] && right === suggested[1]

  return (
    <div>
      {header}
      <Panel id="diff-pick" bodyClassName="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
          <Select label="Expected chain (left)" value={left ?? ''} onChange={(e) => set('left', e.target.value)}>
            {rows.map((r) => (
              <option key={r.action_id} value={r.event_id}>
                {label(r)}
              </option>
            ))}
          </Select>
          <Button variant="ghost" onClick={swap} icon={<ArrowLeftRight size={14} aria-hidden />} aria-label="Swap left and right" className="md:mb-0">
            Swap
          </Button>
          <Select label="Production chain (right)" value={right ?? ''} onChange={(e) => set('right', e.target.value)}>
            {rows.map((r) => (
              <option key={r.action_id} value={r.event_id}>
                {label(r)}
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-3">
          {isSuggested ? 'Suggested pair: a verified chain and a violated chain from the same root principal. ' : ''}
          Options are marked ✓ verified, ✕ violated, ! incomplete, ? unknown.
          {suggested && !isSuggested ? (
            <button type="button" className="ml-1 text-copper-ink hover:underline" onClick={() => setParams(new URLSearchParams({ left: suggested[0], right: suggested[1] }))}>
              Use the suggested pair
            </button>
          ) : null}
        </p>
      </Panel>

      {!left || !right ? null : diff.isLoading ? (
        <LoadingState label="Comparing chains" />
      ) : diff.isError ? (
        <ErrorState error={diff.error} retry={() => diff.refetch()} />
      ) : diff.data ? (
        <DiffView d={diff.data} same={left === right} />
      ) : null}
    </div>
  )
}

function DiffView({ d, same }: { d: DiffResponse; same: boolean }) {
  const counts = { expansion: 0, contraction: 0, change: 0 }
  d.entries.forEach((e) => counts[e.significance]++)
  const groups = CATEGORY.map((c) => ({ ...c, entries: d.entries.filter((e) => e.category === c.id) })).filter((g) => g.entries.length > 0)
  return (
    <div className="mt-4 space-y-4 anim-fade-up">
      <div className="grid gap-3 md:grid-cols-2">
        <ChainCard side="Expected · left" row={d.left} />
        <ChainCard side="Production · right" row={d.right} />
      </div>

      <section aria-labelledby="diff-entries" className="panel">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b hairline px-4 py-3">
          <h2 id="diff-entries" className="text-[13.5px] font-medium text-ink">
            {d.entries.length === 0 ? 'No differences' : plural(d.entries.length, 'difference')}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {(['expansion', 'contraction', 'change'] as const).map((s) => (
              <span key={s} className={cx('inline-flex h-[20px] items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[10.5px] tracking-[0.06em]', SIG[s].cls)}>
                <span aria-hidden>{SIG[s].glyph}</span>
                {counts[s]} {SIG[s].label.toLowerCase()}
                {counts[s] === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        </header>
        {d.entries.length === 0 ? (
          <EmptyState
            title={same ? 'The same action is on both sides' : 'The two chains are structurally identical'}
            body={same ? 'Choose a different chain on one side to compare.' : 'Same root, same hops and grants, same execution identity, credential, tool, resource and policy.'}
          />
        ) : (
          <div className="divide-y divide-[rgb(var(--line)/0.08)]">
            {groups.map((g) => (
              <div key={g.id} className="px-4 py-3">
                <h3 className="eyebrow mb-2">{g.label}</h3>
                <ul className="space-y-1.5">
                  {g.entries.map((e, i) => {
                    const s = SIG[e.significance]
                    return (
                      <li key={i} className={cx('grid gap-x-3 gap-y-1 border-l-2 py-1 pl-3 md:grid-cols-[110px_minmax(0,1fr)_20px_minmax(0,1fr)_auto] md:items-center', s.row)}>
                        <span className="font-mono text-[11px] text-ink-3">{e.position}</span>
                        <span className="font-mono text-[12px] text-ink-2 [overflow-wrap:anywhere]">{e.left}</span>
                        <span className="hidden text-center text-ink-3 md:block" aria-hidden>
                          →
                        </span>
                        <span className={cx('font-mono text-[12px] [overflow-wrap:anywhere]', e.significance === 'expansion' ? 'text-crimson-ink' : e.significance === 'contraction' ? 'text-sage-ink' : 'text-ink')}>
                          <span className="sr-only">changes to </span>
                          {e.right}
                        </span>
                        <span className={cx('inline-flex h-[20px] w-max items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[10px] tracking-[0.06em]', s.cls)}>
                          <span aria-hidden>{s.glyph}</span>
                          {s.label}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="text-[11.5px] leading-relaxed text-ink-3">Hops are aligned by position from the root. Expansion means the right-hand chain carries authority or hops the left does not; contraction means it carries less. Every entry is the engine's.</p>
    </div>
  )
}

function ChainCard({ side, row }: { side: string; row: ChainRow }) {
  return (
    <article className="panel p-4" aria-label={`${side}: ${row.event_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow mb-0.5">{side}</div>
          <Link to={`/app/chains/${encodeURIComponent(row.event_id)}`} className="id hover:text-copper-ink">
            {row.event_id}
          </Link>
          <span className="ml-2 font-mono text-[10.5px] text-ink-3">{hhmm(row.timestamp)} UTC</span>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge health={row.health} />
          <DecisionBadge decision={row.derived_decision} recorded={row.recorded_decision} />
        </div>
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px]" aria-label="Delegation chain">
        {row.path.length === 0 ? (
          <li className="text-fog-ink">No root principal · {row.actor_name ?? 'unknown actor'}</li>
        ) : (
          row.path.map((p, i) => (
            <li key={`${p.id}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span className="text-ink-3" aria-hidden>
                  →
                </span>
              ) : null}
              <span className={i === row.path.length - 1 ? 'font-medium text-ink' : 'text-ink'} title={p.id}>
                {p.name}
              </span>
            </li>
          ))
        )}
        {row.tool_name ? (
          <li className="flex items-center gap-1.5 text-ink-2">
            <span className="text-ink-3" aria-hidden>
              →
            </span>
            {row.tool_name}
          </li>
        ) : null}
        {row.resource_name ? (
          <li className="flex items-center gap-1.5 text-ink-2">
            <span className="text-ink-3" aria-hidden>
              →
            </span>
            {row.resource_name}
          </li>
        ) : null}
      </ol>
      <dl className="mt-3 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t hairline pt-3 text-[12px]">
        <dt className="text-ink-3">Effective</dt>
        <dd>
          <ScopeChips scope={row.effective_scope} />
        </dd>
        <dt className="text-ink-3">Exercised</dt>
        <dd>
          <ScopeChips scope={row.exercised_scope} />
        </dd>
        <dt className="text-ink-3">Findings</dt>
        <dd className="text-ink-2">{row.finding_count === 0 ? 'none' : <Badge tone="neutral">{row.finding_count}</Badge>}</dd>
      </dl>
    </article>
  )
}
