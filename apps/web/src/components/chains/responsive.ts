import { useEffect, useState } from 'react'
import type { Column } from '../../ui/data'

/**
 * DataTable hides a `hideBelow` column with `display: none`, but its grid
 * template still reserves that column's track, so the visible cells shift into
 * the wrong tracks and fixed-width tracks overflow at 375px. Until the shared
 * table handles it, pages drop hidden columns from the array themselves.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

const BREAKPOINT = { sm: 640, md: 768, lg: 1024 } as const

/** Returns only the columns that fit the current viewport, with `hideBelow` stripped. */
export function useResponsiveColumns<T>(columns: Column<T>[]): Column<T>[] {
  const sm = useMinWidth(BREAKPOINT.sm)
  const md = useMinWidth(BREAKPOINT.md)
  const lg = useMinWidth(BREAKPOINT.lg)
  return columns
    .filter((c) => (c.hideBelow === 'sm' ? sm : c.hideBelow === 'md' ? md : c.hideBelow === 'lg' ? lg : true))
    .map(({ hideBelow: _h, ...c }) => c)
}
