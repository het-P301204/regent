import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, FlaskConical, Hammer, Import, Moon, Play, RotateCcw, FileText, BookOpen, Search } from 'lucide-react'
import { api } from '../lib/api'
import { toggleTheme } from '../lib/prefs'
import { Modal } from '../ui/overlay'
import { cx, Kbd } from '../ui/primitives'
import { ALL_NAV } from './nav'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon?: React.ReactNode
  run: () => void
}

function score(q: string, text: string): number {
  const t = text.toLowerCase()
  const s = q.toLowerCase()
  if (!s) return 1
  if (t.startsWith(s)) return 3
  if (t.includes(s)) return 2
  let i = 0
  for (const ch of t) if (ch === s[i]) i++
  return i === s.length ? 1 : 0
}

export function CommandPalette({ open, onClose, onRunVerification }: { open: boolean; onClose: () => void; onRunVerification: () => void }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 140)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (open) {
      setQ('')
      setCursor(0)
    }
  }, [open])
  const search = useQuery({
    queryKey: ['ws', 'search', debounced],
    queryFn: () => api.get<{ results: { kind: string; id: string; label: string; sublabel: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.trim().length >= 2,
  })
  const go = (to: string) => () => {
    onClose()
    nav(to)
  }
  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'run', group: 'Actions', label: 'Run verification', hint: 'R', icon: <Play size={14} />, run: () => (onClose(), onRunVerification()) },
      { id: 'import', group: 'Actions', label: 'Import events', icon: <Import size={14} />, run: go('/app/import') },
      { id: 'builder', group: 'Actions', label: 'Create delegation in the chain builder', icon: <Hammer size={14} />, run: go('/app/builder') },
      { id: 'scenario', group: 'Actions', label: 'Run a scenario', icon: <FlaskConical size={14} />, run: go('/app/scenarios') },
      { id: 'reports', group: 'Actions', label: 'Open reports', icon: <FileText size={14} />, run: go('/app/reports') },
      { id: 'docs', group: 'Actions', label: 'Open documentation', icon: <BookOpen size={14} />, run: go('/docs') },
      { id: 'reset', group: 'Actions', label: 'Reset to demo environment', icon: <RotateCcw size={14} />, run: async () => (onClose(), await api.post('/api/datasets/reset-demo'), window.location.assign('/app')) },
      { id: 'theme', group: 'Actions', label: 'Toggle theme', icon: <Moon size={14} />, run: () => (toggleTheme(), onClose()) },
    ]
    const pages: Item[] = ALL_NAV.map((n) => ({ id: `nav-${n.to}`, group: 'Go to', label: n.label, hint: n.chord ? `G ${n.chord.toUpperCase()}` : undefined, run: go(n.to), icon: <n.icon size={14} /> }))
    const local = [...actions, ...pages]
      .map((it) => ({ it, s: Math.max(score(q, it.label), score(q, ALL_NAV.find((n) => `nav-${n.to}` === it.id)?.keywords ?? '') * 0.8) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it)
    const remote: Item[] = (search.data?.results ?? []).map((r) => ({ id: `r-${r.kind}-${r.id}`, group: `Search · ${r.kind}`, label: r.label, hint: r.sublabel, icon: <Search size={14} />, run: go(r.href) }))
    return q.trim() ? [...remote, ...local] : local
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, search.data])
  useEffect(() => setCursor(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  let lastGroup = ''
  return (
    <Modal open={open} onClose={onClose} className="max-w-xl" labelledBy="cmdk-label">
      <div className="flex items-center gap-2 border-b hairline px-4">
        <Search size={15} className="text-ink-3" aria-hidden />
        <label id="cmdk-label" htmlFor="cmdk-input" className="sr-only">
          Search chains, agents, findings, or run a command
        </label>
        <input
          id="cmdk-input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chains, agents, findings, credentials… or type a command"
          className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[cursor] ? `cmdk-${items[cursor]!.id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, items.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              items[cursor]?.run()
            }
          }}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul id="cmdk-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-2">
        {items.length === 0 ? <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">{search.isFetching ? 'Searching…' : 'No matches.'}</li> : null}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null
          lastGroup = it.group
          return (
            <li key={it.id} role="presentation">
              {header ? <div className="eyebrow px-4 pb-1 pt-2.5">{header}</div> : null}
              <div
                id={`cmdk-${it.id}`}
                role="option"
                aria-selected={i === cursor}
                data-active={i === cursor}
                onMouseMove={() => setCursor(i)}
                onClick={() => it.run()}
                className={cx('mx-2 flex cursor-pointer items-center gap-3 rounded px-2.5 py-2 text-[13px]', i === cursor ? 'bg-s3 text-ink' : 'text-ink-2')}
              >
                <span className="text-ink-3">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint ? <span className="max-w-[40%] truncate font-mono text-[10.5px] text-ink-3">{it.hint}</span> : null}
                {i === cursor ? <CornerDownLeft size={12} className="text-ink-3" aria-hidden /> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
