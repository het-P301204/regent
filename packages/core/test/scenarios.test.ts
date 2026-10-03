import { describe, expect, it } from 'vitest'
import { analyze, chainHealth, SCENARIOS, demoRecords } from '../src/index.ts'

describe('scenario lab', () => {
  it('has twelve scenarios with unique slugs and numbers', () => {
    expect(SCENARIOS).toHaveLength(12)
    expect(new Set(SCENARIOS.map((s) => s.slug)).size).toBe(12)
    expect(SCENARIOS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it.each(SCENARIOS.map((s) => [s.slug, s] as const))('%s produces exactly its expected finding types', (_slug, s) => {
    const { run, normalized } = analyze(s.records)
    expect(normalized.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect([...new Set(run.findings.map((f) => f.type))].sort()).toEqual([...s.expected].sort())
    expect(run.actions.some((a) => a.event_id === s.focus_event)).toBe(true)
  })

  it.each(['valid-single-agent', 'valid-multi-agent'])('%s passes every check and agrees with the recorded decision', (slug) => {
    const s = SCENARIOS.find((x) => x.slug === slug)!
    const { run } = analyze(s.records)
    for (const a of run.actions) {
      expect(a.checks.map((c) => [c.dimension, c.result])).toEqual(a.checks.map((c) => [c.dimension, 'PASS']))
      expect(a.derived_decision).toBe('ALLOW')
      expect(a.decision_agreement).toBe('AGREE')
      expect(chainHealth(a)).toBe('verified')
    }
  })

  it('authority amplification explains the exact expansion and locates the broken edge', () => {
    const { run } = analyze(SCENARIOS.find((x) => x.slug === 'authority-amplification')!.records)
    const f = run.findings.find((x) => x.type === 'AUTHORITY_AMPLIFICATION')!
    expect(f.authority_delta?.excess).toEqual(['customer.write'])
    expect(f.authority_delta?.granted).toEqual(['customer.read'])
    expect(f.authority_delta?.exercised).toEqual(['customer.read', 'customer.write'])
    expect(f.broken_edge).toEqual({ from: 'agent-customer', to: 'tool-customer-update', hop_index: null, delegation_id: null })
    expect(f.root_cause).toContain('confused deputy')
    expect(run.actions[0]!.derived_decision).toBe('DENY')
    expect(run.actions[0]!.decision_agreement).toBe('DISAGREE')
  })

  it('excessive sub-agent scope is a grant-level finding while the action stays contained', () => {
    const { run } = analyze(SCENARIOS.find((x) => x.slug === 'excessive-sub-agent-scope')!.records)
    const f = run.findings[0]!
    expect(f.rule_id).toBe('AUTH-010')
    expect(f.broken_edge).toMatchObject({ from: 'agent-research', to: 'agent-customer', hop_index: 1 })
    const a = run.actions[0]!
    expect(a.checks.find((c) => c.dimension === 'scope')!.result).toBe('PASS')
    expect(a.checks.find((c) => c.dimension === 'authority')!.result).toBe('FAIL')
    expect(a.effective_scope).toEqual(['customer.read'])
  })

  it('action-time failure is reported once, absorbing the stale delegation it explains', () => {
    const { run } = analyze(SCENARIOS.find((x) => x.slug === 'action-time-authorization')!.records)
    expect(run.findings.map((f) => f.type)).toEqual(['ACTION_TIME_AUTHORIZATION_FAILURE'])
    expect(run.actions[0]!.derived_decision).toBe('DENY')
    expect(run.findings[0]!.root_cause).toMatch(/Provision-time.*Action-time/)
  })

  it('missing evidence is never reported as unauthorized behaviour', () => {
    const { run } = analyze(SCENARIOS.find((x) => x.slug === 'missing-delegated-user')!.records)
    const a = run.actions[0]!
    expect(a.derived_decision).toBe('UNKNOWN')
    expect(chainHealth(a)).toBe('incomplete')
    expect(run.findings.some((f) => f.type === 'SCOPE_VIOLATION' || f.type === 'AUTHORITY_AMPLIFICATION')).toBe(false)
    expect(a.checks.find((c) => c.dimension === 'scope')!.result).not.toBe('PASS')
  })
})

describe('demo environment', () => {
  const { run, normalized } = analyze(demoRecords())

  it('ingests cleanly', () => {
    expect(normalized.issues).toEqual([])
    expect(normalized.stats.records_rejected).toBe(0)
  })

  it('contains both healthy and problematic chains', () => {
    expect(run.summary.chain_health.verified).toBeGreaterThan(20)
    expect(run.summary.chain_health.violated).toBeGreaterThan(3)
    expect(run.summary.unattributable_actions).toBeGreaterThan(0)
  })

  it('shows the refusal after revocation as a correct outcome, not a finding', () => {
    const refused = run.actions.find((a) => a.recorded_decision === 'DENY')!
    expect(refused.executed).toBe(false)
    expect(refused.checks.find((c) => c.dimension === 'temporal')!.result).toBe('PASS')
  })
})
