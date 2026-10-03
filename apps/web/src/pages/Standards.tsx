import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../ui/primitives'

/**
 * Conceptual mapping between REGENT's model and six identity and authorization
 * standards. Static content; no verdicts. Nothing here is a conformance claim.
 */

type Row = [regent: string, standard: ReactNode, represents: ReactNode]

interface Standard {
  id: string
  name: string
  short: string
  refs: string
  summary: string
  rows: Row[]
  gap: string
}

const M = ({ children }: { children: ReactNode }) => <code className="font-mono text-[11.5px] text-ink">{children}</code>

const STANDARDS: Standard[] = [
  {
    id: 'oauth',
    name: 'OAuth 2.x',
    short: 'Delegated access tokens',
    refs: 'RFC 6749, RFC 8693 (Token Exchange), RFC 7009 (Revocation), RFC 8707 (Resource Indicators), OAuth 2.1 draft',
    summary: 'OAuth issues scoped access tokens to a client acting for a resource owner. Token exchange is the closest standard shape of an agent delegation hop.',
    rows: [
      ['Delegation', <>Token exchange: a subject token (whose authority) and an actor token (who acts) traded for a new token</>, <>A delegation record: delegator, delegatee, <M>granted_scope</M>, <M>parent_delegation_id</M>, validity window</>],
      ['Delegation chain', <>Nested <M>act</M> claims recording prior actors; only the outermost actor counts for access control</>, <>Delegations linked by <M>parent_delegation_id</M> back to the root principal, each hop verified</>],
      ['Granted scope', <><M>scope</M> on the token request and the issued token</>, <><M>granted_scope</M>: a sorted set of permissions such as <M>invoice.read</M>, with optional trailing wildcard</>],
      ['Credential', 'Access token presented to the resource server', <>Credential of type <M>oauth_access_token</M>, bound to an execution identity</>],
      ['Revocation', 'Token revocation endpoint and short token lifetimes', <><M>revoked_at</M> on delegations and credentials, checked at action time (AUTH-005)</>],
      ['Resource', <>Audience (<M>aud</M>) and resource indicators</>, <><M>resource_id</M> on the action record</>],
    ],
    gap: 'REGENT does not issue, introspect or validate tokens. It reads the records that a token exchange would have produced and checks that scope narrowed at each hop.',
  },
  {
    id: 'oidc',
    name: 'OpenID Connect',
    short: 'Who the human principal is',
    refs: 'OpenID Connect Core 1.0',
    summary: 'OIDC adds authentication to OAuth: an ID token asserts that an end-user was authenticated by an issuer.',
    rows: [
      ['Human principal / root principal', <>End-user authenticated by an OpenID Provider, identified by <M>iss</M> + <M>sub</M></>, <>Principal of type <M>human</M>, root-eligible, with <M>issuer</M> and <M>principal_id</M></>],
      ['Attribution', <>The <M>sub</M> claim identifying the user to the relying party</>, <><M>root_principal_id</M> on each action record, verified by chain reconstruction</>],
      ['Principal display name', <>Standard claims such as <M>name</M></>, <><M>display_name</M></>],
    ],
    gap: 'REGENT does not validate ID tokens or their signatures. An ID token authenticates a user to a client; it is not the delegation, and REGENT never treats it as one.',
  },
  {
    id: 'spiffe',
    name: 'SPIFFE / SPIRE',
    short: 'Workload identity',
    refs: 'SPIFFE ID, X.509-SVID and JWT-SVID specifications; SPIRE',
    summary: 'SPIFFE names workloads with URIs and issues them verifiable identity documents. SPIRE attests a workload before issuing short-lived SVIDs.',
    rows: [
      ['Execution identity', <>SPIFFE ID, e.g. <M>spiffe://acme.example.test/workload/wl-recon-04</M></>, <>Execution identity with <M>spiffe_id</M> and the principal it was issued to (<M>bound_principal_id</M>)</>],
      ['Credential', 'X.509-SVID or JWT-SVID', <>Credential of type <M>spiffe_svid</M>, bound to one execution identity</>],
      ['Credential binding', 'SVID issued to an attested workload', <>AUTH-006: the credential is bound to the execution identity, which is issued to the acting agent</>],
      ['Provisioned scope', 'Not part of SPIFFE. An SVID carries identity, not authorization', <><M>provisioned_scope</M> on the execution identity, recorded but never counted as delegated authority</>],
    ],
    gap: 'REGENT does not attest workloads or verify SVIDs. It records which identity and credential an action used and whether they bind to the acting agent.',
  },
  {
    id: 'scim',
    name: 'SCIM',
    short: 'Identity lifecycle',
    refs: 'RFC 7643 (core schema), RFC 7644 (protocol)',
    summary: 'SCIM provisions and deprovisions users and groups across systems through a standard schema and REST protocol.',
    rows: [
      ['Principal lifecycle', <>User resource with the <M>active</M> attribute; provisioning and deprovisioning</>, <>Principal <M>recorded_status</M> and <M>suspended_at</M>, checked at the action timestamp</>],
      ['Orphaned principal', 'No direct equivalent. The core schema has no agent-to-owner relation', <>Represented as delegation: an agent that acts with no delegation from a root principal is an orphaned principal</>],
      ['Group-based access', 'Group resources and membership', 'Not represented. REGENT models authority as scopes conveyed by delegation, not group membership'],
    ],
    gap: 'REGENT does not speak SCIM. It reads lifecycle state from the evidence, so a deprovisioning event only matters if it is in the records.',
  },
  {
    id: 'ngac',
    name: 'NGAC',
    short: 'Attribute-based policy graphs',
    refs: 'Next Generation Access Control (NIST; ANSI INCITS 499)',
    summary: 'NGAC expresses policy as a graph of users, objects, attributes, policy classes, associations, prohibitions and obligations.',
    rows: [
      ['Policy and policy version', 'Policy classes, assignments and associations', <><M>policy_id</M> and <M>policy_version</M> recorded with each decision, plus scope ceiling and approval requirements</>],
      ['Effective scope', 'Privileges derived by traversing assignments and associations', <><M>effective_scope</M> = granted ∩ delegator's effective ∩ policy ceiling, computed per hop</>],
      ['Restricted authority', 'Prohibitions', 'Permissions removed by a policy ceiling, shown struck through in the authority diff'],
      ['Approval state', 'Obligations (event-triggered responses), the closest analogue', <>AUTH-008: permissions marked as requiring approval are exercised only with <M>approval_state = APPROVED</M></>],
    ],
    gap: 'REGENT does not evaluate NGAC policy graphs. It reads the policy the system under audit recorded and checks that the decision cites an exact version.',
  },
  {
    id: 'mcp',
    name: 'Model Context Protocol',
    short: 'Agent-to-tool calls',
    refs: 'MCP specification: tools, authorization, security best practices',
    summary: 'MCP connects AI applications (clients) to servers that expose tools and resources. Its authorization model for HTTP transports builds on OAuth 2.1, with MCP servers acting as OAuth resource servers.',
    rows: [
      ['Tool', <>Tool exposed by an MCP server and invoked with <M>tools/call</M></>, <>Tool record (<M>tool_id</M>, kind) and <M>tool_id</M> on the action</>],
      ['Execution path', 'Client → MCP server → downstream system', 'Actor → tool → execution identity → credential → resource, kept separate from the delegation chain'],
      ['Authorization', 'OAuth 2.1 access token presented to the MCP server', 'Credential plus delegation: REGENT checks that the authority the token carried was delegated to the acting agent'],
      ['Authority amplification', 'The confused deputy problem and the token-passthrough anti-pattern described in MCP security guidance', <>AUTHORITY_AMPLIFICATION when a tool exercises authority beyond the chain, as on <Link to="/app/chains/evt-0042" className="text-copper-ink underline-offset-2 hover:underline">evt-0042</Link></>],
    ],
    gap: 'REGENT is not an MCP server, client or gateway, and does not intercept tool calls. It verifies records of calls after the fact.',
  },
]

export default function Standards() {
  return (
    <div>
      <PageHeader
        eyebrow="Learn · Standards"
        title="Standards mapping"
        description="How REGENT's model lines up with six identity and authorization standards. Each row reads: REGENT concept → related standard concept → how REGENT represents it."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="std-context" className="panel p-4">
          <h2 id="std-context" className="eyebrow mb-2">
            Why these six
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            The NIST National Cybersecurity Center of Excellence concept paper on software and AI agent identity and authorization (5 February 2026) names OAuth 2.x, OpenID Connect, SPIFFE/SPIRE, SCIM, NGAC and the Model Context Protocol as the standards relevant to identifying and authorizing agents. Singapore IMDA's Model AI Governance Framework for Agentic AI (22 January 2026) asks organizations to give agents identities and keep an audit trail of which agent acted under whose authorization.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Read together, they point at one gap: each standard covers one link, and none of them, alone, answers whether authority stayed within what a human delegated across the whole chain. That question is what REGENT checks.
          </p>
        </section>
        <section aria-labelledby="std-disclaimer" className="rounded-md border border-dashed border-amber/50 bg-amber/[0.05] p-4">
          <h2 id="std-disclaimer" className="mb-2 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] text-amber-ink">
            <span aria-hidden>!</span> Conceptual mapping only
          </h2>
          <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-ink-2">
            <li>These mappings are conceptual. They describe where ideas correspond, not interoperability.</li>
            <li>REGENT does not implement these standards and does not claim formal compliance or certification with any of them.</li>
            <li>Nothing here has been validated against a conformance suite.</li>
          </ul>
        </section>
      </div>

      <nav aria-label="Standards on this page" className="mb-5 flex flex-wrap gap-1.5">
        {STANDARDS.map((s) => (
          <a key={s.id} href={`#std-${s.id}`} className="inline-flex h-7 items-center rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-copper/50 hover:text-ink">
            {s.name}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        {STANDARDS.map((s) => (
          <StandardPanel key={s.id} s={s} />
        ))}
      </div>

      <p className="mt-6 text-[12.5px] text-ink-3">
        For the concepts themselves, with examples from the demo dataset, see{' '}
        <Link to="/app/learn?c=oauth-delegation" className="text-copper-ink underline-offset-2 hover:underline">
          OAuth delegation
        </Link>
        ,{' '}
        <Link to="/app/learn?c=oidc" className="text-copper-ink underline-offset-2 hover:underline">
          OpenID Connect
        </Link>{' '}
        and{' '}
        <Link to="/app/learn?c=spiffe" className="text-copper-ink underline-offset-2 hover:underline">
          SPIFFE and SPIRE
        </Link>{' '}
        in learning mode.
      </p>
    </div>
  )
}

function StandardPanel({ s }: { s: Standard }) {
  return (
    <section id={`std-${s.id}`} aria-labelledby={`std-${s.id}-title`} className="panel scroll-mt-20">
      <header className="flex flex-col gap-1 border-b hairline px-4 py-3 md:flex-row md:items-baseline md:justify-between">
        <div className="min-w-0">
          <h2 id={`std-${s.id}-title`} className="text-[15px] font-medium text-ink">
            {s.name} <span className="font-normal text-ink-3">· {s.short}</span>
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{s.summary}</p>
        </div>
        <p className="shrink-0 font-mono text-[10.5px] text-ink-3 md:max-w-[40%] md:text-right">{s.refs}</p>
      </header>

      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <caption className="sr-only">{s.name}: REGENT concept, related standard concept, and how REGENT represents it</caption>
          <thead>
            <tr className="border-b hairline-strong">
              <th scope="col" className="eyebrow w-[22%] px-4 py-2 font-normal">REGENT concept</th>
              <th scope="col" className="eyebrow w-[36%] px-3 py-2 font-normal">Related standard concept</th>
              <th scope="col" className="eyebrow px-4 py-2 font-normal">How REGENT represents it</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map(([r, std, rep]) => (
              <tr key={r} className="border-b hairline align-top last:border-b-0">
                <th scope="row" className="px-4 py-2.5 font-medium text-ink">{r}</th>
                <td className="px-3 py-2.5 text-ink-2">{std}</td>
                <td className="px-4 py-2.5 text-ink-2">{rep}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden">
        {s.rows.map(([r, std, rep]) => (
          <li key={r} className="border-b hairline px-4 py-3 last:border-b-0">
            <h3 className="text-[13px] font-medium text-ink">{r}</h3>
            <dl className="mt-1.5 flex flex-col gap-1.5 text-[12.5px]">
              <div>
                <dt className="eyebrow">Related standard concept</dt>
                <dd className="text-ink-2">{std}</dd>
              </div>
              <div>
                <dt className="eyebrow">How REGENT represents it</dt>
                <dd className="text-ink-2">{rep}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <p className="border-t hairline px-4 py-2.5 text-[12px] leading-relaxed text-ink-3">
        <span className="font-medium text-ink-2">Not covered. </span>
        {s.gap}
      </p>
    </section>
  )
}
