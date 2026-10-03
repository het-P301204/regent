import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CodeBlock } from '../../ui/data'
import { ResultBadge } from '../../ui/status'
import { cx } from '../../ui/primitives'
import { ApiReference } from './ApiReference'

/* ------------------------------------------------------------- typography */

const H3 = ({ children, id }: { children: ReactNode; id?: string }) => (
  <h3 id={id} className="mb-2 mt-9 scroll-mt-20 text-[16px] font-medium text-ink first:mt-0">
    {children}
  </h3>
)
const P = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cx('mb-3.5 max-w-[72ch] text-[14px] leading-[1.7] text-ink-2', className)}>{children}</p>
const C = ({ children }: { children: ReactNode }) => <code className="rounded-[3px] bg-s2 px-1 py-px font-mono text-[12.5px] text-ink">{children}</code>
const UL = ({ children }: { children: ReactNode }) => <ul className="mb-4 max-w-[72ch] list-disc space-y-1.5 pl-5 text-[14px] leading-[1.65] text-ink-2 marker:text-ink-4">{children}</ul>
const OL = ({ children }: { children: ReactNode }) => <ol className="mb-4 max-w-[72ch] list-decimal space-y-1.5 pl-5 text-[14px] leading-[1.65] text-ink-2 marker:font-mono marker:text-[12px] marker:text-ink-3">{children}</ol>
const Code = ({ children }: { children: string }) => <CodeBlock value={children} className="mb-4 max-w-[86ch]" />
const Note = ({ children }: { children: ReactNode }) => <div className="mb-4 max-w-[72ch] rounded border border-dashed hairline-strong px-4 py-3 text-[13px] leading-relaxed text-ink-2">{children}</div>
const A = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-copper-ink underline-offset-2 hover:underline">
    {children}
  </Link>
)

