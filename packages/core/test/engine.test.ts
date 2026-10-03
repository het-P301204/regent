import { describe, expect, it } from 'vitest'
import { analyze, baseline, buildRuleSet, DEFAULT_RULESET, EvidenceBuilder, normalizeRecords, verify } from '../src/index.ts'

const at = (hhmm: string) => `2026-10-03T${hhmm}:00Z`
const read = { tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read'] }

function root(b: EvidenceBuilder, granted = ['customer.read']) {
  return b.delegate({ id: 'del-root', from: 'human-alice', to: 'agent-research', granted, at: at('09:00') })
}

describe('chain reconstruction', () => {
  it('links by registry lookup when the record cites no delegation, and says so', () => {
    const { run } = analyze(root(baseline()).act({ event: 'e1', actor: 'agent-research', at: at('09:10'), ...read }).build())
    const a = run.actions[0]!
    expect(a.chain.resolution).toBe('lookup')
    expect(a.chain.root_principal_id).toBe('human-alice')
    expect(a.checks.find((c) => c.dimension === 'chain_completeness')!.result).toBe('WARN')
    expect(a.checks.find((c) => c.dimension === 'attribution')!.result).toBe('PASS')
  })

  it('refuses to choose between two candidate delegations', () => {
    const b = root(baseline()).human('human-bob', 'Bob', ['customer.read'])
      .delegate({ id: 'del-bob', from: 'human-bob', to: 'agent-research', granted: ['customer.read'], at: at('09:01') })
      .act({ event: 'e1', actor: 'agent-research', at: at('09:10'), ...read })
    const { run } = analyze(b.build())
    expect(run.actions[0]!.chain.root_principal_id).toBeNull()
    expect(run.actions[0]!.chain.breaks[0]).toMatchObject({ kind: 'ambiguous' })
    expect(run.findings.map((f) => f.type)).toContain('UNATTRIBUTABLE_ACTION')
  })

  it('uses the declared root to disambiguate, but never trusts it blindly', () => {
    const b = root(baseline()).human('human-bob', 'Bob', ['customer.read'])
      .delegate({ id: 'del-bob', from: 'human-bob', to: 'agent-research', granted: ['customer.read'], root: 'human-bob', at: at('09:01') })
      .act({ event: 'e1', actor: 'agent-research', root: 'human-bob', at: at('09:10'), ...read })
    const { run } = analyze(b.build())
    expect(run.actions[0]!.chain.root_principal_id).toBe('human-bob')
  })

  it('flags a declared root that contradicts the reconstructed chain', () => {
    const b = root(baseline()).human('human-bob', 'Bob', ['customer.read'])
      .act({ event: 'e1', actor: 'agent-research', delegation: 'del-root', root: 'human-bob', at: at('09:10'), ...read })
    const { run } = analyze(b.build())
    expect(run.findings.find((f) => f.type === 'BROKEN_DELEGATION_CHAIN')!.summary).toContain('claims Bob')
  })

  it('lets a human act directly within its provisioned scope', () => {
    const b = baseline().workload('wl-alice', 'human-alice').credential('svid-alice', 'wl-alice')
      .act({ event: 'e1', actor: 'human-alice', at: at('09:10'), ...read, exec: 'wl-alice', credential: 'svid-alice' })
    const { run } = analyze(b.build())
    expect(run.actions[0]!.chain.resolution).toBe('direct')
    expect(run.findings).toEqual([])
  })

  it('reports a human acting beyond its own authority as a scope violation, not amplification', () => {
    const b = baseline().workload('wl-alice', 'human-alice').credential('svid-alice', 'wl-alice')
      .act({ event: 'e1', actor: 'human-alice', at: at('09:10'), ...read, exec: 'wl-alice', credential: 'svid-alice', exercised: ['ledger.write'], requested: ['ledger.write'] })
    const { run } = analyze(b.build())
    expect(run.findings.map((f) => f.type)).toEqual(['SCOPE_VIOLATION'])
  })

  it('carries an unrecorded root authority as an upper bound, never as a PASS', () => {
    const b = new EvidenceBuilder()
      .human('human-x', 'X', null)
      .agent('agent-a', 'A').workload('wl-a', 'agent-a').credential('c-a', 'wl-a')
      .tool('t', 'T').resource('r', 'R').policy('pol-agent-delegation', '4', 'd').policy('pol-agent-runtime', '7', 'r')
      .delegate({ id: 'd1', from: 'human-x', to: 'agent-a', granted: ['customer.read'], at: at('09:00') })
      .act({ event: 'e1', actor: 'agent-a', delegation: 'd1', at: at('09:05'), tool: 't', resource: 'r', exec: 'wl-a', credential: 'c-a', requested: ['customer.read'], exercised: ['customer.read'] })
    const a = analyze(b.build()).run.actions[0]!
    expect(a.checks.find((c) => c.dimension === 'scope')!.result).toBe('WARN')
    expect(a.checks.find((c) => c.dimension === 'authority')!.result).toBe('WARN')
  })
})

describe('authority monotonicity', () => {
  it('reports amplification once at the hop where it entered, not at every later hop', () => {
    const b = baseline()
      .agent('agent-c', 'C', 'sub_agent')
      .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('09:00') })
      .delegate({ id: 'd2', from: 'agent-research', to: 'agent-customer', parent: 'd1', granted: ['customer.read', 'customer.delete'], at: at('09:01') })
      .delegate({ id: 'd3', from: 'agent-customer', to: 'agent-c', parent: 'd2', granted: ['customer.read', 'customer.delete'], at: at('09:02') })
    const { run } = analyze(b.build())
    const amps = run.findings.filter((f) => f.type === 'AUTHORITY_AMPLIFICATION')
    expect(amps).toHaveLength(1)
    expect(amps[0]!.delegation_id).toBe('d2')
  })

  it('applies a policy ceiling to the effective scope and reports a scope violation when it is exceeded', () => {
    const b = baseline()
      .policy('pol-ro', '1', 'Read only', { ceiling: ['customer.read'] })
      .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['customer.read', 'customer.write'], at: at('09:00'), policy: 'pol-ro', version: '1' })
      .act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('09:10'), ...read, exercised: ['customer.write'] })
    const { run } = analyze(b.build())
    expect(run.actions[0]!.effective_scope).toEqual(['customer.read'])
    expect(run.findings.map((f) => f.type)).toEqual(['SCOPE_VIOLATION'])
  })

  it('wildcard grants narrow correctly', () => {
    const b = baseline()
      .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['customer.*'], at: at('09:00') })
      .act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('09:10'), ...read })
    const { run } = analyze(b.build())
    // Alice holds customer.read and customer.write, not customer.*: the wildcard grant amplifies.
    expect(run.findings.map((f) => f.type)).toEqual(['AUTHORITY_AMPLIFICATION'])
    expect(run.actions[0]!.effective_scope).toEqual(['customer.read', 'customer.write'])
    expect(run.actions[0]!.checks.find((c) => c.dimension === 'scope')!.result).toBe('PASS')
  })
})

