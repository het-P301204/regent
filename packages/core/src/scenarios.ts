import { baseline, EvidenceBuilder } from './builder.ts'
import type { RawRecord } from './builder.ts'
import type { FindingType } from './types.ts'

/**
 * The Scenario Lab. Each scenario is a small, deterministic, entirely synthetic
 * dataset built to make exactly one security property visible. `expected`
 * lists the finding types it must produce and nothing else, which the test
 * suite enforces in both directions.
 */
export interface Scenario {
  slug: string
  number: number
  title: string
  summary: string
  teaches: string
  /** The event to open first when the scenario is loaded. */
  focus_event: string
  expected: FindingType[]
  records: RawRecord[]
}

const D = '2026-10-03'
const at = (hhmm: string) => `${D}T${hhmm}:00Z`

function s(slug: string, number: number, title: string, summary: string, teaches: string, focus: string, expected: FindingType[], build: (b: EvidenceBuilder) => EvidenceBuilder): Scenario {
  return { slug, number, title, summary, teaches, focus_event: focus, expected, records: build(baseline(new EvidenceBuilder())).build() }
}

const root = (b: EvidenceBuilder, granted: string[], extra: Partial<Parameters<EvidenceBuilder['delegate']>[0]> = {}) =>
  b.delegate({ id: 'del-alice-research', from: 'human-alice', to: 'agent-research', granted, at: at('09:00'), expires: `${D}T18:00:00Z`, ...extra })

