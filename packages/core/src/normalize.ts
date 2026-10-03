import { BundleKeys, ID_PATTERN, MAX_PARAMETERS_BYTES, MAX_RECORDS, RecordInput } from './schemas.ts'
import type { RecordInputT } from './schemas.ts'
import { canonical, compareStrings, invalidPermissions } from './scope.ts'
import { canonicalJson } from './digest.ts'
import { sanitizeDeep } from './text.ts'
import type {
  Action,
  AuthorizationPolicy,
  Credential,
  Delegation,
  EvidenceBundle,
  ExecutionIdentity,
  LifecycleStatus,
  Principal,
  Resource,
  Scope,
  Tool,
} from './types.ts'

export type IssueSeverity = 'error' | 'warning'

export interface IngestIssue {
  severity: IssueSeverity
  code:
    | 'PARSE_ERROR'
    | 'SCHEMA_ERROR'
    | 'INVALID_ID'
    | 'DUPLICATE_CONFLICT'
    | 'DUPLICATE_IDENTICAL'
    | 'INVALID_TIMESTAMP'
    | 'INVALID_SCOPE_SYNTAX'
    | 'TOO_MANY_RECORDS'
    | 'PARAMETERS_TOO_LARGE'
    | 'IGNORED_FIELD'
    | 'ALIAS_APPLIED'
    | 'UNKNOWN_REVOCATION_TARGET'
    | 'TIMESTAMP_ORDER'
    | 'TEXT_SANITIZED'
  message: string
  record_index: number | null
  record_type: string | null
  record_id: string | null
  field: string | null
}

export interface NormalizeResult {
  bundle: EvidenceBundle
  issues: IngestIssue[]
  stats: {
    records_read: number
    records_accepted: number
    records_rejected: number
    by_type: Record<string, number>
  }
}

/**
 * Parse text as JSON (a bundle object, a single record, or an array of records)
 * or as JSONL (one record per line). Never evaluates anything.
 */
export function parseEvidenceText(text: string): { records: unknown[]; issues: IngestIssue[] } {
  const trimmed = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim()
  if (trimmed.length === 0) return { records: [], issues: [] }
  try {
    return { records: flattenInput(JSON.parse(trimmed) as unknown), issues: [] }
  } catch {
    // fall through to JSONL
  }
  const records: unknown[] = []
  const issues: IngestIssue[] = []
  const lines = trimmed.split(/\r?\n/)
  lines.forEach((line, i) => {
    const l = line.trim()
    if (l.length === 0) return
    try {
      records.push(...flattenInput(JSON.parse(l) as unknown))
    } catch {
      issues.push(issue('error', 'PARSE_ERROR', `Line ${i + 1} is not valid JSON.`, i, null, null, null))
    }
  })
  return { records, issues }
}

/** Accepts a bundle `{ principals: [...], events: [...] }`, an array, or one record. */
export function flattenInput(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (input !== null && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj['record_type'] === 'string' || typeof obj['event_id'] === 'string') return [obj]
    const out: unknown[] = []
    // A wrapper such as { description, records: [...] } carries typed records as-is.
    const wrapped = Object.prototype.hasOwnProperty.call(obj, 'records') ? obj['records'] : undefined
    if (Array.isArray(wrapped)) out.push(...wrapped)
    for (const [key, kind] of Object.entries(BundleKeys)) {
      const list = Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
      if (!Array.isArray(list)) continue
      for (const rec of list) {
        if (rec !== null && typeof rec === 'object' && !Array.isArray(rec)) {
          const r = rec as Record<string, unknown>
          out.push(typeof r['record_type'] === 'string' ? r : { ...r, record_type: kind })
        } else {
          out.push(rec)
        }
      }
    }
    return out
  }
  return [input]
}

export function normalizeText(text: string): NormalizeResult {
  const parsed = parseEvidenceText(text)
  const result = normalizeRecords(parsed.records)
  result.issues.unshift(...parsed.issues)
  result.stats.records_rejected += parsed.issues.length
  result.stats.records_read += parsed.issues.length
  return result
}