describe('action-time authorization', () => {
  const revoked = () => baseline()
    .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('09:00') })
    .revoke('delegation', 'd1', at('10:00'))

  it('a decision cached before the revocation is an action-time failure', () => {
    const { run } = analyze(revoked().act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('10:05'), evaluatedAt: at('09:00'), ...read }).build())
    expect(run.findings.map((f) => f.type)).toEqual(['ACTION_TIME_AUTHORIZATION_FAILURE'])
  })

  it('a decision made after the revocation that still allowed is a stale delegation', () => {
    const { run } = analyze(revoked().act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('10:05'), ...read }).build())
    expect(run.findings.map((f) => f.type)).toEqual(['STALE_DELEGATION'])
  })

  it('a refused action after revocation is the correct outcome', () => {
    const { run } = analyze(revoked().act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('10:05'), ...read, exercised: [], decision: 'DENY', result: 'failure' }).build())
    expect(run.findings).toEqual([])
    expect(run.actions[0]!.derived_decision).toBe('DENY')
    expect(run.actions[0]!.decision_agreement).toBe('AGREE')
  })

  it('the same action before the revocation is allowed', () => {
    const { run } = analyze(revoked().act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('09:30'), ...read }).build())
    expect(run.findings).toEqual([])
    expect(run.actions[0]!.derived_decision).toBe('ALLOW')
  })
})

