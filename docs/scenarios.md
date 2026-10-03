# Scenarios and adversarial datasets

REGENT ships three kinds of synthetic data. All of it is invented: the organization (Acme AI Operations), the people (Alice Romero, Maya Chen, Daniel Okafor, Priya Nair, Tom Becker), the agents, workloads, credentials, tools and resources. Credentials are metadata only; no secret values exist anywhere in the repository. Domains use `example.test` and `acme.example`.

| Dataset | Source | Purpose |
|---|---|---|
| Scenario lab (12 scenarios) | `SCENARIOS` in `packages/core/src/scenarios.ts`; exported to `scenarios/NN-slug.json` | Each makes exactly one security property visible. |
| Acme demo environment | `demoRecords()` in `packages/core/src/demo.ts`; exported to `scenarios/acme-demo.json` | A day of agent activity with mostly healthy chains and a handful of problems. Seeded into the API on first start. |
| Adversarial datasets (15) | `scripts/generate-adversarial.ts`; written to `tests/adversarial/*.json` | Hostile or malformed input REGENT must analyze safely and classify correctly. |

All of them are built with `EvidenceBuilder` (`packages/core/src/builder.ts`) and produce ordinary raw records, so they pass through the same normalization as an import. They are deterministic: no clock, no randomness. Regenerate the JSON files with `npm run scenarios:export` and `node scripts/generate-adversarial.ts`.

## Scenario lab

Every scenario declares the finding types it must produce. The test suite checks the set in both directions: no expected type may be missing and no other type may appear.

The small scenarios share a baseline registry: Alice Romero (human, provisioned `customer.read`, `customer.write`, `invoice.read`, `invoice.write`, `invoice.approve`), ResearchAgent (agent), CustomerAgent (sub-agent), their workloads `wl-research-01` (standing `customer.read`) and `wl-customer-02` (standing `customer.read`, `customer.write`), one SVID each, the CustomerSearch and CustomerUpdate tools, CustomerDB, and two policies: `pol-agent-delegation` v4 and `pol-agent-runtime` v7 (approval required for `customer.delete` and `invoice.approve`).

| # | Slug | Setup | What it teaches | Expected findings |
|---|---|---|---|---|
| 1 | `valid-single-agent` | Alice delegates read-only customer access to ResearchAgent, which reads one record. | A fully attributable, contained chain: every check passes and the derived decision matches the recorded one. | none |
| 2 | `valid-multi-agent` | Alice grants ResearchAgent read and write; ResearchAgent passes only read to CustomerAgent, which reads. | Authority narrowing across hops is exactly what monotonicity allows. | none |
| 3 | `broken-parent-chain` | CustomerAgent's delegation cites a parent delegation that does not exist. | A chain that cannot be followed is an attribution failure, reported as unattributable rather than guessed. | `BROKEN_DELEGATION_CHAIN`, `UNATTRIBUTABLE_ACTION` |
| 4 | `authority-amplification` | Every delegation is read-only, but CustomerAgent writes through a tool whose workload holds standing write access. | A confused deputy spread across a chain: no single component authorized the write. The amplification is located at the edge where it entered. | `AUTHORITY_AMPLIFICATION` |
| 5 | `missing-delegated-user` | ResearchAgent, started by a scheduler, spawns CustomerAgent, which reads. No human at the root. | No root means unattributable even if nothing exceeded a grant. Missing evidence is reported as missing, not as misuse. | `ORPHANED_PRINCIPAL`, `UNATTRIBUTABLE_ACTION` |
| 6 | `credential-mismatch` | CustomerAgent runs as its own workload but presents ResearchAgent's credential. | A credential is evidence of who authenticated, not a principal. Bound elsewhere, the recorded chain no longer describes who acted. | `CREDENTIAL_BINDING_MISMATCH` |
| 7 | `revoked-credential` | CustomerAgent's credential is revoked at 10:00; at 10:20 an action authenticates with it and is allowed. | Validity is checked at the moment of the action, not at issuance. | `REVOKED_CREDENTIAL` |
| 8 | `stale-delegation` | ResearchAgent's delegation to CustomerAgent expired at 09:30; CustomerAgent is allowed at 10:15. | A decision that does not check expiry lets a sub-agent outlive its authority. | `STALE_DELEGATION` |
| 9 | `excessive-sub-agent-scope` | Alice grants ResearchAgent read only; ResearchAgent grants CustomerAgent read and write; CustomerAgent only reads. | Amplification at the grant is a finding before anyone uses it. The action stays contained, because effective scope never includes what the delegator did not hold. | `AUTHORITY_AMPLIFICATION` (rule AUTH-010) |
| 10 | `missing-policy-version` | An allowed action names its policy but not the version. | Without the exact version, the decision cannot be reconstructed and a policy change cannot be told apart from a bypass. | `MISSING_POLICY_VERSION` |
| 11 | `action-time-authorization` | Alice's delegation is revoked at 10:00; at 10:05 ResearchAgent reads, allowed by a decision cached at 09:00. | Provision-time authorized, action-time denied. The action-time finding absorbs the stale delegation it explains. | `ACTION_TIME_AUTHORIZATION_FAILURE` |
| 12 | `complex-multi-agent` | A chain from Alice through ResearchAgent and PlannerAgent to InvoiceAgent and ReportAgent, with four actions: a clean lookup, an invoice approval with approval `PENDING`, a report export under a delegation that grants `report.export` the planner never held, and an action that runs under CustomerAgent's workload identity. | Real chains fail in more than one place at once; locate the first broken edge on each branch. | `AUTHORITY_AMPLIFICATION`, `MISSING_APPROVAL`, `EXECUTION_IDENTITY_MISMATCH` |