export function normalizeRecords(rawRecords: unknown[]): NormalizeResult {
  const issues: IngestIssue[] = []
  const stats = { records_read: rawRecords.length, records_accepted: 0, records_rejected: 0, by_type: {} as Record<string, number> }

  let records = rawRecords
  if (records.length > MAX_RECORDS) {
    issues.push(issue('error', 'TOO_MANY_RECORDS', `Input has ${records.length} records; the limit is ${MAX_RECORDS}. Records beyond the limit were not read.`, null, null, null, null))
    stats.records_rejected += records.length - MAX_RECORDS
    records = records.slice(0, MAX_RECORDS)
  }

  const principals = new Map<string, Principal>()
  const execIds = new Map<string, ExecutionIdentity>()
  const credentials = new Map<string, Credential>()
  const tools = new Map<string, Tool>()
  const resources = new Map<string, Resource>()
  const policies = new Map<string, AuthorizationPolicy>()
  const delegations = new Map<string, Delegation>()
  const actions = new Map<string, Action>()
  const revocations: { target_type: string; target_id: string; timestamp: string; index: number }[] = []
  const seenCanonical = new Map<string, string>()

  records.forEach((rawInput, index) => {
    // Strip control and bidi characters from every string before anything reads it.
    const cleaned = sanitizeDeep(rawInput)
    if (cleaned.changed) issues.push(issue('warning', 'TEXT_SANITIZED', 'Control or bidirectional-override characters were removed from this record.', index, recordTypeOf(cleaned.value), recordIdOf(cleaned.value), null))
    const raw = nullInvalidReferences(cleaned.value, issues, index)
    const withType = inferRecordType(raw)
    const parsed = RecordInput.safeParse(withType)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first?.path.join('.') ?? ''
      issues.push(issue('error', 'SCHEMA_ERROR', `Record rejected: ${path ? `${path}: ` : ''}${first?.message ?? 'invalid record'}.`, index, recordTypeOf(withType), recordIdOf(withType), path || null))
      stats.records_rejected++
      return
    }
    const rec = parsed.data
    const rid = primaryId(rec)
    if (!ID_PATTERN.test(rid) || (rec.record_type === 'action' && !ID_PATTERN.test(rec.event_id))) {
      issues.push(issue('error', 'INVALID_ID', `Identifier "${truncate(rid)}" contains characters outside the allowed set.`, index, rec.record_type, rid, null))
      stats.records_rejected++
      return
    }

    // Duplicate detection: identical duplicates are collapsed, conflicting ones are flagged
    // and the FIRST occurrence is kept. A conflicting duplicate is a tampering signal.
    const key = rec.record_type === 'policy' ? `policy:${policyKey(rid, rec.policy_version)}` : `${rec.record_type}:${rid}`
    const canon = canonicalJson(rec)
    const prior = seenCanonical.get(key)
    if (prior !== undefined && rec.record_type !== 'revocation') {
      if (prior === canon) {
        issues.push(issue('warning', 'DUPLICATE_IDENTICAL', `Duplicate ${rec.record_type} "${rid}" with identical content was collapsed.`, index, rec.record_type, rid, null))
      } else {
        issues.push(issue('error', 'DUPLICATE_CONFLICT', `A second ${rec.record_type} "${rid}" has different content. The first occurrence was kept; the conflict itself is evidence of tampering or a broken exporter.`, index, rec.record_type, rid, null))
        stats.records_rejected++
      }
      return
    }
    seenCanonical.set(key, canon)
    stats.records_accepted++
    stats.by_type[rec.record_type] = (stats.by_type[rec.record_type] ?? 0) + 1

    const ctx: Ctx = { issues, index, type: rec.record_type, id: rid }
    switch (rec.record_type) {
      case 'principal':
        principals.set(rid, {
          principal_id: rid,
          principal_type: rec.principal_type,
          display_name: rec.display_name ?? rid,
          issuer: rec.issuer ?? null,
          provisioned_scope: scopeOf(rec.provisioned_scope, ctx, 'provisioned_scope'),
          root_eligible: rec.root_eligible ?? rec.principal_type === 'human',
          created_at: ts(rec.created_at, ctx, 'created_at'),
          suspended_at: ts(rec.suspended_at, ctx, 'suspended_at'),
          revoked_at: ts(rec.revoked_at, ctx, 'revoked_at'),
          expires_at: ts(rec.expires_at, ctx, 'expires_at'),
          recorded_status: (rec.status ?? 'UNKNOWN') as LifecycleStatus,
          event_id: rec.event_id ?? null,
        })
        break
      case 'execution_identity':
        execIds.set(rid, {
          execution_identity_id: rid,
          kind: rec.kind ?? 'workload',
          bound_principal_id: rec.bound_principal_id ?? null,
          spiffe_id: rec.spiffe_id ?? null,
          provisioned_scope: scopeOf(rec.provisioned_scope, ctx, 'provisioned_scope'),
          issued_at: ts(rec.issued_at, ctx, 'issued_at'),
          revoked_at: ts(rec.revoked_at, ctx, 'revoked_at'),
          expires_at: ts(rec.expires_at, ctx, 'expires_at'),
          recorded_status: (rec.status ?? 'UNKNOWN') as LifecycleStatus,
          event_id: rec.event_id ?? null,
        })
        break
      case 'credential':
        credentials.set(rid, {
          credential_id: rid,
          credential_type: rec.credential_type ?? 'other',
          execution_identity_id: rec.execution_identity_id ?? null,
          issued_at: ts(rec.issued_at, ctx, 'issued_at'),
          expires_at: ts(rec.expires_at, ctx, 'expires_at'),
          revoked_at: ts(rec.revoked_at, ctx, 'revoked_at'),
          recorded_status: (rec.status ?? 'UNKNOWN') as LifecycleStatus,
          event_id: rec.event_id ?? null,
        })
        break
      case 'tool':
        tools.set(rid, { tool_id: rid, display_name: rec.display_name ?? rid, kind: rec.kind ?? 'api', event_id: rec.event_id ?? null })
        break
      case 'resource':
        resources.set(rid, { resource_id: rid, display_name: rec.display_name ?? rid, kind: rec.kind ?? 'service', event_id: rec.event_id ?? null })
        break
      case 'policy':
        policies.set(policyKey(rid, rec.policy_version), {
          policy_id: rid,
          policy_version: rec.policy_version,
          display_name: rec.display_name ?? rid,
          scope_ceiling: scopeOf(rec.scope_ceiling, ctx, 'scope_ceiling'),
          approval_required_for: scopeOf(rec.approval_required_for, ctx, 'approval_required_for') ?? [],
          event_id: rec.event_id ?? null,
        })
        break
      case 'delegation': {
        let granted = rec.granted_scope
        if ((granted === undefined || granted === null) && rec.delegated_scope) {
          granted = rec.delegated_scope
          issues.push(issue('warning', 'ALIAS_APPLIED', 'Legacy field "delegated_scope" read as "granted_scope".', index, 'delegation', rid, 'delegated_scope'))
        }
        delegations.set(rid, {
          delegation_id: rid,
          parent_delegation_id: rec.parent_delegation_id ?? null,
          root_principal_id: rec.root_principal_id ?? null,
          delegator_principal_id: rec.delegator_principal_id ?? null,
          delegatee_principal_id: rec.delegatee_principal_id ?? null,
          granted_scope: scopeOf(granted, ctx, 'granted_scope'),
          requested_scope: scopeOf(rec.requested_scope, ctx, 'requested_scope'),
          restrictions: canonical(rec.restrictions ?? []),
          policy_id: rec.policy_id ?? null,
          policy_version: rec.policy_version ?? null,
          created_at: ts(rec.created_at, ctx, 'created_at'),
          expires_at: ts(rec.expires_at, ctx, 'expires_at'),
          revoked_at: ts(rec.revoked_at, ctx, 'revoked_at'),
          approval_state: rec.approval_state ?? 'UNKNOWN',
          recorded_status: (rec.status ?? 'UNKNOWN') as LifecycleStatus,
          event_id: rec.event_id ?? null,
        })
        break
      }
      case 'action': {
        const a = applyActionAliases(rec, ctx)
        actions.set(a.action_id, a)
        break
      }
      case 'revocation': {
        const t = ts(rec.timestamp, ctx, 'timestamp')
        if (t) revocations.push({ target_type: rec.target_type, target_id: rec.target_id, timestamp: t, index })
        break
      }
    }
  })

  // Apply revocation events: the earliest recorded revocation wins.
  for (const r of revocations) {
    const target =
      r.target_type === 'principal' ? principals.get(r.target_id)
      : r.target_type === 'execution_identity' ? execIds.get(r.target_id)
      : r.target_type === 'credential' ? credentials.get(r.target_id)
      : delegations.get(r.target_id)
    if (!target) {
      issues.push(issue('warning', 'UNKNOWN_REVOCATION_TARGET', `Revocation names ${r.target_type} "${r.target_id}", which is not in the evidence.`, r.index, 'revocation', r.target_id, 'target_id'))
      continue
    }
    if (target.revoked_at === null || r.timestamp < target.revoked_at) target.revoked_at = r.timestamp
  }

  // Internal timestamp ordering checks. They do not change data; they are reported.
  for (const d of delegations.values()) {
    if (d.created_at && d.expires_at && d.expires_at <= d.created_at) {
      issues.push(issue('warning', 'TIMESTAMP_ORDER', `Delegation "${d.delegation_id}" expires at or before it was created.`, null, 'delegation', d.delegation_id, 'expires_at'))
    }
    if (d.created_at && d.revoked_at && d.revoked_at < d.created_at) {
      issues.push(issue('warning', 'TIMESTAMP_ORDER', `Delegation "${d.delegation_id}" is revoked before it was created.`, null, 'delegation', d.delegation_id, 'revoked_at'))
    }
  }

  const byId = <T>(m: Map<string, T>, key: (t: T) => string) => [...m.values()].sort((a, b) => compareStrings(key(a), key(b)))
  const bundle: EvidenceBundle = {
    principals: byId(principals, (p) => p.principal_id),
    execution_identities: byId(execIds, (e) => e.execution_identity_id),
    credentials: byId(credentials, (c) => c.credential_id),
    tools: byId(tools, (t) => t.tool_id),
    resources: byId(resources, (r) => r.resource_id),
    policies: byId(policies, (p) => policyKey(p.policy_id, p.policy_version)),
    delegations: byId(delegations, (d) => d.delegation_id),
    actions: [...actions.values()].sort((a, b) => compareStrings(a.timestamp ?? '', b.timestamp ?? '') || compareStrings(a.action_id, b.action_id)),
  }
  return { bundle, issues, stats }
}

