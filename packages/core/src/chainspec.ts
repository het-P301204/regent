import { z } from 'zod'
import { EvidenceBuilder } from './builder.ts'
import type { RawRecord } from './builder.ts'

/**
 * ChainSpec: a compact, hand-writable description of one synthetic delegation
 * chain. The Chain Builder produces it from the canvas and `regent verify
 * chain.json` reads it. It is converted into ordinary evidence records, so a
 * built chain is verified by exactly the same engine path as an import.
 *
 * Time is synthetic and deterministic: delegations are issued one minute apart
 * from 09:00, actions run from 09:30.
 */

const scope = z.array(z.string().max(160)).max(32)
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,95}$/, 'ids may contain letters, digits and . _ : @ -')

export const ChainSpecSchema = z.object({
  name: z.string().max(120).optional(),
  principals: z.array(z.object({
    id,
    type: z.enum(['human', 'agent', 'sub_agent']),
    name: z.string().min(1).max(80),
    /** For a human: the authority it holds. Ignored for agents (they hold only what is delegated). */
    scope: scope.optional(),
    revoked: z.boolean().optional(),
  })).min(1).max(24),
  delegations: z.array(z.object({
    from: id,
    to: id,
    granted: scope.nullable(),
    expired: z.boolean().optional(),
    revoked: z.boolean().optional(),
    approval: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'UNKNOWN']).optional(),
    policy_version: z.string().max(32).nullable().optional(),
    /** Record the parent delegation reference. Default true; false exercises registry lookup. */
    cite_parent: z.boolean().optional(),
  })).max(40),
  actions: z.array(z.object({
    actor: id,
    tool: z.string().min(1).max(80),
    resource: z.string().min(1).max(80),
    operation: z.string().max(40).optional(),
    requested: scope.nullable(),
    exercised: scope.nullable(),
    execution_identity: z.object({ id, bound_to: id.nullable(), standing_scope: scope.optional(), revoked: z.boolean().optional() }).optional(),
    credential: z.object({ id, bound_to_execution_identity: id.nullable().optional(), revoked: z.boolean().optional() }).optional(),
    approval: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'UNKNOWN']).optional(),
    requires_approval: scope.optional(),
    policy_version: z.string().max(32).nullable().optional(),
    cite_delegation: z.boolean().optional(),
    decision_cached_before_revocation: z.boolean().optional(),
  })).max(20),
})
export type ChainSpec = z.infer<typeof ChainSpecSchema>

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'

export function chainSpecToRecords(spec: ChainSpec): RawRecord[] {
  const b = new EvidenceBuilder()
  const t = (minutes: number) => new Date(Date.UTC(2026, 9, 3, 9, 0) + minutes * 60_000).toISOString()
  const actionStart = 30
  const revokeAt = t(actionStart - 5)
  for (const p of spec.principals) {
    if (p.type === 'human') b.human(p.id, p.name, p.scope ?? [], p.revoked ? { revoked: revokeAt } : {})
    else b.agent(p.id, p.name, p.type, p.revoked ? { revoked: revokeAt } : {})
  }
  const approvalScopes = [...new Set(spec.actions.flatMap((a) => a.requires_approval ?? []))]
  b.policy('pol-builder-delegation', '1', 'Builder delegation policy')
  b.policy('pol-builder-runtime', '1', 'Builder runtime policy', { approval: approvalScopes })

  const delegationIds: string[] = []
  const inbound = new Map<string, string>()
  const rootOf = new Map<string, string>()
  for (const p of spec.principals) if (p.type === 'human') rootOf.set(p.id, p.id)
  spec.delegations.forEach((d, i) => {
    const did = `del-${String(i + 1).padStart(2, '0')}-${slug(d.from)}-${slug(d.to)}`.slice(0, 120)
    delegationIds.push(did)
    const parent = d.cite_parent === false ? null : (inbound.get(d.from) ?? null)
    b.delegate({
      id: did,
      from: d.from,
      to: d.to,
      parent,
      granted: d.granted,
      at: t(i),
      expires: d.expired ? t(actionStart - 10) : t(8 * 60),
      revoked: d.revoked ? revokeAt : null,
      approval: d.approval ?? 'APPROVED',
      policy: 'pol-builder-delegation',
      version: d.policy_version === undefined ? '1' : d.policy_version,
      event: `evt-${did}`,
    })
    if (!inbound.has(d.to)) inbound.set(d.to, did)
    if (!rootOf.has(d.to) && rootOf.has(d.from)) rootOf.set(d.to, rootOf.get(d.from)!)
  })

  const tools = new Set<string>()
  const resources = new Set<string>()
  spec.actions.forEach((a, i) => {
    const toolId = `tool-${slug(a.tool)}`
    const resId = `res-${slug(a.resource)}`
    if (!tools.has(toolId)) { b.tool(toolId, a.tool); tools.add(toolId) }
    if (!resources.has(resId)) { b.resource(resId, a.resource); resources.add(resId) }
    const execId = a.execution_identity?.id ?? `wl-${slug(a.actor)}-${i + 1}`
    const boundTo = a.execution_identity ? a.execution_identity.bound_to : a.actor
    b.workload(execId, boundTo, { provisioned: a.execution_identity?.standing_scope ?? [], ...(a.execution_identity?.revoked ? { revoked: revokeAt } : {}) })
    const credId = a.credential?.id ?? `cred-${slug(execId)}`
    const credBinding = a.credential?.bound_to_execution_identity === undefined ? execId : a.credential.bound_to_execution_identity
    b.credential(credId, credBinding, { issued: t(0), expires: t(12 * 60), ...(a.credential?.revoked ? { revoked: revokeAt } : {}) })
    const at = t(actionStart + i)
    b.act({
      event: `evt-builder-${String(i + 1).padStart(2, '0')}`,
      actor: a.actor,
      root: rootOf.get(a.actor) ?? null,
      delegation: a.cite_delegation === false ? null : (inbound.get(a.actor) ?? null),
      at,
      tool: toolId,
      resource: resId,
      operation: a.operation ?? 'invoke',
      exec: execId,
      credential: credId,
      requested: a.requested,
      exercised: a.exercised,
      policy: 'pol-builder-runtime',
      version: a.policy_version === undefined ? '1' : a.policy_version,
      approval: a.approval ?? 'NOT_REQUIRED',
      evaluatedAt: a.decision_cached_before_revocation ? t(1) : at,
    })
  })
  return b.build()
}