function Table({ caption, head, rows, mono = [0] }: { caption: string; head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="mb-5 max-w-[96ch] overflow-x-auto rounded border hairline">
      <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b hairline-strong bg-s1">
            {head.map((h) => (
              <th key={h} scope="col" className="eyebrow px-3 py-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b hairline align-top last:border-b-0">
              {r.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className={cx('px-3 py-2 text-left font-normal text-ink', mono.includes(0) && 'font-mono text-[12px]')}>
                    {cell}
                  </th>
                ) : (
                  <td key={j} className={cx('px-3 py-2 text-ink-2', mono.includes(j) && 'font-mono text-[12px]')}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------------------------------------------------------- sections */

export interface DocSection {
  slug: string
  title: string
  group: string
  lead: string
  body: () => ReactNode
}

export const DOC_SECTIONS: DocSection[] = [
  {
    slug: 'overview',
    title: 'Overview',
    group: 'Start',
    lead: 'REGENT reconstructs the authority chain behind AI-agent actions and verifies that delegated authority never silently expands.',
    body: () => (
      <>
        <P>
          An AI agent rarely acts on its own authority. A human principal delegates to an agent, the agent spawns sub-agents, a sub-agent calls a tool, the tool runs as a workload identity with a credential, and the credential reaches a resource. When something goes wrong, the questions are always the same:
        </P>
        <UL>
          <li>Who authorized this action, and through which delegation chain?</li>
          <li>Did authority stay within what each delegator actually held?</li>
          <li>Did the action run under an identity and credential bound to the agent that took it?</li>
          <li>Was the authority still valid at the moment the action executed?</li>
        </UL>
        <P>REGENT answers them from records. It ingests evidence, reconstructs one chain per action, checks it against a fixed set of invariants, and reports findings that point at the exact edge where an invariant broke.</P>
        <H3>Three structures, kept apart</H3>
        <UL>
          <li>
            <strong className="font-medium text-ink">Delegation chain</strong>: who delegated authority to whom (delegations).
          </li>
          <li>
            <strong className="font-medium text-ink">Execution path</strong>: how the action reached its target (actor → tool → execution identity → credential → resource).
          </li>
          <li>
            <strong className="font-medium text-ink">Evidence chain</strong>: which records prove it (evidence references with SHA-256 digests).
          </li>
        </UL>
        <P>Tools, execution identities, credentials and resources are never principals and never appear as delegation hops.</P>
        <H3>How it is built</H3>
        <Table
          caption="REGENT components"
          head={['Component', 'Role']}
          rows={[
            ['packages/core', 'The deterministic engine: normalization, chain reconstruction, verification, findings, replay. Pure: no I/O, no clock, no randomness.'],
            ['apps/api', 'REST API (Hono). Stores datasets and runs in PostgreSQL or embedded PGlite, runs the engine server-side, serves reports.'],
            ['apps/web', 'This console. Visualization only: every verdict it shows comes from the API.'],
            ['apps/cli', 'regent, an offline command line over the same engine.'],
          ]}
        />
        <H3>What REGENT is not</H3>
        <P>
          It is not an identity provider, a policy engine or a gateway, and it does not intercept agent traffic. It verifies records after the fact. It does not claim compliance or certification with any standard; see the <A to="/app/standards">standards mapping</A> for how its model relates to OAuth, OpenID Connect, SPIFFE, SCIM, NGAC and MCP.
        </P>
      </>
    ),
  },
  {
    slug: 'quick-start',
    title: 'Quick start',
    group: 'Start',
    lead: 'Run REGENT locally with the demo dataset in about a minute.',
    body: () => (
      <>
        <H3>From source</H3>
        <P>Requires Node.js 24 or later. The API runs its TypeScript sources directly; there is no server build step.</P>
        <Code>{`npm install
npm run dev
# open http://localhost:5173`}</Code>
        <P>
          <C>npm run dev</C> starts the API on port 8787 with an embedded PGlite database in <C>.data/pglite</C>, and the console on port 5173. Demo mode is on by default: the sign-in page offers four personas (admin, analyst, auditor, viewer) in the fictional Acme AI Operations organization.
        </P>
        <H3>With Docker</H3>
        <Code>{`cp .env.example .env      # set POSTGRES_PASSWORD
docker compose up --build
# open http://127.0.0.1:8787`}</Code>
        <P>
          This runs PostgreSQL on an internal network and the API, which serves the built console from the same origin. Add <C>--profile dev</C> to also run the console with hot reload on port 5173.
        </P>
        <H3>First five minutes</H3>
        <OL>
          <li>Sign in as the analyst persona.</li>
          <li>
            Open <A to="/app">Command Center</A> and pick a violated chain, or go straight to <A to="/app/chains/evt-0042">evt-0042</A>: ReconciliationAgent writing to the ledger with authority nobody delegated.
          </li>
          <li>
            Open <A to="/app/scenarios">Scenario lab</A> and load scenario 11 to see provision-time ALLOW and action-time DENY side by side.
          </li>
          <li>
            Export the <A to="/app/reports">security report</A> (auditor role or higher).
          </li>
        </OL>
      </>
    ),
  },
  {
    slug: 'concepts',
    title: 'Concepts & terminology',
    group: 'Model',
    lead: 'The vocabulary REGENT uses everywhere: in the console, the API, the CLI and the reports.',
    body: () => (
      <>
        <Table
          caption="REGENT terminology"
          head={['Term', 'Meaning']}
          mono={[]}
          rows={[
            ['Principal', 'An authority-bearing identity: a human, an agent, a sub-agent, a workload or a service.'],
            ['Human principal / root principal', 'The principal at the origin of a chain. Humans are root-eligible by default; their provisioned scope is the ceiling of what they can delegate.'],
            ['Delegator / delegatee', 'The principal granting authority, and the principal receiving it.'],
            ['Delegation', 'A record of one grant: delegator, delegatee, granted scope, validity, policy, and the parent delegation it relies on.'],
            ['Delegation hop', 'One delegation within a chain.'],
            ['Delegation chain', 'The delegations linking an action back to its root principal.'],
            ['Granted scope', 'What a delegation says it grants.'],
            ['Requested scope', 'What an action asked to use.'],
            ['Effective scope', "What a principal can legitimately use: granted ∩ the delegator's effective scope ∩ any policy ceiling."],
            ['Exercised scope', 'What an action actually used.'],
            ['Provisioned scope', 'Authority configured before runtime. For an execution identity, its standing scope, never counted as delegated authority.'],
            ['Authority', 'The set of permissions a principal holds at an instant.'],
            ['Authorization / authorization decision', 'A decision to allow an action: ALLOW, DENY, CONDITIONAL or UNKNOWN. REGENT compares the recorded decision with the one it derives.'],
            ['Verification', 'A check result: PASS, WARN, FAIL, UNKNOWN or SKIPPED (rule disabled).'],
            ['Attribution', 'Tracing an action to a root principal through a complete chain.'],
            ['Accountability', 'Being able to name who is answerable for an action: attribution plus evidence that holds up.'],
            ['Execution identity', 'The workload identity an action ran as, e.g. a SPIFFE ID. Not a principal.'],
            ['Credential / credential binding', 'What the execution identity authenticated with, and the requirement that it is bound to that identity.'],
            ['Tool / resource / action', 'What the agent invoked, what it touched, and the recorded event of doing so.'],
            ['Action event / delegation event', 'The source records for an action and for a delegation.'],
            ['Policy / policy version', 'The authorization policy the system under audit recorded, at an exact version.'],
            ['Approval state', 'NOT_REQUIRED, PENDING, APPROVED, REJECTED, EXPIRED or UNKNOWN.'],
            ['Chain completeness', 'Whether every hop is present and cites its parent.'],
            ['Authority amplification', 'Authority appearing in a chain where no delegation conveyed it.'],
            ['Scope violation', 'Exercising a permission outside the effective scope.'],
            ['Unattributable action', 'An action that cannot be traced to a root principal.'],
            ['Orphaned principal', 'An agent acting with no delegation from any root principal.'],
            ['Action-time authorization', 'Evaluating authorization when the action executes, against current delegation and revocation state.'],
          ]}
        />
        <Note>
          A <C>null</C> scope means the evidence did not record it. It is never the same as an empty scope, and REGENT never treats unknown as safe. For worked examples, open <A to="/app/learn">learning mode</A>.
        </Note>
      </>
    ),
  },
  {
    slug: 'delegation-model',
    title: 'Delegation model',
    group: 'Model',
    lead: 'How REGENT represents principals, delegations and the execution path.',
    body: () => (
      <>
        <H3>Records</H3>
        <P>Evidence is a set of typed records. Each carries a stable id; references between them are by id.</P>
        <Table
          caption="Record types"
          head={['record_type', 'Key fields']}
          rows={[
            ['principal', 'principal_id, principal_type (human | agent | sub_agent | workload | service), issuer, provisioned_scope, root_eligible, recorded_status'],
            ['delegation', 'delegation_id, delegator_principal_id, delegatee_principal_id, parent_delegation_id, granted_scope, restrictions, created_at, expires_at, revoked_at, policy_id, policy_version, approval_state'],
            ['execution_identity', 'execution_identity_id, bound_principal_id, spiffe_id, provisioned_scope, issued_at, revoked_at'],
            ['credential', 'credential_id, credential_type, execution_identity_id, issued_at, expires_at, revoked_at'],
            ['tool, resource', 'tool_id / resource_id, display_name, kind'],
            ['policy', 'policy_id, policy_version, scope_ceiling, approval_required_for'],
            ['action', 'event_id, timestamp, root_principal_id, actor_principal_id, delegation_id, execution_identity_id, credential_id, tool_id, resource_id, operation, requested_scope, exercised_scope, policy_id, policy_version, recorded_decision, authorization_evaluated_at, approval_state'],
            ['revocation', 'target_type, target_id, timestamp, reason'],
          ]}
        />
        <P>
          Legacy field names (<C>delegated_user</C>, <C>agent_id</C>, <C>parent_agent</C>, <C>tool</C>, <C>resource</C>, <C>action</C>, <C>decision</C>) are accepted on import and rewritten to the canonical names.
        </P>
        <H3>Chains</H3>
        <P>
          An action names the delegation it relies on. Each delegation issued by a non-root principal names its parent. Reconstruction follows those references to a delegation issued by a root principal. A link that the record does not cite but that a unique registry lookup can resolve is accepted and marked as a lookup, which lowers chain completeness to WARN. A missing, ambiguous or dangling link is a break.
        </P>
        <H3>Example</H3>
        <Code>{`{ "record_type": "delegation", "delegation_id": "del-ops-recon",
  "delegator_principal_id": "agent-ops", "delegatee_principal_id": "agent-recon",
  "parent_delegation_id": "del-maya-ops", "granted_scope": ["ledger.read"],
  "created_at": "2026-10-03T08:03:00Z", "expires_at": "2026-10-03T18:00:00Z" }`}</Code>
        <P>
          The full set of example records lives in <C>examples/events.json</C> and <C>examples/chain.json</C>. The <A to="/app/builder">chain builder</A> produces the same records from a form.
        </P>
      </>
    ),
  },
  {
    slug: 'authority-model',
    title: 'Authority model',
    group: 'Model',
    lead: 'Exercised ⊆ Effective ⊆ Granted ⊆ the delegator\'s Effective. Authority can only narrow.',
    body: () => (
      <>
        <Code>{`Effective(root)       = Provisioned(root)
Effective(delegatee)  = Granted ∩ Effective(delegator) ∩ PolicyCeiling
Exercised  ⊆  Effective  ⊆  Granted  ⊆  Effective(delegator)`}</Code>
        <H3>Permissions and scopes</H3>
        <P>
          A permission is dotted segments such as <C>invoice.read</C>, with an optional trailing wildcard: <C>customer.*</C> covers <C>customer.read</C> and <C>customer.pii.read</C>. A wildcard is only ever trailing. A string that does not parse is kept as an opaque literal that covers only itself; dropping it would let an unparseable exercised permission vanish from the check.
        </P>
        <H3>Invariants</H3>
        <OL>
          <li>
            <strong className="font-medium text-ink">Containment at the action.</strong> <C>Exercised ⊆ Effective</C> (AUTH-001).
          </li>
          <li>
            <strong className="font-medium text-ink">Monotonic delegation.</strong> <C>Granted ⊆ Effective(delegator)</C> (AUTH-010). Excess granted at a hop is amplification located at that hop, and never enters the delegatee's effective scope.
          </li>
          <li>
            <strong className="font-medium text-ink">Attribution.</strong> Every action resolves to a root principal through a complete chain of recorded delegations (AUTH-002, AUTH-003).
          </li>
          <li>
            <strong className="font-medium text-ink">Explicit delegation.</strong> Every agent and sub-agent acts under a recorded delegation with an explicit granted scope. Spawning a sub-agent is a delegation event (AUTH-004).
          </li>
          <li>
            <strong className="font-medium text-ink">Binding.</strong> The execution identity is issued to the acting principal, the credential is bound to that identity, and every referenced identity is known (AUTH-006, AUTH-009).
          </li>
          <li>
            <strong className="font-medium text-ink">Action-time validity.</strong> Every delegation, principal, execution identity and credential the action relies on is valid at the action timestamp, and the decision is evaluated then (AUTH-005).
          </li>
          <li>
            <strong className="font-medium text-ink">Decision evidence.</strong> Each decision records its policy version and requested scope, and permissions the policy marks as privileged are exercised only with recorded approval (AUTH-007, AUTH-008).
          </li>
        </OL>
        <Note>
          Unknown is never safe. When the evidence cannot establish a scope, a root or a validity window, the check reports UNKNOWN and the derived decision is UNKNOWN, not ALLOW. When upstream authority is only partly recorded, the effective scope is treated as an upper bound and containment reports WARN rather than PASS.
        </Note>
      </>
    ),
  },
  {
    slug: 'verification',
    title: 'Verification engine',
    group: 'Engine',
    lead: 'A pure function from evidence and a rule set to a verification run. The same input always yields a byte-identical run.',
    body: () => (
      <>
        <H3>Pipeline</H3>
        <OL>
          <li>
            <strong className="font-medium text-ink">Ingest.</strong> JSON or JSONL, treated as untrusted. Each rejected record is reported with a reason; accepted records continue.
          </li>
          <li>
            <strong className="font-medium text-ink">Normalize.</strong> Canonical field names, scopes sorted and de-duplicated, legacy aliases rewritten.
          </li>
          <li>
            <strong className="font-medium text-ink">Digest.</strong> SHA-256 over the canonical JSON of each record; an input digest over the normalized bundle and the rule set.
          </li>
          <li>
            <strong className="font-medium text-ink">Delegation checks.</strong> For each delegation: the delegator's effective scope, amplification at the grant, and whether its parent exists.
          </li>
          <li>
            <strong className="font-medium text-ink">Chain reconstruction.</strong> One chain per action, from its delegation to a root principal, with explicit and lookup links and any breaks.
          </li>
          <li>
            <strong className="font-medium text-ink">Action checks.</strong> Attribution, scope containment, identity and credential binding, action-time validity, approval, policy traceability, references.
          </li>
          <li>
            <strong className="font-medium text-ink">Derived decision.</strong> DENY if any deny reason exists; otherwise UNKNOWN if evidence is missing; otherwise CONDITIONAL if approval is outstanding; otherwise ALLOW. Compared with the recorded decision as AGREE, DISAGREE or UNVERIFIABLE.
          </li>
          <li>
            <strong className="font-medium text-ink">Findings.</strong> Deterministic finding ids, each located on an action or a delegation edge, with evidence references by digest.
          </li>
        </OL>
        <H3>Dimensions</H3>
        <P>Every action is reported on ten dimensions, each with a result and the rules it relies on.</P>
        <Table
          caption="Verification dimensions"
          head={['Dimension', 'Question', 'Rules']}
          mono={[0, 2]}
          rows={[
            ['attribution', 'Can the action be traced to a root principal?', 'AUTH-003'],
            ['chain_completeness', 'Is every hop present and does it cite its parent?', 'AUTH-002, AUTH-004'],
            ['authority', 'Does authority narrow or hold at every hop?', 'AUTH-010, AUTH-001'],
            ['scope', 'Is the exercised scope inside the effective scope?', 'AUTH-001'],
            ['identity', 'Is the execution identity issued to the actor, and known?', 'AUTH-006, AUTH-009'],
            ['credential_binding', 'Is the credential bound to that execution identity?', 'AUTH-006'],
            ['temporal', 'Was everything valid at the action timestamp?', 'AUTH-005'],
            ['policy', 'Does the decision cite an exact policy version?', 'AUTH-007'],
            ['approval', 'Were privileged permissions approved?', 'AUTH-008'],
            ['evidence', 'Is the action record complete enough to reconstruct?', 'AUTH-003, AUTH-007'],
          ]}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ResultBadge result="PASS" />
          <ResultBadge result="WARN" />
          <ResultBadge result="FAIL" />
          <ResultBadge result="UNKNOWN" />
          <ResultBadge result="SKIPPED" />
        </div>
        <P>A disabled rule reports SKIPPED. It never turns a check into PASS.</P>
      </>
    ),
  },
  {
    slug: 'policy',
    title: 'Policy engine',
    group: 'Engine',
    lead: 'Ten verification rules, AUTH-001 to AUTH-010. They are REGENT\'s invariants, not the authorization policies of the system under audit.',
    body: () => (
      <>
        <Table
          caption="Verification rules"
          head={['Rule', 'Requirement', 'Default severity', 'Findings']}
          mono={[0, 2]}
          rows={[
            ['AUTH-001', 'Exercised authority is contained in effective authority', 'critical', 'Authority amplification, scope violation'],
            ['AUTH-002', 'Every delegation has a recorded delegator chain', 'high', 'Broken delegation chain'],
            ['AUTH-003', 'Every action resolves to a root principal', 'high', 'Unattributable action'],
            ['AUTH-004', 'Sub-agents receive explicit delegated authority', 'high', 'Orphaned principal, missing granted scope'],
            ['AUTH-005', 'Authorization is valid at action time', 'high', 'Action-time authorization failure, stale delegation, identity or credential not valid at action time'],
            ['AUTH-006', 'Execution identity and credential bind to the acting principal', 'critical', 'Credential binding mismatch, execution identity mismatch'],
            ['AUTH-007', 'Decision evidence is recorded', 'medium', 'Missing policy version, missing requested scope'],
            ['AUTH-008', 'Privileged actions record approval', 'high', 'Missing approval'],
            ['AUTH-009', 'Unknown identities cannot receive implicit authority', 'medium', 'Unknown identity or reference'],
            ['AUTH-010', 'Delegation cannot increase authority', 'high', 'Authority amplification at the grant'],
          ]}
        />
        <P>
          Admins can enable or disable a rule, change its severity, limit it to principal types, and edit its remediation text in the <A to="/app/policy">policy engine</A>. Any change bumps the rule set version, which is part of every run's input digest, so a report always says which rule set produced it.
        </P>
        <P>
          The authorization policies recorded in the evidence (policy id, version, scope ceiling, permissions requiring approval) belong to the system under audit. REGENT reads them; it does not evaluate or enforce them.
        </P>
      </>
    ),
  },
  {
    slug: 'api',
    title: 'API',
    group: 'Interfaces',
    lead: 'A JSON REST API. Every verdict is computed server-side; the API never asks a client to decide anything.',
    body: () => (
      <>
        <H3>Authentication</H3>
        <UL>
          <li>
            <strong className="font-medium text-ink">Browser session.</strong> An HttpOnly, SameSite=Strict <C>regent_session</C> cookie. Every POST, PUT, PATCH and DELETE must echo the session's CSRF token in the <C>X-REGENT-CSRF</C> header; read it from <C>GET /api/auth/session</C>.
          </li>
          <li>
            <strong className="font-medium text-ink">API token.</strong> <C>Authorization: Bearer rgt_…</C>, created in Settings (analyst role or higher) and shown once. No CSRF header is needed. A token acts with its creator's role.
          </li>
        </UL>
        <P>
          Roles are ordered viewer &lt; auditor &lt; analyst &lt; admin. Errors are JSON: <C>{'{ "error": { "code", "message", "details", "request_id" } }'}</C>. Every response carries an <C>X-Request-Id</C>.
        </P>
        <Code>{`curl -H "Authorization: Bearer $REGENT_TOKEN" \\
  "http://127.0.0.1:8787/api/chains?health=violated&limit=20"`}</Code>
        <H3>Endpoints</H3>
        <P className="mb-4">Rendered live from the server's OpenAPI 3.1 document.</P>
        <ApiReference />
      </>
    ),
  },
  {
    slug: 'cli',
    title: 'CLI',
    group: 'Interfaces',
    lead: 'regent: the same engine offline. Same input, same digest, same findings as the API.',
    body: () => (
      <>
        <P>
          Run it from the repository with <C>npm run regent -- &lt;command&gt;</C>.
        </P>
        <Table
          caption="CLI commands"
          head={['Command', 'What it does']}
          rows={[
            ['regent analyze events.json', 'Normalize and verify a JSON or JSONL evidence file; print a summary and the input digest. Saves the result to .regent/last.json.'],
            ['regent verify chain.json', 'Verify a ChainSpec or evidence file and print each chain.'],
            ['regent findings', 'List findings from the last analysis. --severity filters.'],
            ['regent replay evt-001', 'Step through one action as a timeline, stopping at the first broken invariant.'],
            ['regent explain evt-001', 'Explain the derived decision for one action.'],
            ['regent scenario authority-amplification', 'Run a built-in scenario by slug or number; regent scenario list shows them all.'],
            ['regent chains', 'List every chain in the last analysis with its health.'],
            ['regent export report.json', 'Write findings as regent.finding/v1 JSON, or CSV for a .csv path.'],
          ]}
        />
        <P>
          Commands without <C>--input &lt;file&gt;</C> use the last analysis. <C>--json</C> prints machine-readable output.
        </P>
        <H3>In CI</H3>
        <Code>{`npm run regent -- analyze evidence.jsonl --fail-on high`}</Code>
        <Table
          caption="Exit codes"
          head={['Exit code', 'Meaning']}
          rows={[
            ['0', 'Analysis completed; no finding at or above --fail-on.'],
            ['1', 'At least one finding at or above the --fail-on severity.'],
            ['2', 'Usage or input error.'],
          ]}
        />
      </>
    ),
  },
  {
    slug: 'scenarios',
    title: 'Scenarios',
    group: 'Reference',
    lead: 'Twelve built-in scenarios, each a small dataset that isolates one failure mode.',
    body: () => (
      <>
        <Table
          caption="Built-in scenarios"
          head={['#', 'Scenario', 'Teaches']}
          mono={[0]}
          rows={[
            ['1', 'Valid single-agent delegation', 'What a fully attributable, contained chain looks like.'],
            ['2', 'Valid multi-agent delegation', 'Authority narrowing across hops.'],
            ['3', 'Broken parent chain', 'A chain that cannot be followed is an attribution failure, not a guess.'],
            ['4', 'Authority amplification', 'A confused deputy spread across a chain, located at the exact edge.'],
            ['5', 'Missing delegated user', 'No human at the root: unattributable, even if nothing exceeded a grant.'],
            ['6', 'Credential mismatch', 'A credential bound to a different identity.'],
            ['7', 'Revoked credential', 'Validity checked at the moment of the action.'],
            ['8', 'Stale delegation', 'A sub-agent outliving the delegation it was given.'],
            ['9', 'Sub-agent receives excessive scope', 'Amplification at the grant, before anyone uses it.'],
            ['10', 'Missing policy version', 'A decision that cannot be reconstructed.'],
            ['11', 'Action-time authorization failure', 'Provision-time ALLOW, action-time DENY.'],
            ['12', 'Complex multi-agent chain', 'Several failures at once, located branch by branch.'],
          ]}
        />
        <P>
          Load them in the <A to="/app/scenarios">scenario lab</A>, or run <C>npm run regent -- scenario &lt;slug|number&gt;</C>. Each scenario loads as its own dataset and is never mixed with the demo or with imported evidence.
        </P>
      </>
    ),
  },
  {
    slug: 'security',
    title: 'Security model',
    group: 'Reference',
    lead: 'What REGENT protects, what it trusts, and what it does not claim.',
    body: () => (
      <>
        <H3>Trust boundaries</H3>
        <UL>
          <li>Imported evidence is untrusted input. It is size-limited, schema-validated record by record, and rendered as text, never as markup.</li>
          <li>CSV exports neutralize cells a spreadsheet would read as a formula, and strip bidirectional-override characters.</li>
          <li>The console never computes a verdict. If it were tampered with, the API's results and reports would be unchanged.</li>
          <li>Datasets are scoped to an organization, and datasets are never mixed with each other.</li>
        </UL>
        <H3>Sessions and access</H3>
        <UL>
          <li>Sessions are random tokens stored as hashes; cookies are HttpOnly and SameSite=Strict, and Secure in production.</li>
          <li>Cookie-authenticated mutations require a double-submit CSRF header, and a present Origin must be on the allow list.</li>
          <li>API tokens are stored as hashes and shown once.</li>
          <li>Role checks happen on the server for every route. Sign-in and imports are rate-limited.</li>
          <li>REGENT keeps its own audit log of sign-ins, exports, dataset and rule changes, and triage.</li>
        </UL>
        <H3>Threats in scope</H3>
        <UL>
          <li>Hostile evidence crafted to hide an amplification: unparseable permissions are kept as opaque literals, and missing fields yield UNKNOWN, never PASS.</li>
          <li>Formula and bidi injection through exports.</li>
          <li>Cross-site request forgery and cross-organization data access.</li>
        </UL>
        <H3>Limits</H3>
        <UL>
          <li>REGENT verifies records, not reality. If the system under audit does not log an action, REGENT cannot see it.</li>
          <li>
            Record digests detect change after ingestion. They are not signatures and do not prove who created a record; see <A to="/app/learn?c=non-repudiation">non-repudiation</A>.
          </li>
          <li>Demo mode offers password-less personas. Turn it off (<C>REGENT_DEMO_MODE=false</C>) on any deployment that holds real evidence.</li>
        </UL>
      </>
    ),
  },
  {
    slug: 'deployment',
    title: 'Deployment',
    group: 'Reference',
    lead: 'One container serving the API and the console from one origin, backed by PostgreSQL.',
    body: () => (
      <>
        <P>
          The production image builds the console and runs the API as a non-root user; the API serves the console's static files, so there is one origin and no CORS in normal use. <C>docker-compose.yml</C> runs it with PostgreSQL on an internal network, a read-only root filesystem, and all capabilities dropped.
        </P>
        <Table
          caption="Environment variables"
          head={['Variable', 'Default', 'Purpose']}
          mono={[0, 1]}
          rows={[
            ['DATABASE_URL', 'unset', 'PostgreSQL connection string. Unset means embedded PGlite in REGENT_DATA_DIR.'],
            ['REGENT_DATA_DIR', '.data/pglite', 'PGlite data directory.'],
            ['PORT / HOST', '8787 / 127.0.0.1', 'Listen address. HOST defaults to 0.0.0.0 in production.'],
            ['REGENT_DEMO_MODE', 'true', 'Password-less demo personas. Set false for real evidence.'],
            ['REGENT_COOKIE_SECURE', 'true in production', 'Secure cookies. Set false only for plain-HTTP local runs.'],
            ['REGENT_ALLOWED_ORIGINS', 'localhost:5173 in development', 'Origins allowed to make credentialed requests.'],
            ['REGENT_ADMIN_EMAIL / REGENT_ADMIN_PASSWORD', 'unset', 'Optional bootstrap administrator. Never defaulted.'],
            ['REGENT_MAX_IMPORT_BYTES', '5242880', 'Maximum import size.'],
            ['REGENT_SESSION_HOURS', '8', 'Session lifetime.'],
            ['REGENT_LOG_LEVEL', 'info', 'debug | info | warn | error | silent. Logs never include bodies, cookies, tokens or credentials.'],
          ]}
        />
        <P>
          There is no signing key or other secret in the repository. In production the only credential is <C>DATABASE_URL</C>. Health is reported at <C>GET /api/health</C>.
        </P>
      </>
    ),
  },
]