export function policyKey(id: string, version: string | null): string {
  return `${id}@${version ?? '?'}`
}

interface Ctx {
  issues: IngestIssue[]
  index: number
  type: string
  id: string
}

function applyActionAliases(rec: Extract<RecordInputT, { record_type: 'action' }>, ctx: Ctx): Action {
  const pick = <T>(canonicalName: string, canonicalValue: T | null | undefined, legacyName: string, legacyValue: T | null | undefined): T | null => {
    if (canonicalValue !== undefined && canonicalValue !== null) return canonicalValue
    if (legacyValue !== undefined && legacyValue !== null) {
      ctx.issues.push(issue('warning', 'ALIAS_APPLIED', `Legacy field "${legacyName}" read as "${canonicalName}".`, ctx.index, 'action', ctx.id, legacyName))
      return legacyValue
    }
    return null
  }
  if (rec.delegated_scope) {
    ctx.issues.push(issue('warning', 'IGNORED_FIELD', 'An action record cannot grant its own authority: "delegated_scope" on an action was ignored. Authority comes only from delegation records.', ctx.index, 'action', ctx.id, 'delegated_scope'))
  }
  let parameters = rec.parameters ?? null
  if (parameters && JSON.stringify(parameters).length > MAX_PARAMETERS_BYTES) {
    ctx.issues.push(issue('warning', 'PARAMETERS_TOO_LARGE', `Parameters exceed ${MAX_PARAMETERS_BYTES} bytes and were dropped.`, ctx.index, 'action', ctx.id, 'parameters'))
    parameters = null
  }
  const decision = rec.recorded_decision ?? rec.authorization_decision ?? pick('recorded_decision', null, 'decision', rec.decision)
  return {
    action_id: rec.action_id ?? rec.event_id,
    event_id: rec.event_id,
    timestamp: ts(rec.timestamp, ctx, 'timestamp'),
    root_principal_id: pick('root_principal_id', rec.root_principal_id, 'delegated_user', rec.delegated_user),
    actor_principal_id: pick('actor_principal_id', rec.actor_principal_id, 'agent_id', rec.agent_id),
    parent_principal_id: pick('parent_principal_id', rec.parent_principal_id, 'parent_agent', rec.parent_agent),
    delegation_id: rec.delegation_id ?? null,
    parent_event_id: rec.parent_event_id ?? null,
    execution_identity_id: rec.execution_identity_id ?? null,
    credential_id: rec.credential_id ?? null,
    tool_id: pick('tool_id', rec.tool_id, 'tool', rec.tool),
    resource_id: pick('resource_id', rec.resource_id, 'resource', rec.resource),
    operation: pick('operation', rec.operation, 'action', rec.action),
    parameters,
    requested_scope: scopeOf(rec.requested_scope, ctx, 'requested_scope'),
    exercised_scope: scopeOf(rec.exercised_scope, ctx, 'exercised_scope'),
    policy_id: rec.policy_id ?? null,
    policy_version: rec.policy_version ?? null,
    recorded_decision: decision ?? null,
    decision_reason: rec.decision_reason ?? null,
    authorization_evaluated_at: ts(rec.authorization_evaluated_at, ctx, 'authorization_evaluated_at'),
    approval_state: rec.approval_state ?? 'UNKNOWN',
    downstream_result: rec.downstream_result ?? null,
  }
}

