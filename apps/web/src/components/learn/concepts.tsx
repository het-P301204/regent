import type { ReactNode } from 'react'
import { AuthorityFlow } from '../../viz/AuthorityFlow'
import type { FlowStage } from '../../viz/model'
import { ScopeChips } from '../../ui/scope'
import { DecisionBadge, ResultBadge } from '../../ui/status'
import { CodeBlock } from '../../ui/data'
import { ActionTimeTimeline, ComparePair, FieldChecklist, NodeChain, ReconstructionSteps } from './diagrams'

/**
 * Learning-mode content. Every example uses the Acme demo dataset (fictional:
 * Maya Chen, OperationsAgent, InvoiceAgent, ReconciliationAgent …). Results
 * quoted here are what the engine produces for the demo run; the "Try it"
 * links open the live views so a reader can check them.
 */

export interface TryLink {
  to: string
  label: string
  note: string
}

export interface Concept {
  slug: string
  title: string
  kicker: string
  concept: ReactNode
  why: ReactNode
  example: ReactNode
  viz: ReactNode
  vizCaption: string
  tryIt: TryLink[]
}

const MAYA = ['invoice.approve', 'invoice.read', 'invoice.write', 'ledger.read', 'ledger.write', 'report.export']
const OPS = ['invoice.approve', 'invoice.read', 'invoice.write', 'ledger.read', 'report.export']

const delegationFlow: FlowStage[] = [
  { id: 'maya', label: 'Maya Chen', role: 'Human principal', scope: MAYA, excess: [], result: 'PASS' },
  { id: 'ops', label: 'OperationsAgent', role: 'Agent', scope: OPS, excess: [], result: 'PASS' },
  { id: 'inv', label: 'InvoiceAgent', role: 'Sub-agent', scope: ['invoice.approve', 'invoice.read'], excess: [], result: 'PASS' },
  { id: 'act', label: 'InvoiceLookup', role: 'Exercised', scope: ['invoice.read'], excess: [], result: 'PASS' },
]

const deputyFlow: FlowStage[] = [
  { id: 'maya', label: 'Maya Chen', role: 'Human principal', scope: MAYA, excess: [], result: 'PASS' },
  { id: 'ops', label: 'OperationsAgent', role: 'Agent', scope: OPS, excess: [], result: 'PASS' },
  { id: 'recon', label: 'ReconciliationAgent', role: 'Sub-agent', scope: ['ledger.read'], excess: [], result: 'PASS' },
  { id: 'act', label: 'LedgerPost', role: 'Exercised', scope: ['ledger.read'], excess: ['ledger.write'], result: 'FAIL' },
]

const amplificationFlow: FlowStage[] = [
  { id: 'daniel', label: 'Daniel Okafor', role: 'Human principal', scope: ['customer.read', 'customer.write', 'email.draft', 'ticket.read', 'ticket.write'], excess: [], result: 'PASS' },
  { id: 'support', label: 'SupportAgent', role: 'Agent', scope: ['customer.read', 'email.draft', 'ticket.read', 'ticket.write'], excess: [], result: 'PASS' },
  { id: 'reply', label: 'ReplyDraftAgent', role: 'Sub-agent', scope: ['email.draft', 'ticket.read'], excess: ['customer.write'], result: 'FAIL' },
  { id: 'act', label: 'EmailDraft', role: 'Exercised', scope: ['email.draft'], excess: [], result: 'PASS' },
]

type ScopeRow = [label: string, scope: readonly string[], highlight?: readonly string[]]

