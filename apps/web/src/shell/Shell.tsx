import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, LogOut, Menu, Moon, Play, Search, Sun, X } from 'lucide-react'
import { Wordmark } from '../brand/Logo'
import { api } from '../lib/api'
import { useTheme, useReducedMotion, onboardingSeen } from '../lib/prefs'
import { useActivateDataset, useActiveDataset, useResetDemo, useRunVerification } from '../lib/queries'
import { useSession } from '../lib/session'
import { Button, cx, IconButton, Kbd } from '../ui/primitives'
import { SourceTag } from '../ui/status'
import { useToast } from '../ui/feedback'
import { Modal } from '../ui/overlay'
import { VerificationSequence } from '../viz/VerificationSequence'
import { CommandPalette } from './CommandPalette'
import { Onboarding } from './Onboarding'
import { NAV, ALL_NAV } from './nav'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export function Shell() {
  const { session, can } = useSession()
  const nav = useNavigate()
  const loc = useLocation()
  const reduced = useReducedMotion()
  const toast = useToast()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [onboarding, setOnboarding] = useState(() => !onboardingSeen())
  const run = useRunVerification()
  const [verifyState, setVerifyState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const chord = useRef<number | null>(null)

  const runVerification = useCallback(() => {
    if (!can('analyst')) {
      toast({ title: 'Verification needs the analyst role', body: 'Viewers and auditors can read results but cannot start a run.', tone: 'error' })
      return
    }
    setVerifyState('running')
    run.mutate(undefined, {
      onSuccess: (r) => {
        setVerifyState('done')
        toast({ title: 'Verification complete', body: `${r.summary.total_actions} actions · ${r.summary.authority_violations} authority violations · digest ${r.input_digest.slice(7, 19)}…`, tone: 'success' })
        setTimeout(() => setVerifyState('idle'), 2600)
      },
      onError: (e) => {
        setVerifyState('failed')
        toast({ title: 'Verification failed', body: (e as Error).message, tone: 'error' })
        setTimeout(() => setVerifyState('idle'), 4000)
      },
    })
  }, [can, run, toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || paletteOpen) return
      const k = e.key.toLowerCase()
      if (chord.current !== null) {
        window.clearTimeout(chord.current)
        chord.current = null
        const target = ALL_NAV.find((n) => n.chord === k)
        if (target) {
          e.preventDefault()
          nav(target.to)
        }
        return
      }
      if (k === 'g') {
        chord.current = window.setTimeout(() => (chord.current = null), 1100)
        return
      }
      if (k === 'r') {
              e.preventDefault()
              runVerification()
            }
      if (k === 'e') {
              e.preventDefault()
              nav('/app/reports')
            }
      if (k === '/') {
              e.preventDefault()
              setPaletteOpen(true)
            }
      if (e.key === '?') {
              e.preventDefault()
              setHelpOpen(true)
            }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, paletteOpen, runVerification])

  useEffect(() => setMobileNav(false), [loc.pathname])

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-copper focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <Sidebar className="hidden lg:flex" />
      {mobileNav ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNav(false)} aria-hidden />
          <Sidebar className="relative flex w-[260px] anim-fade-up" onClose={() => setMobileNav(false)} />
        </div>
      ) : null}
      <div className="lg:pl-[232px]">
        <TopBar onMenu={() => setMobileNav(true)} onPalette={() => setPaletteOpen(true)} onRun={runVerification} verifyState={verifyState} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 outline-none sm:px-6 lg:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={loc.pathname} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onRunVerification={runVerification} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {onboarding && session?.authenticated ? <Onboarding onClose={() => setOnboarding(false)} /> : null}
    </div>
  )
}