function scopeOf(raw: readonly string[] | null | undefined, ctx: Ctx, field: string): Scope | null {
  if (raw === undefined || raw === null) return null
  const scope = canonical(raw)
  const bad = invalidPermissions(scope)
  if (bad.length > 0) {
    ctx.issues.push(issue('warning', 'INVALID_SCOPE_SYNTAX', `${field} contains ${bad.length === 1 ? 'a permission' : 'permissions'} that do not parse (${bad.map((b) => `"${truncate(b, 40)}"`).join(', ')}). Kept as opaque literals: each matches only itself.`, ctx.index, ctx.type, ctx.id, field))
  }
  return scope
}

/** ISO-8601 with an explicit offset, normalized to UTC milliseconds. Anything else is missing. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/
function ts(raw: string | null | undefined, ctx: Ctx, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const t = ISO.test(raw) ? Date.parse(raw) : Number.NaN
  if (Number.isNaN(t)) {
    ctx.issues.push(issue('warning', 'INVALID_TIMESTAMP', `${field} "${truncate(raw, 40)}" is not an ISO-8601 timestamp with a timezone; treated as missing.`, ctx.index, ctx.type, ctx.id, field))
    return null
  }
  return new Date(t).toISOString()
}

/** Reference fields (not the record's own id). An id outside the allowed alphabet cannot name anything registered. */
const REFERENCE_KEYS = new Set(['parent_delegation_id', 'root_principal_id', 'delegator_principal_id', 'delegatee_principal_id', 'actor_principal_id', 'parent_principal_id', 'delegation_id', 'parent_event_id', 'execution_identity_id', 'credential_id', 'tool_id', 'resource_id', 'policy_id', 'bound_principal_id', 'delegated_user', 'agent_id', 'parent_agent', 'tool', 'resource', 'target_id'])

