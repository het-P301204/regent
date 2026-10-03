# Concepts

REGENT answers one question about every agent action in a body of evidence:

> Who authorized this action, through what delegation chain, under what effective authority, and did the action remain within that authority?

This page defines the vocabulary used everywhere in REGENT: the engine, the API, the CLI, the console and these documents. The terms are used with one meaning each. Where the data model has a field for a concept, the field is named.

## Terminology

| Term | Meaning in REGENT | In the data model |
|---|---|---|
| Principal | An authority-bearing identity: a human, an agent, a sub-agent, a workload or a service. Only principals hold and delegate authority. | `Principal` record, `principal_id`, `principal_type` |
| Human principal / root principal | A principal that can originate a delegation chain. Humans are root-eligible by default; any principal can be marked root-eligible explicitly. Its own authority is its provisioned scope. | `principal_type: human`, `root_eligible` |
| Delegator | The principal that issues a delegation and passes on part of its authority. | `delegator_principal_id` |
| Delegatee | The principal that receives a delegation. | `delegatee_principal_id` |
| Delegation | A recorded grant of authority from a delegator to a delegatee, with a granted scope, a validity window, an approval state and the policy version that governed it. Spawning a sub-agent is a delegation. | `Delegation` record |
| Delegation hop | One delegation in a reconstructed chain, together with what REGENT computed for it (available scope, effective scope, amplification, validity at action time). | `ResolvedHop` |
| Delegation chain | The ordered list of delegation hops from a root principal to the principal that performed an action. `hops[0]` is the root delegation. | `ReconstructedChain` |
| Granted scope | The permissions a delegation says it passes on. A grant is a claim; it is checked, not trusted. | `granted_scope` |
| Requested scope | What an action (or a delegatee) asked for. Never authority by itself. | `requested_scope` |
| Effective scope | The authority a principal actually holds through a delegation: granted ∩ the delegator's effective scope ∩ the governing policy ceiling. For a root principal acting directly, its provisioned scope. | `effective_scope` |
| Exercised scope | The permissions an action actually used. | `exercised_scope` |
| Provisioned scope | Authority configured before runtime: for a root principal, the ceiling of what it can delegate; for an execution identity, its standing permissions (kept separate from delegated authority). | `provisioned_scope` |
| Authority | The set of permissions a principal can legitimately exercise at a given moment, as established by the evidence. | computed |
| Authorization | The act of deciding whether a request is permitted. REGENT records the system under audit's decision and derives its own. | `recorded_decision`, `derived_decision` |
| Authorization decision | `ALLOW`, `DENY`, `CONDITIONAL` or `UNKNOWN`. | `AuthorizationDecision` |
| Verification result | The outcome of one check: `PASS`, `WARN`, `FAIL`, `UNKNOWN` or `SKIPPED`. `UNKNOWN` is never treated as `PASS`; `SKIPPED` means the governing rule is disabled. | `CheckResult` |
| Attribution | Tracing an action through a complete delegation chain to a root principal. | `attribution` check, AUTH-003 |
| Accountability | The property that an attributable action can be tied to the root principal who answers for it. REGENT establishes attribution; accountability is what an organization builds on top of it. | — |
| Execution identity | The identity an action actually executes as, such as a workload identity with a SPIFFE ID. It is issued to (bound to) one principal. It is not a principal and never appears as a delegation hop. | `ExecutionIdentity`, `bound_principal_id` |
| Credential | Authentication material presented by an execution identity: an OAuth access token, a SPIFFE SVID, an API key. A credential is evidence of who authenticated. It is not an identity and not a principal. REGENT stores credential metadata only, never secret values. | `Credential` |
| Credential binding | The link between a credential and the execution identity it authenticates. | `Credential.execution_identity_id` |
| Tool | The interface that executed an action (an MCP tool, an API, a connector, a function). Not a principal. | `Tool`, `tool_id` |
| Resource | What an action operated on (a database, a bucket, an application). Not a principal. | `Resource`, `resource_id` |
| Action | One operation performed by a principal through a tool against a resource. | `Action` record |
| Action event | The recorded event for an action, identified by `event_id`. | `Action.event_id` |
| Delegation event | The recorded event for issuing a delegation, identified by the delegation's `event_id`. Revocation records are events that end a delegation, principal, execution identity or credential. | `Delegation.event_id`, `revocation` records |
| Policy, policy version | An authorization policy recorded by the system under audit, identified by `policy_id` and an exact `policy_version`. It can carry a scope ceiling and a list of permissions that require approval. Distinct from REGENT's own verification rules (AUTH-001 to AUTH-010). | `AuthorizationPolicy` |
| Approval state | Whether a required approval was in place: `NOT_REQUIRED`, `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `UNKNOWN`. Approval is separate from authorization. | `approval_state` |
| Chain completeness | Whether every hop of a chain is present and linked by recorded references rather than inferred. | `chain_completeness` check |
| Authority amplification | Any point where a principal ends up holding or exercising authority that no delegation in its chain legitimately conveyed. | `AUTHORITY_AMPLIFICATION` |
| Scope violation | An action exercised permissions that were conveyed by the chain but removed from its effective scope (for example by a policy ceiling), or a root principal acted beyond its own provisioned scope. | `SCOPE_VIOLATION` |
| Unattributable action | An action that cannot be traced to a root principal. Missing evidence, not proof of misuse. | `UNATTRIBUTABLE_ACTION` |
| Orphaned principal | A non-root principal that acts or delegates with no recorded delegation to it. | `ORPHANED_PRINCIPAL` |
| Action-time authorization | Authorization evaluated when the action executes, against delegation and revocation state at that moment, as opposed to a decision made at provisioning and reused. | `temporal` check, AUTH-005 |

## Three structures, kept apart

Most audit trails flatten three different things into one log line. REGENT keeps them separate in the data model, because each answers a different question and each can fail independently.

| Structure | Question it answers | Built from | Edge kinds |
|---|---|---|---|
| Delegation chain | Who gave authority to whom? | `Delegation` records, linked by `parent_delegation_id` (or a unique registry lookup) back to a root principal | `DELEGATES` |
| Execution path | How did the action physically reach the target? | The `Action` record: actor → tool → execution identity → credential → resource, governed by a policy version | `INVOKES`, `EXECUTES_AS`, `AUTHENTICATES_WITH`, `TARGETS`, `GOVERNED_BY` |
| Evidence chain | Which records prove each claim? | `EvidenceRef` pointers from findings to normalized records, each with a SHA-256 content digest | — |

Consequences of keeping them apart:

- Tools, execution identities, credentials and resources are never principals and never appear as delegation hops. An agent's workload identity holding standing write access does not give the agent write authority; if the action uses it anyway, that is authority amplification (a confused deputy spread across a chain).
- A healthy delegation chain does not make a broken execution path healthy. An action can be fully attributable and still run under an execution identity issued to someone else (`EXECUTION_IDENTITY_MISMATCH`) or present a credential bound elsewhere (`CREDENTIAL_BINDING_MISMATCH`).
- Every finding carries its own evidence references, so a reviewer can go from a verdict to the exact records it rests on without trusting the prose.

The types are in `packages/core/src/types.ts`; the execution path edges are `ActionVerification.execution_edges`; the evidence chain is `Finding.evidence`.

## Missing is not the same as violated

REGENT distinguishes "the evidence shows a violation" from "the evidence is not sufficient to tell":

- An unknown upstream authority makes downstream checks `UNKNOWN` or `WARN`, never `PASS`.
- An action with no reconstructable root is `UNATTRIBUTABLE_ACTION` with derived decision `UNKNOWN`, not `DENY`.
- In the chain health map, gaps make a chain `incomplete` or `unknown`; only a check that fails on recorded evidence makes it `violated`. See [verification-engine.md](verification-engine.md#chain-health).

## Relation to standards

REGENT's model is conceptual and tool-neutral. It reads records that systems built on the following standards can produce, but it does not implement or certify any of them, and no compliance is claimed.

| Standard | Where it maps in REGENT |
|---|---|
| OAuth 2.0 / 2.1 | Access tokens are `Credential` records (`credential_type: oauth_access_token`); OAuth scope strings map naturally to REGENT permission strings. |
| OpenID Connect | The identity provider of a human principal (`Principal.issuer`). |
| SPIFFE / SPIRE | Workload identities are `ExecutionIdentity` records with a `spiffe_id`; SVIDs are credentials (`spiffe_svid`). REGENT does not verify SVIDs or trust bundles. |
| SCIM | Principal lifecycle (creation, suspension, revocation) maps to the `created_at`, `suspended_at` and `revoked_at` fields and to revocation records. |
| NGAC | Policy ceilings and approval requirements are a simplified form of attribute-based policy; REGENT records the policy version, it does not evaluate NGAC graphs. |
| MCP | Tools of kind `mcp`. |

Context for why the question matters now:

- The NIST NCCoE concept paper "Accelerating the Adoption of Software and AI Agent Identity and Authorization" (5 February 2026) names OAuth 2.0/2.1, OpenID Connect, SPIFFE/SPIRE, SCIM, NGAC and MCP as relevant building blocks for agent identity and authorization.
- Singapore IMDA's Model AI Governance Framework for Agentic AI (22 January 2026), a voluntary framework, asks for verifiable agent identity and an audit trail of which agent acted under whose authorization.

REGENT is one way to check such an audit trail after the fact. Planned importers for these sources are listed in [roadmap.md](roadmap.md) and are not implemented.
