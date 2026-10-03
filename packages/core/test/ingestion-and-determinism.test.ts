import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyze,
  authorityAt,
  buildReplay,
  canonicalJson,
  csvCell,
  demoRecords,
  diffChains,
  evaluateControls,
  explainAction,
  findingsCsv,
  investigate,
  normalizeText,
  SCENARIOS,
  toFindingExports,
} from '../src/index.ts'
import { FindingExportSchema } from '../src/schemas.ts'

const ADV = join(import.meta.dirname, '..', '..', '..', 'tests', 'adversarial')

describe('adversarial datasets', () => {
  const files = readdirSync(ADV).filter((f) => f.endsWith('.json'))
  it('ships every dataset the threat model names', () => {
    for (const name of ['cycle', 'orphan-agent', 'privilege-amplification', 'credential-mismatch', 'missing-principal', 'missing-scope', 'stale-delegation', 'revoked-identity', 'duplicate-event', 'conflicting-policy']) {
      expect(files).toContain(`${name}.json`)
    }
  })
  it.each(files)('%s is classified exactly as documented', (file) => {
    const text = readFileSync(join(ADV, file), 'utf8')
    const { expect: expected } = JSON.parse(text) as { expect: string[] }
    const { run } = analyze(text)
    expect([...new Set(run.findings.map((f) => f.type))].sort()).toEqual([...expected].sort())
  })
  it('duplicate-event keeps the first record and reports the conflict', () => {
    const { normalized, run } = analyze(readFileSync(join(ADV, 'duplicate-event.json'), 'utf8'))
    expect(normalized.issues.map((i) => i.code)).toContain('DUPLICATE_CONFLICT')
    expect(run.actions[0]!.exercised_scope).toEqual(['customer.read'])
  })
  it('malformed-events rejects bad records with reasons and does not pollute prototypes', () => {
    const { normalized } = analyze(readFileSync(join(ADV, 'malformed-events.json'), 'utf8'))
    expect(normalized.stats.records_rejected).toBeGreaterThanOrEqual(5)
    expect(normalized.issues.every((i) => i.message.length > 0)).toBe(true)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})

describe('ingestion', () => {
  it('accepts the documented legacy event format and rewrites aliases', () => {
    const { normalized } = analyze(JSON.stringify({ event_id: 'evt-001', timestamp: '2026-10-03T10:30:00Z', delegated_user: 'user-001', agent_id: 'agent-001', parent_agent: null, tool: 'customer-search', resource: 'customer-db', action: 'read', requested_scope: ['customer.read'], exercised_scope: ['customer.read'], policy_version: 'policy-4', decision: 'allow' }))
    const a = normalized.bundle.actions[0]!
    expect(a.root_principal_id).toBe('user-001')
    expect(a.actor_principal_id).toBe('agent-001')
    expect(a.recorded_decision).toBe('ALLOW')
    expect(normalized.issues.filter((i) => i.code === 'ALIAS_APPLIED').length).toBeGreaterThan(3)
  })
  it('reads JSONL and reports the line of a broken record', () => {
    const text = ['{"event_id":"e1","actor_principal_id":"a","timestamp":"2026-10-03T10:00:00Z"}', '{not json', '', '{"event_id":"e2","actor_principal_id":"a","timestamp":"2026-10-03T10:01:00Z"}'].join('\n')
    const r = normalizeText(text)
    expect(r.bundle.actions).toHaveLength(2)
    expect(r.issues[0]).toMatchObject({ code: 'PARSE_ERROR', record_index: 1 })
  })
  it('refuses to let an action grant its own authority', () => {
    const r = normalizeText(JSON.stringify({ event_id: 'e1', actor_principal_id: 'a', delegated_scope: ['admin.all'] }))
    expect(r.issues.map((i) => i.code)).toContain('IGNORED_FIELD')
  })
  it('treats a timestamp without a timezone as missing', () => {
    const r = normalizeText(JSON.stringify({ event_id: 'e1', actor_principal_id: 'a', timestamp: '2026-10-03 10:00' }))
    expect(r.bundle.actions[0]!.timestamp).toBeNull()
    expect(r.issues.map((i) => i.code)).toContain('INVALID_TIMESTAMP')
  })
  it('strips terminal escapes and bidi overrides from text, and nulls malformed references', () => {
    const ESC = String.fromCharCode(27)
    const RLO = String.fromCharCode(0x202e)
    const r = normalizeText(JSON.stringify([
      { record_type: 'principal', principal_id: 'h', principal_type: 'human', display_name: `Ma${ESC}[2Jya${RLO}` },
      { event_id: 'e1', actor_principal_id: 'h', delegation_id: `d${ESC}]8;;http://evil/${ESC}`, timestamp: '2026-10-03T10:00:00Z' },
    ]))
    expect(r.bundle.principals[0]!.display_name).toBe('Ma[2Jya')
    expect(r.issues.map((i) => i.code)).toContain('TEXT_SANITIZED')
    const all = JSON.stringify(r.bundle)
    for (const bad of [ESC, RLO]) expect(all.includes(bad)).toBe(false)
  })
  it('rejects an action whose event id is not a valid identifier', () => {
    const r = normalizeText(JSON.stringify({ record_type: 'action', event_id: '../../etc/passwd', action_id: 'a1', actor_principal_id: 'h' }))
    expect(r.bundle.actions).toHaveLength(0)
    expect(r.issues.map((i) => i.code)).toContain('INVALID_ID')
  })
  it('accepts a bundle with typed arrays', () => {
    const r = normalizeText(JSON.stringify({ principals: [{ principal_id: 'h', principal_type: 'human' }], events: [{ event_id: 'e1', actor_principal_id: 'h' }] }))
    expect(r.bundle.principals).toHaveLength(1)
    expect(r.bundle.actions).toHaveLength(1)
  })
})

describe('determinism', () => {
  const shuffle = <T>(xs: T[], seed: number): T[] => {
    const a = [...xs]
    let s = seed
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648
      const j = s % (i + 1)
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }
  it('the same input produces a byte-identical run', () => {
    const one = analyze(demoRecords()).run
    const two = analyze(demoRecords()).run
    expect(canonicalJson(one)).toBe(canonicalJson(two))
  })
  it('record order does not change the result', () => {
    const base = analyze(demoRecords()).run
    for (const seed of [1, 7, 42]) {
      const shuffled = analyze(shuffle(demoRecords(), seed)).run
      expect(shuffled.input_digest).toBe(base.input_digest)
      expect(canonicalJson(shuffled)).toBe(canonicalJson(base))
    }
  })
  it('finding ids are stable content hashes', () => {
    const ids = analyze(SCENARIOS[3]!.records).run.findings.map((f) => f.finding_id)
    expect(ids).toEqual(analyze(SCENARIOS[3]!.records).run.findings.map((f) => f.finding_id))
    for (const id of ids) expect(id).toMatch(/^REG-[A-Z]+-[0-9a-f]{10}$/)
  })
})

describe('explanation, replay and analysis views', () => {
  const s4 = analyze(SCENARIOS[3]!.records)
  const bundle = s4.normalized.bundle
  it('explains a violation in plain language from the evidence', () => {
    const e = explainAction(bundle, s4.run, 'evt-s4-write')!
    expect(e.question).toBe('Why is this a finding?')
    expect(e.steps.some((s) => s.tone === 'fail')).toBe(true)
    expect(e.conclusion).toContain('authority amplification')
  })
  it('explains an allowed action', () => {
    const s1 = analyze(SCENARIOS[0]!.records)
    const e = explainAction(s1.normalized.bundle, s1.run, 'evt-s1-read')!
    expect(e.verdict).toBe('allowed')
    expect(e.conclusion).toContain('No authority amplification')
  })
  it('replays only recorded timestamps and marks the violation step', () => {
    const r = buildReplay(bundle, s4.run, 'evt-s4-write')!
    expect(r.steps[0]!.offset_ms).toBe(0)
    expect(r.steps.every((s, i) => i === 0 || s.at! >= r.steps[i - 1]!.at!)).toBe(true)
    expect(r.violation_index).not.toBeNull()
    expect(r.steps[r.violation_index!]!.kind).toBe('execution')
  })
  it('time travel shows authority before and after a revocation', () => {
    const s11 = analyze(SCENARIOS[10]!.records)
    const before = authorityAt(s11.normalized.bundle, '2026-10-03T09:30:00.000Z')
    const after = authorityAt(s11.normalized.bundle, '2026-10-03T10:30:00.000Z')
    expect(before.holders.map((h) => h.principal_id)).toContain('agent-research')
    expect(after.holders.map((h) => h.principal_id)).not.toContain('agent-research')
  })
  it('chain diff reports added authority', () => {
    const s9 = analyze(SCENARIOS[8]!.records)
    const s2 = analyze(SCENARIOS[1]!.records)
    const d = diffChains({ bundle: s2.normalized.bundle, verification: s2.run.actions[0]! }, { bundle: s9.normalized.bundle, verification: s9.run.actions[0]! })
    expect(d.some((e) => e.category === 'authority_added' && e.right.includes('customer.write'))).toBe(true)
  })
  it('controls are derived from the same run', () => {
    const c = evaluateControls(analyze(demoRecords()).run)
    expect(c.find((x) => x.control_id === 'RGT-C1')!.result).toBe('PARTIALLY_SATISFIED')
    expect(evaluateControls(analyze(SCENARIOS[0]!.records).run).every((x) => x.result === 'SATISFIED')).toBe(true)
  })
  it('investigation links related actions', () => {
    const demo = analyze(demoRecords())
    const inv = investigate(demo.normalized.bundle, demo.run, 'evt-0042')!
    expect(inv.root_principal_id).toBe('human-maya')
    expect(inv.related.length).toBeGreaterThan(0)
    expect(inv.findings[0]!.type).toBe('AUTHORITY_AMPLIFICATION')
  })
})

describe('exports', () => {
  it('finding exports validate against regent.finding/v1', () => {
    for (const f of toFindingExports(analyze(demoRecords()).run)) expect(FindingExportSchema.parse(f)).toBeTruthy()
  })
  it('CSV neutralises formula injection and bidi overrides from imported evidence', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('evil‮txt.exe')).toBe('eviltxt.exe')
    const csv = findingsCsv(analyze(SCENARIOS[3]!.records).run)
    expect(csv.split('\r\n')[0]).toContain('finding_id,type,rule_id')
  })
})
