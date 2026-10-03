import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx, IconButton } from './primitives'

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  // Callers pass inline closures; keep the latest one without re-running the trap.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const focusables = () => [...(node?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])]
    setTimeout(() => (focusables()[0] ?? node)?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      }
      if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]!
        const last = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [open])
  return ref
}

export function Drawer({ open, onClose, title, eyebrow, children, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; width?: number }) {
  const ref = useFocusTrap(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'} tabIndex={-1} className="absolute bottom-0 right-0 top-0 flex w-full flex-col border-l hairline-strong bg-s1 shadow-lift outline-none" style={{ maxWidth: width, animation: 'rg-fade-up 260ms cubic-bezier(0.22,1,0.36,1)' }}>
        <header className="flex items-start justify-between gap-3 border-b hairline px-5 py-4">
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
            <h2 className="text-[15px] font-medium text-ink [overflow-wrap:anywhere]">{title}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Modal({ open, onClose, title, children, className, labelledBy }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; className?: string; labelledBy?: string }) {
  const ref = useFocusTrap(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : typeof title === 'string' ? title : 'Dialog'} tabIndex={-1} className={cx('panel-raised relative w-full max-w-lg outline-none anim-fade-up', className)}>
        {title ? <h2 className="border-b hairline px-5 py-3.5 text-[14px] font-medium">{title}</h2> : null}
        {children}
      </div>
    </div>,
    document.body,
  )
}
