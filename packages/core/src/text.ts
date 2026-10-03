/**
 * Text hygiene for untrusted evidence. Imported strings end up in a terminal
 * (CLI), a PDF, a CSV and a browser, so they are cleaned once at ingestion:
 *   - C0 controls (except tab/newline/carriage return) and DEL, which include
 *     ESC: terminal escape sequences can clear the screen or forge output;
 *   - C1 controls (U+0080–U+009F), which some terminals also interpret;
 *   - bidirectional overrides and isolates, which can visually reorder text.
 */
export function stripBidi(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    const bidi = (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f || c === 0x061c
    const control = (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)
    if (!bidi && !control) out += ch
  }
  return out
}

/** Clean every string in a JSON-like value, to a bounded depth. Reports whether anything changed. */
export function sanitizeDeep(value: unknown, depth = 0): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const v = stripBidi(value)
    return { value: v, changed: v !== value }
  }
  if (depth > 6 || value === null || typeof value !== 'object') return { value, changed: false }
  let changed = false
  if (Array.isArray(value)) {
    const out = value.map((v) => {
      const r = sanitizeDeep(v, depth + 1)
      changed ||= r.changed
      return r.value
    })
    return { value: out, changed }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const key = stripBidi(k)
    const r = sanitizeDeep(v, depth + 1)
    changed ||= r.changed || key !== k
    // Own-property assignment via defineProperty: a "__proto__" key stays inert data.
    Object.defineProperty(out, key, { value: r.value, enumerable: true, writable: true, configurable: true })
  }
  return { value: out, changed }
}