Load a scenario in the console (Scenario lab), through the API (`POST /api/scenarios`, analyst role, because loading creates a dataset; it returns `expected`, `produced` and `matches_expected`), or with `regent scenario <slug|number>`.

## Acme demo environment

A fictional organization's agent activity on 3 October 2026: four humans, ten agents, eleven workloads, eleven credentials, ten tools, seven resources, five policy versions, nine delegations and 37 actions (104 records). Verified with the default rule set (`regent analyze scenarios/acme-demo.json`):

| Measure | Value |
|---|---|
| Actions | 37 |
| Attributable / unattributable | 35 / 2 |
| Chain health | 27 verified, 2 incomplete, 8 violated, 0 unknown |
| Findings | 17 (2 critical, 10 high, 5 medium) |

What the problems are, by thread:

- **Maya Chen's finance chain.** ReconciliationAgent posts to the ledger with only `ledger.read` delegated, using its workload's standing write access (`evt-0042`, critical `AUTHORITY_AMPLIFICATION`). InvoiceAgent approves an invoice with approval `PENDING` (`MISSING_APPROVAL`). ReportingAgent keeps exporting after its delegation expired at 12:00 (`STALE_DELEGATION`). OperationsAgent runs a query as a shared batch workload issued to NightlySyncAgent (critical `EXECUTION_IDENTITY_MISMATCH`).
- **Daniel Okafor's support chain.** SupportAgent grants ReplyDraftAgent `customer.write`, which SupportAgent never held (high `AUTHORITY_AMPLIFICATION` at the grant). Daniel revokes SupportAgent at 14:00; at 14:40 it updates a ticket on a decision cached at 13:30 (`ACTION_TIME_AUTHORIZATION_FAILURE`). A lookup at 14:55 is refused by the gateway, which is the correct outcome and produces no finding. CustomerLookupAgent's credential is revoked at 15:30 and used at 15:45 (`REVOKED_CREDENTIAL`, and `STALE_DELEGATION` because its upstream delegation was revoked at 14:00).
- **Priya Nair's triage chain.** Clean.
- **Tom Becker's forecast agent.** The delegation records no policy version (`MISSING_POLICY_VERSION`), and Tom is revoked at 13:00 before the agent's 16:30 export (`REVOKED_IDENTITY`).
- **NightlySyncAgent.** A scheduled agent no human ever delegated to (`ORPHANED_PRINCIPAL`), with two unattributable actions that record neither a requested scope nor a policy version.

## Adversarial datasets

Each file in `tests/adversarial/` carries a `description`, an `expect` list of finding types, and `records`. The test "is classified exactly as documented" runs every file through `analyze` and requires the produced set of finding types to equal `expect` exactly.