function Sidebar({ className, onClose }: { className?: string; onClose?: () => void }) {
  return (
    <aside className={cx('fixed inset-y-0 left-0 z-40 w-[232px] flex-col border-r hairline bg-s1', className)} aria-label="Primary">
      <div className="flex h-14 items-center justify-between border-b hairline px-4">
        <Link to="/app" aria-label="REGENT home">
          <Wordmark />
        </Link>
        {onClose ? (
          <IconButton label="Close navigation" onClick={onClose}>
            <X size={16} />
          </IconButton>
        ) : null}
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-4">
            <div className="eyebrow px-2 pb-1.5">{g.group}</div>
            <ul>
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === '/app'}
                    className={({ isActive }) =>
                      cx('group relative flex h-8 items-center gap-2.5 rounded px-2 text-[13px] transition-colors', isActive ? 'bg-s3 text-ink' : 'text-ink-2 hover:bg-s2 hover:text-ink')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={cx('absolute left-0 top-1.5 h-5 w-[2px] rounded-full bg-copper transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden />
                        <span className={isActive ? 'text-copper-ink' : 'text-ink-3 group-hover:text-ink-2'}>
                          <it.icon size={15} />
                        </span>
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.chord ? <span className="hidden font-mono text-[9.5px] text-ink-4 group-hover:inline">G {it.chord.toUpperCase()}</span> : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t hairline px-4 py-3 font-mono text-[10px] leading-relaxed text-ink-4">
        Verdicts are computed by the server-side engine. This console only displays them.
      </div>
    </aside>
  )
}

function TopBar({ onMenu, onPalette, onRun, verifyState }: { onMenu: () => void; onPalette: () => void; onRun: () => void; verifyState: 'idle' | 'running' | 'done' | 'failed' }) {
  const { session, can } = useSession()
  const [theme, setTheme] = useTheme()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b hairline bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <IconButton label="Open navigation" className="lg:hidden" onClick={onMenu}>
          <Menu size={17} />
        </IconButton>
        <DatasetSwitcher />
        <div className="flex-1" />
        {verifyState !== 'idle' ? <VerificationSequence className="hidden xl:flex" running={verifyState === 'running'} done={verifyState === 'done'} failed={verifyState === 'failed'} /> : null}
        <button onClick={onPalette} className="hidden h-8 w-[260px] items-center gap-2 rounded border border-[rgb(var(--line-strong)/0.14)] bg-s1 px-2.5 text-left text-[12.5px] text-ink-3 transition-colors hover:border-[rgb(var(--line-strong)/0.26)] hover:text-ink-2 md:flex" aria-label="Search and commands">
          <Search size={14} />
          <span className="flex-1">Search or jump to…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <IconButton label="Search" className="md:hidden" onClick={onPalette}>
          <Search size={16} />
        </IconButton>
        {can('analyst') ? (
          <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={onRun} loading={verifyState === 'running'} shortcut="R" className="hidden sm:inline-flex">
            Run verification
          </Button>
        ) : null}
        <IconButton label="Exports and reports (E)" className="hidden sm:inline-flex" onClick={() => nav('/app/reports')}>
          <Download size={16} />
        </IconButton>
        <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex h-8 items-center gap-2 rounded px-1.5 hover:bg-s2" aria-haspopup="menu" aria-expanded={menu}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-s3 font-mono text-[10px] text-ink-2">{session?.user?.display_name?.split(' ').map((s) => s[0]).join('').slice(0, 2) ?? '?'}</span>
            <span className="hidden text-left leading-tight xl:block">
              <span className="block text-[12px] text-ink">{session?.user?.display_name}</span>
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{session?.user?.role}</span>
            </span>
            <ChevronDown size={13} className="text-ink-3" />
          </button>
          {menu ? (
            <div role="menu" className="panel-raised absolute right-0 top-10 w-60 p-1.5 anim-fade-up" onMouseLeave={() => setMenu(false)}>
              <div className="px-2.5 py-2">
                <div className="text-[12.5px] text-ink">{session?.user?.email}</div>
                <div className="text-[11.5px] text-ink-3">
                  {session?.organization?.name} · {session?.user?.role}
                  {session?.user?.is_demo_persona ? ' · demo persona' : ''}
                </div>
              </div>
              <button
                role="menuitem"
                onClick={async () => {
                  await api.post('/api/auth/logout')
                  qc.clear()
                  window.location.assign('/signin')
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-s3 hover:text-ink"
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function DatasetSwitcher() {
  const { data, active } = useActiveDataset()
  const activate = useActivateDataset()
  const reset = useResetDemo()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 min-w-0 max-w-[52vw] items-center gap-2 rounded px-2 hover:bg-s2 sm:max-w-[420px]" aria-haspopup="listbox" aria-expanded={open} aria-label="Active dataset">
        {active ? <SourceTag source={active.source} /> : null}
        <span className="truncate text-[13px] text-ink">{active?.name ?? 'No dataset'}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-3" />
      </button>
      {open ? (
        <div className="panel-raised absolute left-0 top-11 z-40 w-[min(440px,90vw)] p-1.5 anim-fade-up" role="listbox" aria-label="Datasets">
          <div className="eyebrow px-2.5 pb-1.5 pt-1">Datasets are kept separate. Imported data is never mixed with the demo.</div>
          <div className="max-h-[320px] overflow-y-auto">
            {data?.datasets.map((d) => (
              <button
                key={d.id}
                role="option"
                aria-selected={d.id === active?.id}
                onClick={() => {
                  activate.mutate(d.id)
                  setOpen(false)
                }}
                className={cx('flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left hover:bg-s3', d.id === active?.id && 'bg-s3')}
              >
                <SourceTag source={d.source} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{d.name}</span>
                  <span className="block font-mono text-[10.5px] text-ink-3">
                    {d.records_accepted} records · {d.created_at.slice(0, 16).replace('T', ' ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {active?.source !== 'demo' ? (
            <button onClick={() => (reset.mutate(), setOpen(false))} className="mt-1 w-full rounded border-t hairline px-2.5 py-2 text-left text-[12px] text-copper-ink hover:bg-s3">
              Reset to demo environment
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl/⌘ K', 'Command palette and search'],
    ['/', 'Search'],
    ['R', 'Run verification'],
    ['E', 'Exports and reports'],
    ['?', 'This list'],
    ...ALL_NAV.filter((n) => n.chord).map((n) => [`G then ${n.chord!.toUpperCase()}`, n.label] as [string, string]),
  ]
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-5 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <Kbd>{k}</Kbd>
            </dt>
            <dd className="text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}
