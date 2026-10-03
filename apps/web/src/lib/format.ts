/** 2026-10-03T13:30:00.000Z -> 13:30 */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(11, 16)
}

/** 2026-10-03 13:30 UTC */
export function stamp(iso: string | null | undefined, seconds = false): string {
  if (!iso) return '—'
  return `${iso.slice(0, 10)} ${iso.slice(11, seconds ? 19 : 16)} UTC`
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function scopeText(s: readonly string[] | null | undefined): string {
  if (s === null || s === undefined) return 'unknown'
  if (s.length === 0) return 'none'
  return s.join(', ')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100)
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export const FINDING_LABEL: Record<string, string> = {
  AUTHORITY_AMPLIFICATION: 'Authority amplification',
  SCOPE_VIOLATION: 'Scope violation',
  UNATTRIBUTABLE_ACTION: 'Unattributable action',
  BROKEN_DELEGATION_CHAIN: 'Broken delegation chain',
  ORPHANED_PRINCIPAL: 'Orphaned principal',
  MISSING_DELEGATED_SCOPE: 'Missing granted scope',
  MISSING_REQUESTED_SCOPE: 'Missing requested scope',
  MISSING_POLICY_VERSION: 'Missing policy version',
  CREDENTIAL_BINDING_MISMATCH: 'Credential binding mismatch',
  EXECUTION_IDENTITY_MISMATCH: 'Execution identity mismatch',
  STALE_DELEGATION: 'Stale delegation',
  REVOKED_IDENTITY: 'Identity not valid at action time',
  REVOKED_CREDENTIAL: 'Credential not valid at action time',
  MISSING_APPROVAL: 'Missing approval',
  ACTION_TIME_AUTHORIZATION_FAILURE: 'Action-time authorization failure',
  UNKNOWN_REFERENCE: 'Unknown identity or reference',
}

export const ROLE_RANK = { viewer: 0, auditor: 1, analyst: 2, admin: 3 } as const