describe('approval', () => {
  it('distinguishes approval from authorization', () => {
    const b = baseline()
      .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['invoice.approve'], at: at('09:00') })
      .act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('09:10'), ...read, requested: ['invoice.approve'], exercised: ['invoice.approve'], approval: 'PENDING', decision: 'ALLOW', result: null })
    const { run } = analyze(b.build())
    expect(run.actions[0]!.checks.find((c) => c.dimension === 'scope')!.result).toBe('PASS')
    expect(run.findings.map((f) => f.type)).toEqual(['MISSING_APPROVAL'])
    expect(run.actions[0]!.derived_decision).toBe('CONDITIONAL')
  })
})

describe('rule configuration', () => {
  const records = () => baseline()
    .delegate({ id: 'd1', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('09:00') })
    .act({ event: 'e1', actor: 'agent-research', delegation: 'd1', at: at('09:10'), ...read, exercised: ['customer.write'], version: null })
    .build()

  it('a disabled rule emits no findings and its check reports SKIPPED, never PASS', () => {
    const ruleset = buildRuleSet({ 'AUTH-001': { enabled: false } }, 'test-1')
    const { bundle } = normalizeRecords(records())
    const run = verify(bundle, { ruleset })
    expect(run.findings.map((f) => f.type)).toEqual(['MISSING_POLICY_VERSION'])
    expect(run.actions[0]!.checks.find((c) => c.dimension === 'scope')!.result).toBe('SKIPPED')
    // The decision is evidence, not configuration: still DENY.
    expect(run.actions[0]!.derived_decision).toBe('DENY')
  })

  it('severity overrides apply to emitted findings', () => {
    const ruleset = buildRuleSet({ 'AUTH-007': { severity: 'low' } }, 'test-2')
    const run = verify(normalizeRecords(records()).bundle, { ruleset })
    expect(run.findings.find((f) => f.type === 'MISSING_POLICY_VERSION')!.severity).toBe('low')
  })

  it('applies_to restricts a rule to principal types', () => {
    const ruleset = buildRuleSet({ 'AUTH-007': { applies_to: ['sub_agent'] } }, 'test-3')
    const run = verify(normalizeRecords(records()).bundle, { ruleset })
    expect(run.findings.some((f) => f.type === 'MISSING_POLICY_VERSION')).toBe(false)
  })

  it('the run records which rule set version produced it', () => {
    const run = verify(normalizeRecords(records()).bundle)
    expect(run.ruleset_version).toBe(DEFAULT_RULESET.version)
  })
})

describe('record completeness', () => {
  it('lists missing and critical fields and shows the arithmetic', () => {
    const { run } = analyze([{ event_id: 'evt-001', timestamp: '2026-10-03T10:30:00Z', delegated_user: 'user-001', agent_id: 'agent-001', tool: 'customer-search', resource: 'customer-db', action: 'read', requested_scope: ['customer.read'], exercised_scope: ['customer.read'], policy_version: 'policy-4', decision: 'allow' }])
    const c = run.actions[0]!.record_completeness
    expect(c.missing).toContain('execution_identity_id')
    expect(c.critical_missing).toEqual([])
    expect(c.percent).toBe(Math.round((c.present.length / c.required_count) * 100))
  })
})
