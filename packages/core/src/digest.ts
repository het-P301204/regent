import { createHash } from 'node:crypto'
import { compareStrings } from './scope.ts'

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, `undefined`
 * dropped. Two records with the same content always serialize identically,
 * which is what makes digests and finding ids reproducible.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value).sort(compareStrings)) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortValue(v)
    }
    return out
  }
  return value
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Content digest of a normalized record, shown as evidence. A digest, not a signature. */
export function digestOf(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`
}

export function shortHash(text: string, length = 10): string {
  return sha256(text).slice(0, length)
}
