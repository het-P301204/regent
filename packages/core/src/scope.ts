import type { Permission, Scope } from './types.ts'

/**
 * Scope algebra.
 *
 * A permission is `segment(.segment)+`, each segment `[a-z][a-z0-9_-]*`, with an
 * optional trailing wildcard segment: `customer.*` covers `customer.read`,
 * `customer.pii.read` and `customer.pii.*`. A wildcard is only ever trailing.
 *
 * Anything that does not parse is kept as an OPAQUE literal: it covers only
 * itself and is covered only by itself. Dropping it would be the unsafe choice:
 * an unparseable permission in an exercised scope would vanish from the check
 * and the action would look contained.
 */

const SEGMENT = /^[a-z][a-z0-9_-]{0,63}$/
const MAX_PERMISSION_LENGTH = 160

export interface ParsedPermission {
  raw: string
  valid: boolean
  segments: string[]
  wildcard: boolean
}

const parseCache = new Map<string, ParsedPermission>()

/** Memoized: scope checks call this inside nested loops. Bounded so hostile input cannot grow it without limit. */
export function parsePermission(raw: string): ParsedPermission {
  const hit = parseCache.get(raw)
  if (hit) return hit
  const parsed = parsePermissionUncached(raw)
  if (parseCache.size > 20_000) parseCache.clear()
  parseCache.set(raw, parsed)
  return parsed
}

function parsePermissionUncached(raw: string): ParsedPermission {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PERMISSION_LENGTH) {
    return { raw: String(raw), valid: false, segments: [], wildcard: false }
  }
  const parts = raw.split('.')
  if (parts.length < 2) return { raw, valid: false, segments: [], wildcard: false }
  const wildcard = parts[parts.length - 1] === '*'
  const named = wildcard ? parts.slice(0, -1) : parts
  if (named.length === 0) return { raw, valid: false, segments: [], wildcard: false }
  for (const seg of named) {
    if (!SEGMENT.test(seg)) return { raw, valid: false, segments: [], wildcard: false }
  }
  return { raw, valid: true, segments: named, wildcard }
}

export function isValidPermission(raw: string): boolean {
  return parsePermission(raw).valid
}

/** Does holding `granter` include holding `p`? */
export function covers(granter: Permission, p: Permission): boolean {
  if (granter === p) return true
  const g = parsePermission(granter)
  if (!g.valid || !g.wildcard) return false
  const q = parsePermission(p)
  if (!q.valid) return false
  // `a.b.*` covers anything strictly beneath a.b: a.b.c, a.b.c.d, a.b.c.*
  if (q.segments.length <= g.segments.length) {
    // a.* does not cover `a` (not a permission) and a.b.* does not cover a.* (broader)
    return false
  }
  for (let i = 0; i < g.segments.length; i++) {
    if (g.segments[i] !== q.segments[i]) return false
  }
  return true
}

export function isCovered(p: Permission, by: Scope): boolean {
  for (const g of by) if (covers(g, p)) return true
  return false
}

/** Sort and de-duplicate. Recorded scopes are only ever canonicalized this way. */
export function canonical(scope: Iterable<Permission>): Permission[] {
  return [...new Set(scope)].sort(compareStrings)
}

/** Canonical and minimal: drop entries already covered by another entry. Used for computed scopes. */
export function minimal(scope: Iterable<Permission>): Permission[] {
  const list = canonical(scope)
  return list.filter((p) => !list.some((q) => q !== p && covers(q, p)))
}

/** A ⊆ B under the covering relation. */
export function isSubset(a: Scope, b: Scope): boolean {
  return a.every((p) => isCovered(p, b))
}

/** Members of A not covered by B. */
export function excess(a: Scope, b: Scope): Permission[] {
  return canonical(a.filter((p) => !isCovered(p, b)))
}

/**
 * Greatest lower bound of two scopes: everything both of them convey.
 * {customer.*} ∧ {customer.read, invoice.read} = {customer.read}
 */
export function intersect(a: Scope, b: Scope): Permission[] {
  const out: Permission[] = []
  for (const p of a) if (isCovered(p, b)) out.push(p)
  for (const q of b) if (isCovered(q, a)) out.push(q)
  return minimal(out)
}

export function union(a: Scope, b: Scope): Permission[] {
  return canonical([...a, ...b])
}

export function sameScope(a: Scope, b: Scope): boolean {
  return isSubset(a, b) && isSubset(b, a)
}

export function invalidPermissions(scope: Scope): Permission[] {
  return scope.filter((p) => !isValidPermission(p))
}

/** Code-point order, independent of locale, so output is byte-identical across machines. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function formatScope(scope: Scope | null): string {
  if (scope === null) return 'unknown'
  if (scope.length === 0) return '(empty)'
  return scope.join(', ')
}
