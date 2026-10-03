/**
 * The REGENT seal. The R is a delegation path: authority enters at the root
 * node, descends the stem, and leaves through the leg to a single copper
 * terminal, the point of action. Ring = the boundary of granted authority.
 */
export function Mark({ size = 28, ring = true, className = '' }: { size?: number; ring?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      {ring ? (
        <>
          <circle cx="32" cy="32" r="29" fill="none" stroke="rgb(var(--copper))" strokeWidth="1.6" />
          <circle cx="32" cy="32" r="25" fill="none" stroke="rgb(var(--copper))" strokeWidth="0.8" strokeDasharray="1.5 3" opacity="0.8" />
        </>
      ) : null}
      <g fill="none" stroke="rgb(var(--ink))" strokeWidth={ring ? 2.8 : 5} strokeLinecap="round" strokeLinejoin="round">
        {ring ? <path d="M25 46V18h9a7 7 0 0 1 0 14h-9" /> : <path d="M21 50V14h12.5a9 9 0 0 1 0 18H21" />}
        {ring ? <path d="M34 32l8.5 14" /> : <path d="M33 32l11 18" />}
      </g>
      {ring ? (
        <>
          <circle cx="25" cy="18" r="3" fill="rgb(var(--ink))" />
          <circle cx="25" cy="32" r="2.2" fill="rgb(var(--ink))" />
          <circle cx="42.5" cy="46" r="3.3" fill="rgb(var(--copper))" />
        </>
      ) : (
        <>
          <circle cx="21" cy="14" r="5" fill="rgb(var(--ink))" />
          <circle cx="44" cy="50" r="5.5" fill="rgb(var(--copper))" />
        </>
      )}
    </svg>
  )
}

export function Wordmark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={compact ? 22 : 28} />
      <span className="flex flex-col leading-none">
        <span className="font-sans text-[13px] font-semibold tracking-[0.32em] text-ink">REGENT</span>
        {compact ? null : <span className="mt-1 font-mono text-[9.5px] tracking-[0.08em] text-ink-3">Authority, traced.</span>}
      </span>
    </span>
  )
}

/** Loading mark: the path draws itself, root to terminal, then holds. */
export function LoadingMark({ size = 40, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="29" fill="none" stroke="rgb(var(--copper) / 0.35)" strokeWidth="1.6" />
        <path d="M25 46V18h9a7 7 0 0 1 0 14h-9 M34 32l8.5 14" fill="none" stroke="rgb(var(--ink))" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="120" strokeDashoffset="120" style={{ animation: 'rg-dash 1.4s cubic-bezier(0.22,1,0.36,1) infinite alternate' }} />
        <circle cx="42.5" cy="46" r="3.3" fill="rgb(var(--copper))" className="anim-blink" />
      </svg>
      <span className="eyebrow">{label}</span>
    </span>
  )
}
