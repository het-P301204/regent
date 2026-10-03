/**
 * Engine performance check on hostile-but-valid input sizes.
 *   node scripts/bench.ts
 */
import { analyze, demoRecords } from '../packages/core/src/index.ts'

function time<T>(label: string, fn: () => T): T {
  const t = performance.now()
  const r = fn()
  console.log(`${label.padEnd(52)} ${Math.round(performance.now() - t)} ms`)
  return r
}

// 1. Many actions by one unregistered actor: every finding is shared across all of them.
const orphan = Array.from({ length: 15_000 }, (_, i) => ({ event_id: `e${i}`, actor_principal_id: 'agent-x', timestamp: '2026-10-03T10:00:00Z', exercised_scope: ['a.b'] }))
time('15k actions, one unregistered actor', () => analyze(orphan))

// 2. 50k records: the demo dataset's registry plus many actions.
const base = demoRecords()
const actions = base.filter((r) => r.record_type === 'action')
const rest = base.filter((r) => r.record_type !== 'action')
const big = [...rest, ...Array.from({ length: 49_800 }, (_, i) => ({ ...actions[i % actions.length], event_id: `evt-b${i}` }))]
time('~50k records (demo registry, 49.8k actions)', () => analyze(big))

// 3. Deep chains with wide wildcard scopes.
const deep: Record<string, unknown>[] = [{ record_type: 'principal', principal_id: 'h', principal_type: 'human', provisioned_scope: Array.from({ length: 256 }, (_, i) => `s${i}.*`) }]
for (let i = 0; i < 31; i++) deep.push({ record_type: 'principal', principal_id: `a${i}`, principal_type: 'agent' })
deep.push({ record_type: 'delegation', delegation_id: 'd0', delegator_principal_id: 'h', delegatee_principal_id: 'a0', granted_scope: Array.from({ length: 256 }, (_, i) => `s${i}.*`) })
for (let i = 1; i < 31; i++) deep.push({ record_type: 'delegation', delegation_id: `d${i}`, parent_delegation_id: `d${i - 1}`, delegator_principal_id: `a${i - 1}`, delegatee_principal_id: `a${i}`, granted_scope: Array.from({ length: 256 }, (_, k) => `s${k}.*`) })
for (let i = 0; i < 8000; i++) deep.push({ record_type: 'action', event_id: `x${i}`, actor_principal_id: 'a30', delegation_id: 'd30', timestamp: '2026-10-03T10:00:00Z', exercised_scope: Array.from({ length: 64 }, (_, k) => `s${k}.r`), requested_scope: ['s1.r'] })
time('8k actions on a 31-hop chain, 256-entry wildcard scopes', () => analyze(deep))
