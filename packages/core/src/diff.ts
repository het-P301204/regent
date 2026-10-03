import { excess, formatScope } from './scope.ts'
import type { ActionVerification, EvidenceBundle } from './types.ts'

/**
 * Chain diff: compare two reconstructed chains hop by hop, e.g. a production
 * chain against the chain a policy says should exist. Hops are aligned by
 * position from the root.
 */

export type DiffCategory =
  | 'authority_added'
  | 'authority_removed'
  | 'identity_changed'
  | 'credential_changed'
  | 'execution_identity_changed'
  | 'policy_changed'
  | 'resource_changed'
  | 'tool_changed'
  | 'hop_added'
  | 'hop_removed'
  | 'root_changed'

export interface DiffEntry {
  category: DiffCategory
  position: string
  left: string
  right: string
  significance: 'expansion' | 'contraction' | 'change'
}

export interface ChainSide {
  bundle: EvidenceBundle
  verification: ActionVerification
}

export function diffChains(left: ChainSide, right: ChainSide): DiffEntry[] {
  const out: DiffEntry[] = []
  const ln = nameMap(left.bundle)
  const rn = nameMap(right.bundle)
  const L = left.verification
  const R = right.verification
  const la = left.bundle.actions.find((a) => a.action_id === L.action_id)!
  const ra = right.bundle.actions.find((a) => a.action_id === R.action_id)!

  if ((L.chain.root_principal_id ?? '') !== (R.chain.root_principal_id ?? '')) {
    out.push({ category: 'root_changed', position: 'root', left: ln(L.chain.root_principal_id), right: rn(R.chain.root_principal_id), significance: 'change' })
  }
  const n = Math.max(L.chain.hops.length, R.chain.hops.length)
  for (let i = 0; i < n; i++) {
    const lh = L.chain.hops[i]
    const rh = R.chain.hops[i]
    const pos = `hop ${i + 1}`
    if (!lh && rh) {
      out.push({ category: 'hop_added', position: pos, left: '—', right: `${rn(rh.delegator_principal_id)} → ${rn(rh.delegatee_principal_id)} {${formatScope(rh.granted_scope)}}`, significance: 'expansion' })
      continue
    }
    if (lh && !rh) {
      out.push({ category: 'hop_removed', position: pos, left: `${ln(lh.delegator_principal_id)} → ${ln(lh.delegatee_principal_id)} {${formatScope(lh.granted_scope)}}`, right: '—', significance: 'contraction' })
      continue
    }
    if (!lh || !rh) continue
    if (lh.delegatee_principal_id !== rh.delegatee_principal_id || lh.delegator_principal_id !== rh.delegator_principal_id) {
      out.push({ category: 'identity_changed', position: pos, left: `${ln(lh.delegator_principal_id)} → ${ln(lh.delegatee_principal_id)}`, right: `${rn(rh.delegator_principal_id)} → ${rn(rh.delegatee_principal_id)}`, significance: 'change' })
    }
    const lg = lh.granted_scope ?? []
    const rg = rh.granted_scope ?? []
    const added = excess(rg, lg)
    const removed = excess(lg, rg)
    if (added.length) out.push({ category: 'authority_added', position: `${pos} granted`, left: formatScope(lg), right: `+ ${formatScope(added)}`, significance: 'expansion' })
    if (removed.length) out.push({ category: 'authority_removed', position: `${pos} granted`, left: `− ${formatScope(removed)}`, right: formatScope(rg), significance: 'contraction' })
    if (`${lh.policy_id}@${lh.policy_version}` !== `${rh.policy_id}@${rh.policy_version}`) {
      out.push({ category: 'policy_changed', position: pos, left: `${lh.policy_id ?? '—'} v${lh.policy_version ?? '?'}`, right: `${rh.policy_id ?? '—'} v${rh.policy_version ?? '?'}`, significance: 'change' })
    }
  }
  const le = la.exercised_scope ?? []
  const re = ra.exercised_scope ?? []
  const exAdded = excess(re, le)
  const exRemoved = excess(le, re)
  if (exAdded.length) out.push({ category: 'authority_added', position: 'exercised', left: formatScope(le), right: `+ ${formatScope(exAdded)}`, significance: 'expansion' })
  if (exRemoved.length) out.push({ category: 'authority_removed', position: 'exercised', left: `− ${formatScope(exRemoved)}`, right: formatScope(re), significance: 'contraction' })
  if (la.execution_identity_id !== ra.execution_identity_id) out.push({ category: 'execution_identity_changed', position: 'execution', left: la.execution_identity_id ?? '—', right: ra.execution_identity_id ?? '—', significance: 'change' })
  if (la.credential_id !== ra.credential_id) out.push({ category: 'credential_changed', position: 'execution', left: la.credential_id ?? '—', right: ra.credential_id ?? '—', significance: 'change' })
  if (la.tool_id !== ra.tool_id) out.push({ category: 'tool_changed', position: 'execution', left: la.tool_id ?? '—', right: ra.tool_id ?? '—', significance: 'change' })
  if (la.resource_id !== ra.resource_id) out.push({ category: 'resource_changed', position: 'execution', left: la.resource_id ?? '—', right: ra.resource_id ?? '—', significance: 'change' })
  if (`${la.policy_id}@${la.policy_version}` !== `${ra.policy_id}@${ra.policy_version}`) {
    out.push({ category: 'policy_changed', position: 'decision', left: `${la.policy_id ?? '—'} v${la.policy_version ?? '?'}`, right: `${ra.policy_id ?? '—'} v${ra.policy_version ?? '?'}`, significance: 'change' })
  }
  return out
}

function nameMap(b: EvidenceBundle): (id: string | null) => string {
  const m = new Map(b.principals.map((p) => [p.principal_id, p.display_name]))
  return (id) => (id ? (m.get(id) ?? id) : '—')
}
