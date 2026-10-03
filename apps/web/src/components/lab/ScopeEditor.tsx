import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { cx } from '../../ui/primitives'

/**
 * Permission syntax, for input feedback only: `segment.segment(.segment)*`,
 * each segment `[a-z][a-z0-9_-]*`, optionally ending in `.*`. A permission that
 * does not parse is still accepted: the engine keeps it as an opaque literal
 * that covers only itself. The editor says so rather than refusing it.
 */
const SEGMENT = /^[a-z][a-z0-9_-]{0,63}$/
export function permissionSyntaxOk(p: string): boolean {
  if (p.length === 0 || p.length > 160) return false
  const parts = p.split('.')
  if (parts.length < 2) return false
  const named = parts[parts.length - 1] === '*' ? parts.slice(0, -1) : parts
  return named.length > 0 && named.every((s) => SEGMENT.test(s))
}

/**
 * Scope chips with add and remove. `nullable` adds a "not recorded" switch,
 * because an unrecorded scope (null) is a different claim from an empty one.
 */
export function ScopeEditor({ label, value, onChange, nullable = false, help, suggestions = [] }: { label: string; value: string[] | null; onChange: (v: string[] | null) => void; nullable?: boolean; help?: string; suggestions?: string[] }) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const unknown = value === null
  const add = (raw: string) => {
    const p = raw.trim()
    if (!p) return
    if ((value ?? []).includes(p)) {
      setNote(`${p} is already in this scope.`)
      return
    }
    if ((value ?? []).length >= 64) {
      setNote('A scope holds at most 64 permissions.')
      return
    }
    setNote(permissionSyntaxOk(p) ? null : `"${p}" is not segment.segment syntax. The engine keeps it as an opaque literal that covers only itself.`)
    onChange([...(value ?? []), p])
    setDraft('')
  }
  const remaining = suggestions.filter((s) => !(value ?? []).includes(s))
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow mb-1.5 flex w-full items-center justify-between gap-2">
        <span>{label}</span>
        {nullable ? (
          <label className="flex cursor-pointer items-center gap-1.5 font-sans text-[11px] normal-case tracking-normal text-ink-3">
            <input type="checkbox" className="accent-[rgb(var(--copper))]" checked={unknown} onChange={(e) => onChange(e.target.checked ? null : [])} />
            Not recorded
          </label>
        ) : null}
      </legend>
      {unknown ? (
        <p className="rounded border border-dashed border-fog/45 px-2 py-1.5 font-mono text-[11.5px] italic text-fog-ink">unknown — not recorded in evidence</p>
      ) : (
        <>
          <ul className="flex min-h-[26px] flex-wrap gap-1" aria-label={`${label} permissions`}>
            {(value ?? []).length === 0 ? <li className="font-mono text-[11.5px] text-ink-3">empty scope</li> : null}
            {(value ?? []).map((p) => {
              const ok = permissionSyntaxOk(p)
              return (
                <li key={p} className={cx('scope-chip pr-0.5', ok ? 'border-[rgb(var(--line-strong)/0.18)] bg-s2 text-ink' : 'border-dashed border-amber/60 text-amber-ink')} title={ok ? undefined : 'Opaque literal: covers only itself'}>
                  {ok ? null : <span aria-hidden>!</span>}
                  {p}
                  <button type="button" onClick={() => onChange((value ?? []).filter((x) => x !== p))} className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-ink-3 hover:bg-s3 hover:text-ink" aria-label={`Remove ${p} from ${label}`}>
                    <X size={10} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-1.5 flex gap-1.5">
            <label htmlFor={id} className="sr-only">
              Add permission to {label}
            </label>
            <input
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  add(draft)
                }
              }}
              placeholder="customer.read"
              spellCheck={false}
              autoCapitalize="off"
              className={cx('h-7 min-w-0 flex-1 rounded border bg-s2 px-2 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-4 focus-visible:border-copper', draft && !permissionSyntaxOk(draft.trim()) ? 'border-amber/60' : 'border-[rgb(var(--line-strong)/0.16)]')}
              aria-describedby={`${id}-note`}
            />
            <button type="button" onClick={() => add(draft)} className="h-7 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2 text-[12px] text-ink hover:bg-s3 disabled:opacity-45" disabled={!draft.trim()}>
              Add
            </button>
          </div>
          {remaining.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-ink-3">Quick add:</span>
              {remaining.slice(0, 6).map((s) => (
                <button key={s} type="button" onClick={() => add(s)} className="rounded-[3px] border border-dashed border-[rgb(var(--line-strong)/0.2)] px-1.5 font-mono text-[10.5px] text-ink-3 hover:border-copper/50 hover:text-ink">
                  + {s}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      <p id={`${id}-note`} className={cx('mt-1 text-[11px] leading-snug', note ? 'text-amber-ink' : 'text-ink-3')} aria-live="polite">
        {note ?? help ?? null}
      </p>
    </fieldset>
  )
}
