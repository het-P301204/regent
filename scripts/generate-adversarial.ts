/**
 * Writes the adversarial datasets in tests/adversarial/. Each file is plain
 * JSON evidence that REGENT must analyze safely and classify correctly. The
 * generated files are committed so they can also be fed to the CLI by hand.
 *
 *   node scripts/generate-adversarial.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseline, EvidenceBuilder } from '../packages/core/src/builder.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'tests', 'adversarial')
mkdirSync(out, { recursive: true })

const at = (hhmm: string) => `2026-10-03T${hhmm}:00Z`
const read = { tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] }
const rootDel = (b: EvidenceBuilder) => b.delegate({ id: 'del-alice-research', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('09:00') })

const files: Record<string, { description: string; expect: string[]; records: unknown[] }> = {
  'cycle.json': {
    description: 'Two delegations name each other as parent. Following parents never reaches a root.',
    expect: ['BROKEN_DELEGATION_CHAIN', 'UNATTRIBUTABLE_ACTION'],
    records: baseline()
      .delegate({ id: 'del-a', from: 'agent-research', to: 'agent-customer', parent: 'del-b', granted: ['customer.read'], at: at('09:00') })
      .delegate({ id: 'del-b', from: 'agent-customer', to: 'agent-research', parent: 'del-a', granted: ['customer.read'], at: at('09:00') })
      .act({ event: 'evt-cycle', actor: 'agent-customer', delegation: 'del-a', at: at('09:10'), ...read })
      .build(),
  },
  'orphan-agent.json': {
    description: 'An agent acts with no delegation to it anywhere in the evidence.',
    expect: ['ORPHANED_PRINCIPAL', 'UNATTRIBUTABLE_ACTION'],
    records: baseline().act({ event: 'evt-orphan', actor: 'agent-customer', at: at('09:10'), ...read }).build(),
  },
  'privilege-amplification.json': {
    description: 'A read-only chain whose last hop exercises write.',
    expect: ['AUTHORITY_AMPLIFICATION'],
    records: rootDel(baseline())
      .delegate({ id: 'del-rc', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:01') })
      .act({ event: 'evt-amp', actor: 'agent-customer', delegation: 'del-rc', root: 'human-alice', at: at('09:10'), ...read, tool: 'tool-customer-update', requested: ['customer.write'], exercised: ['customer.write'] })
      .build(),
  },
  'credential-mismatch.json': {
    description: 'The action presents a credential bound to a different execution identity.',
    expect: ['CREDENTIAL_BINDING_MISMATCH'],
    records: rootDel(baseline()).act({ event: 'evt-cred', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:10'), ...read, exec: 'wl-research-01', credential: 'svid-customer-02' }).build(),
  },
  'missing-principal.json': {
    description: 'The action names an actor and a root principal that are not in the identity registry.',
    expect: ['UNKNOWN_REFERENCE', 'UNATTRIBUTABLE_ACTION', 'EXECUTION_IDENTITY_MISMATCH'],
    records: baseline().act({ event: 'evt-ghost', actor: 'agent-ghost', root: 'human-ghost', at: at('09:10'), ...read }).build(),
  },
  'missing-scope.json': {
    description: 'A delegation with no granted scope and an action with no requested scope.',
    expect: ['MISSING_DELEGATED_SCOPE', 'MISSING_REQUESTED_SCOPE'],
    records: baseline()
      .delegate({ id: 'del-noscope', from: 'human-alice', to: 'agent-research', granted: null, at: at('09:00') })
      .act({ event: 'evt-noscope', actor: 'agent-research', delegation: 'del-noscope', root: 'human-alice', at: at('09:10'), ...read, exec: 'wl-research-01', credential: 'svid-research-01', requested: null })
      .build(),
  },
  'stale-delegation.json': {
    description: 'The delegation expired an hour before the action.',
    expect: ['STALE_DELEGATION'],
    records: baseline()
      .delegate({ id: 'del-old', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('08:00'), expires: at('09:00') })
      .act({ event: 'evt-stale', actor: 'agent-research', delegation: 'del-old', root: 'human-alice', at: at('10:00'), ...read, exec: 'wl-research-01', credential: 'svid-research-01' })
      .build(),
  },
  'revoked-identity.json': {
    description: 'The root human is revoked before the agent acts on their delegation.',
    expect: ['REVOKED_IDENTITY'],
    records: rootDel(baseline())
      .revoke('principal', 'human-alice', at('09:30'), 'left the organisation')
      .act({ event: 'evt-revid', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('10:00'), ...read, exec: 'wl-research-01', credential: 'svid-research-01' })
      .build(),
  },
  'duplicate-event.json': {
    description: 'The same event id appears twice with different content. The first is kept and the conflict is reported at ingestion.',
    expect: [],
    records: [
      ...rootDel(baseline()).act({ event: 'evt-dup', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:10'), ...read, exec: 'wl-research-01', credential: 'svid-research-01' }).build(),
      ...new EvidenceBuilder().act({ event: 'evt-dup', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:10'), ...read, exec: 'wl-research-01', credential: 'svid-research-01', exercised: ['customer.read', 'customer.write'] }).build(),
    ],
  },
  'conflicting-policy.json': {
    description: 'The policy ceiling removes customer.write, which the chain conveyed; the action exercises it anyway.',
    expect: ['SCOPE_VIOLATION'],
    records: new EvidenceBuilder()
      .human('human-alice', 'Alice Romero', ['customer.read', 'customer.write'])
      .agent('agent-research', 'ResearchAgent')
      .workload('wl-research-01', 'agent-research')
      .credential('svid-research-01', 'wl-research-01')
      .tool('tool-customer-update', 'CustomerUpdate')
      .resource('res-customer-db', 'CustomerDB')
      .policy('pol-agent-delegation', '4', 'Agent delegation policy')
      .policy('pol-read-only', '2', 'Read-only runtime', { ceiling: ['customer.read'] })
      .delegate({ id: 'del-rw', from: 'human-alice', to: 'agent-research', granted: ['customer.read', 'customer.write'], at: at('09:00') })
      .act({ event: 'evt-ceiling', actor: 'agent-research', delegation: 'del-rw', root: 'human-alice', at: at('09:10'), tool: 'tool-customer-update', resource: 'res-customer-db', operation: 'update', exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.write'], exercised: ['customer.write'], policy: 'pol-read-only', version: '2' })
      .build(),
  },
  'forged-parent.json': {
    description: "The action cites Alice's delegation to ResearchAgent, but CustomerAgent performed it.",
    expect: ['BROKEN_DELEGATION_CHAIN', 'UNATTRIBUTABLE_ACTION'],
    records: rootDel(baseline()).act({ event: 'evt-forged', actor: 'agent-customer', delegation: 'del-alice-research', root: 'human-alice', at: at('09:10'), ...read }).build(),
  },
  'excessive-nesting.json': {
    description: 'A 40-hop delegation chain, longer than the 32-hop limit.',
    expect: ['BROKEN_DELEGATION_CHAIN', 'UNATTRIBUTABLE_ACTION'],
    records: (() => {
      const b = baseline()
      for (let i = 0; i < 40; i++) b.agent(`agent-n${i}`, `NestedAgent${i}`, 'sub_agent')
      b.delegate({ id: 'del-n0', from: 'human-alice', to: 'agent-n0', granted: ['customer.read'], at: at('09:00') })
      for (let i = 1; i < 40; i++) b.delegate({ id: `del-n${i}`, from: `agent-n${i - 1}`, to: `agent-n${i}`, parent: `del-n${i - 1}`, granted: ['customer.read'], at: at('09:00') })
      b.workload('wl-n39', 'agent-n39').credential('svid-n39', 'wl-n39')
      b.act({ event: 'evt-deep', actor: 'agent-n39', delegation: 'del-n39', at: at('09:10'), ...read, exec: 'wl-n39', credential: 'svid-n39' })
      return b.build()
    })(),
  },
  'invalid-scope-syntax.json': {
    description: 'Scopes that do not parse. They are kept as opaque literals, so an unparseable exercised permission still fails containment.',
    expect: ['AUTHORITY_AMPLIFICATION'],
    records: rootDel(baseline()).act({ event: 'evt-badscope', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:10'), ...read, exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read', 'Customer.*.Write', '*'] }).build(),
  },
  'conflicting-timestamps.json': {
    description: 'The action is timestamped before the delegation it cites was created.',
    expect: ['BROKEN_DELEGATION_CHAIN'],
    records: baseline()
      .delegate({ id: 'del-future', from: 'human-alice', to: 'agent-research', granted: ['customer.read'], at: at('11:00') })
      .act({ event: 'evt-backdated', actor: 'agent-research', delegation: 'del-future', root: 'human-alice', at: at('10:00'), ...read, exec: 'wl-research-01', credential: 'svid-research-01' })
      .build(),
  },
  'malformed-events.json': {
    description: 'Records with wrong types, unknown record types, bad ids, non-ISO timestamps and prototype-pollution keys. Bad records are rejected at ingestion with a reason; the one well-formed event is kept, its unknown keys dropped, and it is unattributable.',
    expect: ['MISSING_POLICY_VERSION', 'MISSING_REQUESTED_SCOPE', 'UNATTRIBUTABLE_ACTION', 'UNKNOWN_REFERENCE'],
    records: [
      { record_type: 'principal', principal_id: 'human-x', principal_type: 'root-admin' },
      { record_type: 'shell', command: 'rm -rf /' },
      { record_type: 'action', event_id: '../../etc/passwd', actor_principal_id: 'agent-x' },
      { record_type: 'action', event_id: 'evt-badtime', timestamp: 'yesterday', actor_principal_id: 'agent-x', exercised_scope: 'customer.read' },
      { event_id: 'evt-proto', PROTO_KEY: { polluted: true }, constructor: { prototype: { polluted: true } }, actor_principal_id: 'agent-x', timestamp: '2026-10-03T09:00:00Z' },
      42,
      null,
    ],
  },
}

for (const [name, f] of Object.entries(files)) {
  // A literal "__proto__" key cannot come out of JSON.stringify on an object literal; it is spliced in as text.
  const text = JSON.stringify({ description: f.description, expect: f.expect, records: f.records }, null, 2).replace('"PROTO_KEY"', '"__proto__"')
  writeFileSync(join(out, name), `${text}\n`, 'utf8')
}
console.log(`wrote ${Object.keys(files).length} adversarial datasets to ${out}`)