function Scopes({ rows }: { rows: ScopeRow[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-[minmax(150px,max-content)_1fr]">
      {rows.map(([k, scope, highlight]) => (
        <div key={k} className="contents">
          <dt className="pt-0.5 text-ink-3">{k}</dt>
          <dd className="min-w-0">
            <ScopeChips scope={scope} highlight={highlight ?? []} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

const P = ({ children }: { children: ReactNode }) => <p className="text-[13.5px] leading-relaxed text-ink-2 [&+p]:mt-3">{children}</p>
const C = ({ children }: { children: ReactNode }) => <code className="rounded-[3px] bg-s2 px-1 py-px font-mono text-[12px] text-ink">{children}</code>

export const CONCEPTS: Concept[] = [
  {
    slug: 'delegation',
    title: 'Delegation',
    kicker: 'A recorded grant of authority from a delegator to a delegatee.',
    concept: (
      <>
        <P>
          A delegation is a record in which a delegator (a human principal or an agent) grants a delegatee a granted scope, for a period, under a policy. Delegations chain: a delegation issued by an agent names its parent delegation, the one under which the agent held its own authority. Following parents leads back to the root principal.
        </P>
        <P>
          The delegatee's effective scope is its granted scope intersected with the delegator's effective scope, then with any policy ceiling. Authority can only narrow along a chain: <C>Exercised ⊆ Effective ⊆ Granted</C>, and <C>Granted ⊆ Effective(delegator)</C>.
        </P>
      </>
    ),
    why: (
      <P>
        Agents rarely act on their own authority. Without a recorded delegation there is no answer to "who allowed this?" after the fact, and no contract to check the action against. Spawning a sub-agent is a delegation event and needs its own record.
      </P>
    ),
    example: (
      <P>
        Maya Chen delegates five finance permissions to OperationsAgent (<C>del-maya-ops</C>, 08:00 to 20:00). OperationsAgent delegates <C>invoice.read</C> and <C>invoice.approve</C> to InvoiceAgent (<C>del-ops-invoice</C>), citing <C>del-maya-ops</C> as its parent. When InvoiceAgent reads invoice inv-88201 through InvoiceLookup, the chain is Maya Chen → OperationsAgent → InvoiceAgent, and authority narrows at every hop.
      </P>
    ),
    viz: <AuthorityFlow stages={delegationFlow} height={230} />,
    vizCaption: 'Authority flow for a healthy finance chain. Band width is the number of permissions held at each stage; it only narrows.',
    tryIt: [
      { to: '/app/delegations/del-ops-invoice', label: 'Open del-ops-invoice', note: 'The delegation rendered as a contract.' },
      { to: '/app/scenarios', label: 'Scenario 2: valid multi-agent delegation', note: 'A sub-agent receiving less than its delegator holds.' },
      { to: '/app/builder', label: 'Build a chain', note: 'Compose delegations and verify them without storing anything.' },
    ],
  },
  {
    slug: 'confused-deputy',
    title: 'Confused deputy',
    kicker: 'A component uses its own authority on behalf of a requester who lacks it.',
    concept: (
      <>
        <P>
          Norm Hardy named the problem in 1988: a program holds authority for one purpose and is induced to use it on behalf of a requester who does not hold that authority. The deputy is not malicious. It cannot tell whose authority it is exercising.
        </P>
        <P>In agent systems the deputy is often a tool whose workload identity holds standing permissions broader than the delegation behind the call. The tool falls back to its own authority, and the action succeeds.</P>
      </>
    ),
    why: (
      <P>
        Each component can look correctly configured: the agent's delegation is narrow, the workload is authorized for what it did, the database accepted an authenticated request. The tool-call log alone shows an authorized workload doing an allowed thing. Only the chain shows that no principal in it granted the authority used.
      </P>
    ),
    example: (
      <P>
        OperationsAgent delegated only <C>ledger.read</C> to ReconciliationAgent (<C>del-ops-recon</C>). At 11:47 ReconciliationAgent posts journal JE-2026-0931 through LedgerPost, which runs as <C>wl-recon-04</C>. That workload holds standing <C>ledger.read</C> and <C>ledger.write</C>, so the write succeeds (evt-0042). The gateway recorded ALLOW. REGENT derives DENY, because <C>ledger.write</C> is outside ReconciliationAgent's effective scope.
      </P>
    ),
    viz: (
      <div className="flex flex-col gap-4">
        <AuthorityFlow stages={deputyFlow} height={230} />
        <Scopes
          rows={[
            ['Effective (delegated)', ['ledger.read']],
            ['wl-recon-04 standing', ['ledger.read', 'ledger.write']],
            ['Exercised on evt-0042', ['ledger.read', 'ledger.write'], ['ledger.write']],
          ]}
        />
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          Decision on evt-0042: <DecisionBadge decision="DENY" recorded="ALLOW" />
        </div>
      </div>
    ),
    vizCaption: 'The hatched swell is authority that enters at the action, where no delegation conveyed it. The excess permission is marked + and labelled "not granted" for screen readers.',
    tryIt: [
      { to: '/app/chains/evt-0042', label: 'Open evt-0042', note: 'The reconstructed chain, authority diff and finding.' },
      { to: '/app/scenarios', label: 'Scenario 4: authority amplification', note: 'The same pattern, isolated in a minimal chain.' },
    ],
  },
  {
    slug: 'authority-amplification',
    title: 'Authority amplification',
    kicker: 'Authority appears in a chain where no delegation conveyed it.',
    concept: (
      <>
        <P>
          Authority amplification is any point where a principal ends up holding or exercising authority that no delegation in its chain conveyed. REGENT enforces two invariants: a delegation may not grant more than the delegator's effective scope (<C>Granted ⊆ Effective(delegator)</C>, AUTH-010), and an action may not exercise more than the actor's effective scope (<C>Exercised ⊆ Effective</C>, AUTH-001).
        </P>
        <P>Amplification can enter at the grant (a delegation over-grants) or at the action (a tool or credential supplies authority from outside the chain, as in a confused deputy).</P>
      </>
    ),
    why: (
      <P>
        Amplification at the grant is latent. Nothing has gone wrong yet, but the moment the delegatee uses the extra permission it acts beyond anything a human approved. REGENT locates the exact hop where the excess entered, so the fix lands on the right contract instead of on the agent that happened to use it.
      </P>
    ),
    example: (
      <P>
        SupportAgent holds <C>customer.read</C>, <C>ticket.read</C>, <C>ticket.write</C> and <C>email.draft</C> from Daniel Okafor. It delegates <C>email.draft</C>, <C>ticket.read</C> and <C>customer.write</C> to ReplyDraftAgent (<C>del-support-reply</C>). <C>customer.write</C> was never SupportAgent's to give, so REGENT reports amplification on that delegation, and ReplyDraftAgent's effective scope is only <C>email.draft</C> and <C>ticket.read</C>. ReplyDraftAgent only drafted an email, so its action stays contained.
      </P>
    ),
    viz: (
      <div className="flex flex-col gap-4">
        <AuthorityFlow stages={amplificationFlow} height={230} />
        <Scopes
          rows={[
            ['SupportAgent effective', ['customer.read', 'email.draft', 'ticket.read', 'ticket.write']],
            ['Granted to ReplyDraftAgent', ['customer.write', 'email.draft', 'ticket.read'], ['customer.write']],
            ['ReplyDraftAgent effective', ['email.draft', 'ticket.read']],
          ]}
        />
      </div>
    ),
    vizCaption: 'Amplification at the grant: the hatched excess enters at ReplyDraftAgent. Effective scope never includes it, because effective scope cannot contain what the delegator did not hold.',
    tryIt: [
      { to: '/app/delegations/del-support-reply', label: 'Open del-support-reply', note: 'The over-granting delegation as a contract.' },
      { to: '/app/scenarios', label: 'Scenario 9: sub-agent receives excessive scope', note: 'Amplification at the grant, before anyone uses it.' },
      { to: '/app/chains/evt-0042', label: 'Open evt-0042', note: 'Amplification at the action, for contrast.' },
    ],
  },
  {
    slug: 'workload-identity',
    title: 'Workload identity',
    kicker: 'The identity of the running software, which is not the principal acting.',
    concept: (
      <>
        <P>
          A workload identity names running software: a process, container or function. In REGENT it is the execution identity an action runs as. It is not a principal and never appears as a delegation hop. The agent is who acts with delegated authority; the execution identity is what the infrastructure authenticated.
        </P>
        <P>
          A credential (an SVID, an OAuth access token, an API key) is evidence that the execution identity authenticated. AUTH-006 requires a credential binding: the execution identity is issued to the acting agent, and the credential is bound to that execution identity.
        </P>
      </>
    ),
    why: (
      <P>
        Infrastructure authorizes the workload, not the delegation. When a workload holds standing permissions, or is shared between agents, the infrastructure's view of who acted and the delegation chain's view of who was allowed to act come apart.
      </P>
    ),
    example: (
      <P>
        InvoiceAgent runs as <C>wl-invoice-07</C> and authenticates with <C>svid-invoice-07</C>, which is bound to that identity. Every link matches. Contrast <C>wl-recon-04</C>: correctly issued to ReconciliationAgent, but provisioned with standing <C>ledger.write</C> that ReconciliationAgent's delegation never granted. That standing scope is what made evt-0042 possible.
      </P>
    ),
    viz: (
      <NodeChain
        label="InvoiceAgent's execution path"
        edges={['runs as', 'authenticates with']}
        nodes={[
          { role: 'Principal · sub-agent', label: 'InvoiceAgent', sub: 'agent-invoice', tone: 'copper' },
          { role: 'Execution identity', label: 'wl-invoice-07', sub: 'spiffe://acme.example.test/workload/wl-invoice-07', extra: <ScopeChips scope={['invoice.approve', 'invoice.read', 'invoice.write']} tone="muted" /> },
          { role: 'Credential · SPIFFE SVID', label: 'svid-invoice-07', sub: 'bound to wl-invoice-07' },
        ]}
      />
    ),
    vizCaption: 'Principal, execution identity and credential are three different things. The muted chips are the workload\'s standing scope, which REGENT never treats as delegated authority.',
    tryIt: [
      { to: '/app/credentials', label: 'Credential lineage', note: 'Every credential, what it is bound to, and when it was valid.' },
      { to: '/app/scenarios', label: 'Scenario 6: credential mismatch', note: 'A credential bound to a different identity.' },
    ],
  },
  {
    slug: 'oauth-delegation',
    title: 'OAuth delegation',
    kicker: 'Token exchange and the actor claim: the standard shape of a delegation hop.',
    concept: (
      <>
        <P>
          OAuth 2.0 (RFC 6749) lets a client obtain an access token to call an API on a resource owner's behalf, limited by scope. OAuth 2.0 Token Exchange (RFC 8693) expresses delegation between services: a client presents a <C>subject_token</C> (whose authority) and optionally an <C>actor_token</C> (who is acting), and the authorization server issues a new token.
        </P>
        <P>
          The issued token can carry an <C>act</C> (actor) claim naming the current actor. Nested <C>act</C> claims record prior actors in the chain. RFC 8693 says only the outermost, current actor is considered for access control; the nested ones are informational.
        </P>
      </>
    ),
    why: (
      <P>
        Token exchange is the closest standard mechanism to an agent delegation hop, but a token is a point-in-time grant. It does not record what it was later used for, and nothing in the protocol obliges the server to narrow scope at each exchange. REGENT checks from the records that narrowing actually happened.
      </P>
    ),
    example: (
      <P>
        In an OAuth deployment of the Acme finance chain, OperationsAgent would exchange a token whose subject is Maya Chen for a token for InvoiceAgent, scoped to <C>invoice.read invoice.approve</C>, with InvoiceAgent as the current actor and OperationsAgent nested inside. REGENT records the same facts as delegation <C>del-ops-invoice</C> with parent <C>del-maya-ops</C>.
      </P>
    ),
    viz: (
      <div className="flex flex-col gap-2">
        <CodeBlock
          value={`{
  "iss": "https://as.acme.example.test",
  "sub": "maya.chen",
  "aud": "invoice-api",
  "scope": "invoice.read invoice.approve",
  "act": {
    "sub": "invoice-agent",
    "act": { "sub": "operations-agent" }
  }
}`}
        />
        <p className="text-[11.5px] text-ink-3">Illustrative claims only. The Acme demo contains REGENT delegation records, not tokens.</p>
      </div>
    ),
    vizCaption: 'Subject = whose authority; outer act = who is acting now; nested act = who acted before. REGENT\'s equivalent is the delegation chain.',
    tryIt: [
      { to: '/app/delegations/del-ops-invoice', label: 'Open del-ops-invoice', note: 'The REGENT record for this hop.' },
      { to: '/app/standards', label: 'Standards mapping', note: 'How each OAuth concept maps onto REGENT.' },
    ],
  },
  {
    slug: 'oidc',
    title: 'OpenID Connect',
    kicker: 'Who the human at the root of the chain is.',
    concept: (
      <>
        <P>
          OpenID Connect is an identity layer on OAuth 2.0. An OpenID Provider issues an ID token: a signed JWT stating that an end-user (<C>sub</C>) was authenticated by an issuer (<C>iss</C>) for a client (<C>aud</C>). The pair (<C>iss</C>, <C>sub</C>) identifies the user stably.
        </P>
        <P>An ID token is an authentication result for the client. It is not an access token and does not authorize API calls.</P>
      </>
    ),
    why: (
      <P>
        Every delegation chain should start at an authenticated human principal. A chain that starts at an agent, or at a principal from an unknown issuer, is not attributable, however correct each hop is.
      </P>
    ),
    example: (
      <P>
        Maya Chen is the root principal <C>human-maya</C>. Her principal record carries an issuer field next to her principal id, the same pair an ID token asserts, and REGENT treats her provisioned scope as the ceiling of what she can delegate. NightlySyncAgent has no human root at all: at 02:16 it writes 412 customer records (evt-0035) with no delegation, so the action is unattributable.
      </P>
    ),
    viz: (
      <ComparePair
        caption="OpenID Connect ID token claims compared with REGENT principal fields"
        left="ID token claim"
        right="REGENT principal field"
        rows={[
          ['Issuer', <code className="font-mono">iss</code>, <code className="font-mono">issuer</code>],
          ['Subject', <code className="font-mono">sub</code>, <code className="font-mono">principal_id</code>],
          ['Name', <code className="font-mono">name</code>, <code className="font-mono">display_name</code>],
          ['Signature', 'Verified by the client', 'Not verified. REGENT reads identity records; it does not validate tokens.'],
        ]}
      />
    ),
    vizCaption: 'REGENT represents the root principal with the facts an ID token asserts, but it reads records rather than validating tokens.',
    tryIt: [
      { to: '/app/identities/human-maya', label: 'Open Maya Chen', note: 'A root principal with her delegations and actions.' },
      { to: '/app/chains/evt-0035', label: 'Open evt-0035', note: 'An action with no human root.' },
      { to: '/app/scenarios', label: 'Scenario 5: missing delegated user', note: 'A chain started by a scheduler, not a person.' },
    ],
  },
  {
    slug: 'spiffe',
    title: 'SPIFFE and SPIRE',
    kicker: 'Attested, short-lived workload identity. Identity, not authority.',
    concept: (
      <>
        <P>
          SPIFFE is a set of specifications for identifying workloads. A SPIFFE ID is a URI, <C>spiffe://trust-domain/path</C>. An SVID (SPIFFE Verifiable Identity Document) carries it, as an X.509 certificate or a JWT. SPIRE is a SPIFFE implementation that attests a workload (proves what is running, and where) before issuing it short-lived SVIDs.
        </P>
        <P>An SVID identifies a workload. It says nothing about what that workload may do.</P>
      </>
    ),
    why: (
      <P>
        Attested, rotating workload identity removes shared static secrets. It does not bound authority: an agent running under a perfectly valid SVID can still exercise authority no delegation granted.
      </P>
    ),
    example: (
      <P>
        ReconciliationAgent runs as <C>spiffe://acme.example.test/workload/wl-recon-04</C> and authenticates with <C>svid-recon-04</C>. On evt-0042 the identity and credential binding checks pass: the SVID was valid and bound correctly. The failure is in authority and scope: the workload's standing <C>ledger.write</C> was used where the delegation conveyed only <C>ledger.read</C>.
      </P>
    ),
    viz: (
      <div className="flex flex-col gap-3">
        <NodeChain
          label="evt-0042 execution path"
          edges={['runs as', 'presents']}
          nodes={[
            { role: 'Principal · sub-agent', label: 'ReconciliationAgent', sub: 'agent-recon', tone: 'copper' },
            { role: 'Execution identity', label: 'wl-recon-04', sub: 'spiffe://acme.example.test/workload/wl-recon-04' },
            { role: 'Credential · SPIFFE SVID', label: 'svid-recon-04', sub: 'bound to wl-recon-04' },
          ]}
        />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Check results on evt-0042 in the demo run">
          {(
            [
              ['Identity', 'PASS'],
              ['Credential binding', 'PASS'],
              ['Authority', 'FAIL'],
              ['Scope', 'FAIL'],
            ] as const
          ).map(([k, r]) => (
            <div key={k} className="rounded border hairline px-2.5 py-2">
              <dt className="eyebrow mb-1">{k}</dt>
              <dd>
                <ResultBadge result={r} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    ),
    vizCaption: 'Check results for evt-0042 in the demo run. Open the chain to see them computed live.',
    tryIt: [
      { to: '/app/chains/evt-0042', label: 'Open evt-0042', note: 'Identity passes; authority fails.' },
      { to: '/app/credentials', label: 'Credential lineage', note: 'SVIDs, tokens and keys with their bindings.' },
      { to: '/app/scenarios', label: 'Scenario 7: revoked credential', note: 'A credential used after revocation.' },
    ],
  },
  {
    slug: 'action-time-authorization',
    title: 'Action-time authorization',
    kicker: 'Authorize when the action executes, not when the session started.',
    concept: (
      <>
        <P>
          Action-time authorization evaluates the decision when the action executes, against the delegation, identity and credential state at that instant. Provision-time authorization evaluates once (at session start, or when a token is issued) and reuses the result.
        </P>
        <P>
          REGENT compares each action's recorded <C>authorization_evaluated_at</C> with revocation and expiry in the evidence, and re-derives the decision at the action timestamp (AUTH-005).
        </P>
      </>
    ),
    why: <P>Revocation only works if something checks it. A cached ALLOW keeps working after the human withdrew the delegation, so the agent outlives its authority.</P>,
    example: (
      <P>
        Daniel Okafor revoked SupportAgent's delegation (<C>del-daniel-support</C>) at 14:00. At 14:40 SupportAgent closed ticket TCK-4433 through TicketUpdate, on a decision evaluated at 13:30 and served from a session grant cache (evt-0901). The gateway recorded ALLOW; REGENT's action-time decision is DENY. The same gateway correctly refused CustomerLookupAgent's lookup at 14:55.
      </P>
    ),
    viz: (
      <div className="flex flex-col gap-3">
        <ActionTimeTimeline />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-2">
            Provision-time <DecisionBadge decision="ALLOW" />
          </span>
          <span className="inline-flex items-center gap-2">
            Action-time <DecisionBadge decision="DENY" />
          </span>
        </div>
      </div>
    ),
    vizCaption: 'evt-0901 from the demo dataset. The hatched segment is time spent acting on a delegation that no longer existed.',
    tryIt: [
      { to: '/app/chains/evt-0901', label: 'Open evt-0901', note: 'The temporal check and the finding.' },
      { to: '/app/action-time', label: 'Action-time auth', note: 'Provision-time versus action-time decisions side by side.' },
      { to: '/app/time-travel', label: 'Time travel', note: 'The authority that existed at any instant.' },
    ],
  },
  {
    slug: 'auditability',
    title: 'Auditability',
    kicker: 'Reconstructing a decision from records alone.',
    concept: (
      <>
        <P>
          A system is auditable when a third party can reconstruct, from records alone, who acted, under whose authority, with which credential, under which policy version, and why the decision came out as it did.
        </P>
        <P>
          REGENT measures record completeness against a schema (<C>regent.action-record/v1</C>, 20 fields) and treats missing evidence as UNKNOWN. A missing field never makes a check pass.
        </P>
      </>
    ),
    why: (
      <P>
        An incomplete record cannot prove misuse, and it cannot prove legitimacy either. REGENT keeps those apart: missing evidence produces an incomplete or unattributable result, not a violation and not a clean bill of health.
      </P>
    ),
    example: (
      <P>
        NightlySyncAgent wrote 412 customer records at 02:16 (evt-0035). The record names the tool, resource, execution identity and credential, but not the root principal, delegation, requested scope, policy version, decision reason or evaluation time. 14 of 20 fields are present, 70% complete, and the action is unattributable.
      </P>
    ),
    viz: (
      <FieldChecklist
        label="Fields in the evt-0035 action record"
        present={['event_id', 'timestamp', 'actor_principal_id', 'tool_id', 'resource_id', 'operation', 'parameters', 'exercised_scope', 'execution_identity_id', 'credential_id', 'policy_id', 'recorded_decision', 'approval_state', 'downstream_result']}
        missing={['root_principal_id', 'delegation_id', 'requested_scope', 'policy_version', 'decision_reason', 'authorization_evaluated_at']}
      />
    ),
    vizCaption: 'Record completeness for evt-0035 in the demo run. Missing fields are amber (incomplete), not crimson: absence is not proof of misuse.',
    tryIt: [
      { to: '/app/chains/evt-0035', label: 'Open evt-0035', note: 'An unattributable action and its missing fields.' },
      { to: '/app/import', label: 'Import events', note: 'See which of your own fields REGENT can and cannot read.' },
    ],
  },
  {
    slug: 'non-repudiation',
    title: 'Non-repudiation',
    kicker: 'Proof of origin needs signatures. REGENT\'s digests detect change; they are not signatures.',
    concept: (
      <>
        <P>
          Non-repudiation means the originator of a record cannot credibly deny creating it. It needs a digital signature made with a key only the originator controls, plus trustworthy key custody and timestamps. A hash alone does not provide it: anyone can recompute the hash of a modified record.
        </P>
        <P>
          REGENT computes a SHA-256 digest over the canonical JSON of each normalized record, and every finding cites the digests of its evidence. A digest shows whether a record changed after ingestion. It does not show who created the record, and REGENT does not sign records. Non-repudiation has to come from signing at the system that produced them.
        </P>
      </>
    ),
    why: <P>Agent audit trails are often cited as proof of who did what. Without signatures at the source, they show what was recorded, not who recorded it.</P>,
    example: (
      <P>
        The amplification finding on evt-0042 cites the action record and both delegation records (<C>del-maya-ops</C>, <C>del-ops-recon</C>) by digest. If someone later edited <C>del-ops-recon</C> to grant <C>ledger.write</C>, its digest would change and the evidence package would no longer match. Nothing in the digest says who wrote the original record.
      </P>
    ),
    viz: (
      <ComparePair
        caption="SHA-256 digest compared with a digital signature"
        left="SHA-256 digest (REGENT)"
        right="Digital signature (not provided)"
        rows={[
          ['Detects change', 'Yes, against the stored digest', 'Yes'],
          ['Binds to an originator', 'No. Anyone can compute it', 'Yes, to the key holder'],
          ['Supports non-repudiation', 'No', 'With key custody and trusted time'],
          ['Where REGENT uses it', 'Evidence references in findings, reports and the evidence package', 'Not used'],
        ]}
      />
    ),
    vizCaption: 'Digests make REGENT\'s evidence tamper-evident against its own stored copy. They are not a substitute for signatures.',
    tryIt: [
      { to: '/app/reports', label: 'Reports & exports', note: 'The evidence package cites every record by digest.' },
      { to: '/app/chains/evt-0042', label: 'Open evt-0042', note: 'Evidence references on a finding.' },
    ],
  },
  {
    slug: 'chain-reconstruction',
    title: 'Chain reconstruction',
    kicker: 'Walking from an action back to the root principal.',
    concept: (
      <>
        <P>
          Chain reconstruction walks from an action back to its root principal: the action's delegation, that delegation's parent, and so on, until it reaches a delegation issued by a root principal. Each link is explicit (a recorded <C>delegation_id</C> or <C>parent_delegation_id</C>) or a lookup (a unique match in the registry).
        </P>
        <P>A missing, ambiguous or dangling reference stops the walk. REGENT reports the break at that edge rather than guessing past it, and bounds chain depth.</P>
      </>
    ),
    why: (
      <P>
        Every other check depends on it. If the chain cannot be followed, effective authority cannot be computed, and REGENT reports the action as unattributable instead of assuming it was authorized.
      </P>
    ),
    example: (
      <P>
        evt-0042 names delegation <C>del-ops-recon</C> (OperationsAgent → ReconciliationAgent), which names its parent <C>del-maya-ops</C> (Maya Chen → OperationsAgent). Maya Chen is a human root principal, so the chain is complete and every link is explicit. In scenario 3, a delegation cites a parent that does not exist, and the chain breaks at that edge.
      </P>
    ),
    viz: (
      <ReconstructionSteps
        label="Reconstruction of evt-0042"
        steps={[
          { kind: 'Action', id: 'evt-0042', note: 'ReconciliationAgent writes to LedgerDB through LedgerPost.', link: 'delegation_id →' },
          { kind: 'Delegation hop 2', id: 'del-ops-recon', note: 'OperationsAgent → ReconciliationAgent, granted ledger.read.', link: 'parent_delegation_id →' },
          { kind: 'Delegation hop 1', id: 'del-maya-ops', note: 'Maya Chen → OperationsAgent, five finance permissions.', link: 'delegator →' },
          { kind: 'Root principal', id: 'human-maya', note: 'Maya Chen, a human principal. Chain complete.', tone: 'sage' },
        ]}
      />
    ),
    vizCaption: 'Every link in this chain is explicit. A link found only by registry lookup is shown as such in the chain view.',
    tryIt: [
      { to: '/app/chains/evt-0042', label: 'Open evt-0042', note: 'The delegation graph for this chain.' },
      { to: '/app/scenarios', label: 'Scenario 3: broken parent chain', note: 'A chain that cannot be followed.' },
      { to: '/app/builder', label: 'Build a chain', note: 'Remove a parent reference and watch the chain break.' },
    ],
  },
]
