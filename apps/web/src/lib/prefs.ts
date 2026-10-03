import { useEffect, useState } from 'react'

/** Per-browser conveniences only. Nothing security-relevant is stored client-side. */
type Theme = 'dark' | 'light'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: preference simply does not persist */
  }
}

export function initialTheme(): Theme {
  const saved = read('regent.theme')
  return saved === 'light' || saved === 'dark' ? saved : 'dark'
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset['theme'] = t
}

const listeners = new Set<(t: Theme) => void>()
let current: Theme = typeof document === 'undefined' ? 'dark' : initialTheme()

export function setTheme(t: Theme) {
  current = t
  write('regent.theme', t)
  applyTheme(t)
  listeners.forEach((l) => l(t))
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(current)
  useEffect(() => {
    listeners.add(setT)
    return () => {
      listeners.delete(setT)
    }
  }, [])
  return [t, setTheme]
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset['motion'] === 'reduced')
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(prefersReducedMotion())
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const on = () => setR(prefersReducedMotion())
    m?.addEventListener('change', on)
    // The in-app toggle sets data-motion on <html>; react to it without a remount.
    const mo = new MutationObserver(on)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
    return () => {
      m?.removeEventListener('change', on)
      mo.disconnect()
    }
  }, [])
  return r
}

export function onboardingSeen(): boolean {
  return read('regent.onboarded') === '1'
}
export function markOnboardingSeen() {
  write('regent.onboarded', '1')
}