export const SCENARIOS: Scenario[] = [
  s('valid-single-agent', 1, 'Valid single-agent delegation',
    'Alice delegates read-only customer access to ResearchAgent, which reads one customer record.',
    'What a fully attributable, contained chain looks like: every check passes and the derived decision matches the recorded one.',
    'evt-s1-read', [],
    (b) => root(b, ['customer.read']).act({ event: 'evt-s1-read', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:12'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read'], parameters: { customer_id: 'cus-1042' } })),

  s('valid-multi-agent', 2, 'Valid multi-agent delegation',
    'Alice grants ResearchAgent read and write; ResearchAgent passes only read to CustomerAgent, which reads.',
    'Authority narrowing across hops: the sub-agent receives less than its delegator holds, and that is exactly what monotonicity allows.',
    'evt-s2-read', [],
    (b) => root(b, ['customer.read', 'customer.write'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:05'), expires: `${D}T12:00:00Z` })
      .act({ event: 'evt-s2-read', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', parent: 'agent-research', at: at('09:20'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'], parameters: { customer_id: 'cus-2210' } })),

  s('broken-parent-chain', 3, 'Broken parent chain',
    "CustomerAgent's delegation cites a parent delegation that does not exist in the evidence.",
    'A chain that cannot be followed is an attribution failure. REGENT reports it as unattributable rather than guessing who authorized it.',
    'evt-s3-read', ['BROKEN_DELEGATION_CHAIN', 'UNATTRIBUTABLE_ACTION'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-ghost-0001', granted: ['customer.read'], at: at('09:05') })
      .act({ event: 'evt-s3-read', actor: 'agent-customer', delegation: 'del-research-customer', at: at('09:25'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('authority-amplification', 4, 'Authority amplification',
    'Every delegation is read-only, but CustomerAgent writes a customer record through a tool whose workload identity holds standing write access.',
    'A confused deputy spread across a chain: no single component authorized the write, yet it happened. The amplification is located at the exact edge where it entered.',
    'evt-s4-write', ['AUTHORITY_AMPLIFICATION'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:05') })
      .act({ event: 'evt-s4-write', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', at: at('09:31'), tool: 'tool-customer-update', resource: 'res-customer-db', operation: 'update', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read', 'customer.write'], exercised: ['customer.read', 'customer.write'], parameters: { customer_id: 'cus-1042', field: 'billing_email' } })),

  s('missing-delegated-user', 5, 'Missing delegated user',
    'ResearchAgent was started by a scheduler, not a person. It spawns CustomerAgent, which reads customer data.',
    'An action with no human at the root is unattributable even if nothing it did exceeded a grant. Missing evidence is reported as missing, not as misuse.',
    'evt-s5-read', ['ORPHANED_PRINCIPAL', 'UNATTRIBUTABLE_ACTION'],
    (b) => b
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', granted: ['customer.read'], at: at('09:05') })
      .act({ event: 'evt-s5-read', actor: 'agent-customer', delegation: 'del-research-customer', at: at('09:40'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('credential-mismatch', 6, 'Credential mismatch',
    "CustomerAgent's action runs as its own workload identity but presents ResearchAgent's credential.",
    'A credential is evidence of who authenticated, not a principal. When it is bound to a different identity, the recorded chain no longer describes who acted.',
    'evt-s6-read', ['CREDENTIAL_BINDING_MISMATCH'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:05') })
      .act({ event: 'evt-s6-read', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', at: at('09:45'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('revoked-credential', 7, 'Revoked credential',
    "CustomerAgent's credential is revoked at 10:00; at 10:20 an action authenticates with it and is allowed.",
    'Authority ends when the material it depends on is revoked. Validity is checked at the moment of the action, not when the credential was issued.',
    'evt-s7-read', ['REVOKED_CREDENTIAL'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:05') })
      .revoke('credential', 'svid-customer-02', at('10:00'), 'Key rotation after exposure in a debug log')
      .act({ event: 'evt-s7-read', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', at: at('10:20'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('stale-delegation', 8, 'Stale delegation',
    "ResearchAgent's delegation to CustomerAgent expired at 09:30. CustomerAgent keeps working and is allowed at 10:15.",
    'Delegations end. A decision that does not check expiry lets a sub-agent outlive the authority it was given.',
    'evt-s8-read', ['STALE_DELEGATION'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read'], at: at('09:05'), expires: at('09:30') })
      .act({ event: 'evt-s8-read', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', at: at('10:15'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('excessive-sub-agent-scope', 9, 'Sub-agent receives excessive scope',
    'Alice grants ResearchAgent read only. ResearchAgent grants CustomerAgent read and write. CustomerAgent only reads.',
    "Amplification at the grant: the delegation itself is the finding, even before anyone uses the extra authority. The action is still contained in its effective scope, because effective scope can never include what the delegator did not hold.",
    'evt-s9-read', ['AUTHORITY_AMPLIFICATION'],
    (b) => root(b, ['customer.read'])
      .delegate({ id: 'del-research-customer', from: 'agent-research', to: 'agent-customer', parent: 'del-alice-research', granted: ['customer.read', 'customer.write'], at: at('09:05') })
      .act({ event: 'evt-s9-read', actor: 'agent-customer', delegation: 'del-research-customer', root: 'human-alice', at: at('09:50'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02', requested: ['customer.read'], exercised: ['customer.read'] })),

  s('missing-policy-version', 10, 'Missing policy version',
    'An allowed action names its policy but not the policy version that decided it.',
    'Policy traceability: without the exact version, a decision cannot be reconstructed, and a policy change cannot be told apart from a bypass.',
    'evt-s10-read', ['MISSING_POLICY_VERSION'],
    (b) => root(b, ['customer.read']).act({ event: 'evt-s10-read', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('09:55'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read'], version: null })),

  s('action-time-authorization', 11, 'Action-time authorization failure',
    "Alice's delegation to ResearchAgent is revoked at 10:00. At 10:05 ResearchAgent reads customer data, allowed by a decision cached at 09:00.",
    'Provision-time AUTHORIZED, action-time DENIED. Authorization evaluated once at provisioning keeps working after the authority behind it is gone.',
    'evt-s11-read', ['ACTION_TIME_AUTHORIZATION_FAILURE'],
    (b) => root(b, ['customer.read'])
      .revoke('delegation', 'del-alice-research', at('10:00'), 'Alice ended the research task')
      .act({ event: 'evt-s11-read', actor: 'agent-research', delegation: 'del-alice-research', root: 'human-alice', at: at('10:05'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-research-01', credential: 'svid-research-01', requested: ['customer.read'], exercised: ['customer.read'], evaluatedAt: at('09:00'), reason: 'cached grant decision' })),

  s('complex-multi-agent', 12, 'Complex multi-agent chain',
    'A four-hop chain from Alice through a planner to two specialist agents, with one clean branch and three distinct failures.',
    'Real chains fail in more than one place at once. Locate the first broken edge on each branch rather than reading the whole chain as one verdict.',
    'evt-s12-approve', ['AUTHORITY_AMPLIFICATION', 'MISSING_APPROVAL', 'EXECUTION_IDENTITY_MISMATCH'],
    (b) => b
      .agent('agent-planner', 'PlannerAgent', 'sub_agent')
      .agent('agent-invoice', 'InvoiceAgent', 'sub_agent')
      .agent('agent-report', 'ReportAgent', 'sub_agent')
      .workload('wl-invoice-07', 'agent-invoice', { provisioned: ['invoice.read', 'invoice.write', 'invoice.approve'] })
      .workload('wl-report-03', 'agent-report', { provisioned: ['invoice.read'] })
      .credential('svid-invoice-07', 'wl-invoice-07')
      .credential('svid-report-03', 'wl-report-03')
      .credential('svid-customer-02b', 'wl-customer-02')
      .tool('tool-invoice-lookup', 'InvoiceLookup')
      .tool('tool-invoice-approve', 'InvoiceApprove')
      .tool('tool-report-export', 'ReportExport', 'api')
      .resource('res-invoice-db', 'InvoiceDB')
      .delegate({ id: 'del-alice-research', from: 'human-alice', to: 'agent-research', granted: ['customer.read', 'invoice.read', 'invoice.write', 'invoice.approve'], at: at('09:00'), expires: `${D}T18:00:00Z` })
      .delegate({ id: 'del-research-planner', from: 'agent-research', to: 'agent-planner', parent: 'del-alice-research', granted: ['invoice.read', 'invoice.write', 'invoice.approve'], at: at('09:02') })
      .delegate({ id: 'del-planner-invoice', from: 'agent-planner', to: 'agent-invoice', parent: 'del-research-planner', granted: ['invoice.read', 'invoice.approve'], at: at('09:03') })
      .delegate({ id: 'del-planner-report', from: 'agent-planner', to: 'agent-report', parent: 'del-research-planner', granted: ['invoice.read', 'report.export'], at: at('09:04') })
      .act({ event: 'evt-s12-lookup', actor: 'agent-invoice', delegation: 'del-planner-invoice', root: 'human-alice', at: at('10:10'), tool: 'tool-invoice-lookup', resource: 'res-invoice-db', operation: 'read', exec: 'wl-invoice-07', credential: 'svid-invoice-07', requested: ['invoice.read'], exercised: ['invoice.read'] })
      .act({ event: 'evt-s12-approve', actor: 'agent-invoice', delegation: 'del-planner-invoice', root: 'human-alice', parentEvent: 'evt-s12-lookup', at: at('10:12'), tool: 'tool-invoice-approve', resource: 'res-invoice-db', operation: 'approve', exec: 'wl-invoice-07', credential: 'svid-invoice-07', requested: ['invoice.approve'], exercised: ['invoice.approve'], approval: 'PENDING', parameters: { invoice_id: 'inv-88213', amount_eur: 18400 } })
      .act({ event: 'evt-s12-export', actor: 'agent-report', delegation: 'del-planner-report', root: 'human-alice', at: at('10:20'), tool: 'tool-report-export', resource: 'res-invoice-db', operation: 'export', exec: 'wl-report-03', credential: 'svid-report-03', requested: ['invoice.read'], exercised: ['invoice.read'] })
      .act({ event: 'evt-s12-shadow', actor: 'agent-report', delegation: 'del-planner-report', root: 'human-alice', at: at('10:24'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-customer-02', credential: 'svid-customer-02b', requested: ['invoice.read'], exercised: ['invoice.read'] })),
]

export function scenarioBySlug(slug: string): Scenario | undefined {
  return SCENARIOS.find((x) => x.slug === slug || String(x.number) === slug)
}