| File | Input | Must produce |
|---|---|---|
| `conflicting-policy.json` | The policy ceiling removes `customer.write`, which the chain conveyed; the action exercises it anyway. | `SCOPE_VIOLATION` |
| `conflicting-timestamps.json` | The action is timestamped before the delegation it cites was created. | `BROKEN_DELEGATION_CHAIN` |
| `credential-mismatch.json` | The action presents a credential bound to a different execution identity. | `CREDENTIAL_BINDING_MISMATCH` |
| `cycle.json` | Two delegations name each other as parent. | `BROKEN_DELEGATION_CHAIN`, `UNATTRIBUTABLE_ACTION` |
| `duplicate-event.json` | The same event id twice with different content. The first is kept and the conflict is reported at ingestion. | no findings; a `DUPLICATE_CONFLICT` ingestion error, and the kept record's exercised scope is `customer.read` |
| `excessive-nesting.json` | A 40-hop delegation chain, longer than the 32-hop limit. | `BROKEN_DELEGATION_CHAIN`, `UNATTRIBUTABLE_ACTION` |
| `forged-parent.json` | The action cites Alice's delegation to ResearchAgent, but CustomerAgent performed it. | `BROKEN_DELEGATION_CHAIN`, `UNATTRIBUTABLE_ACTION` |
| `invalid-scope-syntax.json` | Scopes that do not parse. They are kept as opaque literals, so an unparseable exercised permission still fails containment. | `AUTHORITY_AMPLIFICATION` |
| `malformed-events.json` | Wrong types, an unknown record type, a path-like id, a non-ISO timestamp, prototype-pollution keys, a number and `null`. | Bad records rejected with reasons (at least 5); the one well-formed event kept, unknown keys dropped, no prototype polluted; `MISSING_POLICY_VERSION`, `MISSING_REQUESTED_SCOPE`, `UNATTRIBUTABLE_ACTION`, `UNKNOWN_REFERENCE` |
| `missing-principal.json` | The action names an actor and a root principal that are not in the registry. | `UNKNOWN_REFERENCE`, `UNATTRIBUTABLE_ACTION`, `EXECUTION_IDENTITY_MISMATCH` |
| `missing-scope.json` | A delegation with no granted scope and an action with no requested scope. | `MISSING_DELEGATED_SCOPE`, `MISSING_REQUESTED_SCOPE` |
| `orphan-agent.json` | An agent acts with no delegation to it anywhere. | `ORPHANED_PRINCIPAL`, `UNATTRIBUTABLE_ACTION` |
| `privilege-amplification.json` | A read-only chain whose last hop exercises write. | `AUTHORITY_AMPLIFICATION` |
| `revoked-identity.json` | The root human is revoked before the agent acts on their delegation. | `REVOKED_IDENTITY` |
| `stale-delegation.json` | The delegation expired an hour before the action. | `STALE_DELEGATION` |

The files are plain evidence and can be fed to the CLI or the import page by hand, for example `regent analyze tests/adversarial/forged-parent.json`.

## How the tests enforce this

| Test | File | Checks |
|---|---|---|
| Scenario catalogue | `packages/core/test/scenarios.test.ts` | Twelve scenarios with unique slugs and numbers 1–12; each produces exactly its expected finding types with no ingestion errors, and its focus event exists. Scenarios 1 and 2 pass every check, derive `ALLOW` and agree with the recorded decision. Targeted tests for scenarios 4, 5, 9 and 11. |
| Demo environment | `packages/core/test/scenarios.test.ts` | Ingests with no issues; more than 20 verified and more than 3 violated chains; at least one unattributable action; the refused lookup is not executed and its temporal check passes. |
| Adversarial datasets | `packages/core/test/ingestion-and-determinism.test.ts` | Every dataset the threat model names is present; each file produces exactly its `expect` list; duplicate and malformed handling. |
| API | `apps/api/test/api.test.ts` | Loads every scenario through `POST /api/scenarios` and requires `matches_expected: true`. |
| CLI | `apps/cli/test/cli.test.ts` | `--fail-on critical` exits 1 on scenario 4 and `--fail-on low` exits 0 on scenario 1. |