function nullInvalidReferences(raw: unknown, issues: IngestIssue[], index: number): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = raw as Record<string, unknown>
  let out: Record<string, unknown> | null = null
  for (const key of REFERENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(r, key)) continue
    const v = r[key]
    if (key === 'target_id') continue // a revocation's own subject: checked as its primary id
    if (typeof v === 'string' && !ID_PATTERN.test(v)) {
      out ??= { ...r }
      out[key] = null
      issues.push(issue('warning', 'INVALID_ID', `${key} "${v.slice(0, 40)}" is not a valid identifier and was treated as not recorded.`, index, recordTypeOf(r), recordIdOf(r), key))
    }
  }
  return out ?? r
}

function inferRecordType(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = raw as Record<string, unknown>
  if (typeof r['record_type'] === 'string') return r
  // A bare event (the documented import example) is an action record.
  if (typeof r['event_id'] === 'string') return { ...r, record_type: 'action' }
  return r
}

function recordTypeOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null
  const t = (raw as Record<string, unknown>)['record_type']
  return typeof t === 'string' ? truncate(t, 32) : null
}

function recordIdOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  for (const k of ['event_id', 'delegation_id', 'principal_id', 'credential_id', 'execution_identity_id', 'tool_id', 'resource_id', 'policy_id', 'target_id']) {
    const v = r[k]
    if (typeof v === 'string') return truncate(v, 64)
  }
  return null
}

function primaryId(rec: RecordInputT): string {
  switch (rec.record_type) {
    case 'principal': return rec.principal_id
    case 'execution_identity': return rec.execution_identity_id
    case 'credential': return rec.credential_id
    case 'tool': return rec.tool_id
    case 'resource': return rec.resource_id
    case 'policy': return rec.policy_id
    case 'delegation': return rec.delegation_id
    case 'action': return rec.action_id ?? rec.event_id
    case 'revocation': return rec.target_id
  }
}

function issue(severity: IssueSeverity, code: IngestIssue['code'], message: string, record_index: number | null, record_type: string | null, record_id: string | null, field: string | null): IngestIssue {
  return { severity, code, message, record_index, record_type, record_id, field }
}

function truncate(s: string, n = 64): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
