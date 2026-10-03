import { forwardRef, useId, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from 'react'
import { Link } from 'react-router'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-copper text-[rgb(var(--canvas))] hover:bg-copper-ink border-transparent font-medium',
  secondary: 'bg-s2 text-ink border-[rgb(var(--line-strong)/0.16)] hover:bg-s3 hover:border-[rgb(var(--line-strong)/0.26)]',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-s2 hover:text-ink',
  danger: 'bg-crimson/15 text-crimson-ink border-crimson/40 hover:bg-crimson/25',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  shortcut?: string
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, shortcut, loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded border transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        VARIANT[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden /> : icon}
      {children}
      {shortcut ? <Kbd className="ml-1 opacity-70 group-hover:opacity-100">{shortcut}</Kbd> : null}
    </button>
  )
})

export function LinkButton({ to, variant = 'secondary', size = 'md', icon, children, className }: { to: string; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded border transition-colors duration-150', size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]', VARIANT[variant], className)}>
      {icon}
      {children}
    </Link>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx('inline-flex h-8 w-8 items-center justify-center rounded text-ink-2 transition-colors hover:bg-s2 hover:text-ink disabled:opacity-40', className)} {...rest}>
      {children}
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] border border-[rgb(var(--line-strong)/0.18)] bg-s3 px-1 font-mono text-[10px] text-ink-2', className)}>{children}</kbd>
}

export function Badge({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: 'neutral' | 'copper' | 'crimson' | 'sage' | 'amber' | 'fog'; className?: string; title?: string }) {
  const tones = {
    neutral: 'border-[rgb(var(--line-strong)/0.16)] text-ink-2 bg-s2',
    copper: 'border-copper/40 text-copper-ink bg-copper/10',
    crimson: 'border-crimson/45 text-crimson-ink bg-crimson/12',
    sage: 'border-sage/45 text-sage-ink bg-sage/10',
    amber: 'border-amber/45 text-amber-ink bg-amber/10',
    fog: 'border-fog/45 text-fog-ink bg-fog/10',
  }
  return (
    <span title={title} className={cx('inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Panel({ title, eyebrow, actions, children, className, bodyClassName, id }: { title?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section className={cx('panel min-w-0', className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title || actions || eyebrow ? (
        <header className="flex min-h-[44px] items-center justify-between gap-3 border-b hairline px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-0.5">{eyebrow}</div> : null}
            {title ? <h2 id={id ? `${id}-title` : undefined} className="truncate text-[13px] font-medium text-ink">{title}</h2> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('min-w-0', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  )
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, className, label }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-0.5 overflow-x-auto border-b hairline', className)}>
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === value)
              if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length]!.id)
              if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id)
            }}
            className={cx('relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 px-3 text-[12.5px] transition-colors', active ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
          >
            {t.label}
            {t.count !== undefined ? <span className="tnum font-mono text-[10.5px] text-ink-3">{t.count}</span> : null}
            <span className={cx('absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-copper transition-transform duration-200 ease-out', active ? 'scale-x-100' : 'scale-x-0')} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

export function Select({ label, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="eyebrow">{label}</span>
      <select id={id} className="h-8 min-w-0 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2 text-[12.5px] text-ink outline-none transition-colors hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper" {...rest}>
        {children}
      </select>
    </label>
  )
}

export function TextInput({ label, className, hideLabel, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className={hideLabel ? 'sr-only' : 'eyebrow'}>{label}</span>
      <input id={id} className="h-8 min-w-0 rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-4 transition-colors hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper" {...rest} />
    </label>
  )
}

export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className={cx('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      {open ? (
        <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[280px] -translate-x-1/2 rounded border border-[rgb(var(--line-strong)/0.18)] bg-s3 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-2 shadow-lift anim-fade-up">
          {content}
        </span>
      ) : null}
    </span>
  )
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx('border-0 border-t hairline', className)} />
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 gap-y-2 text-[12.5px]', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
