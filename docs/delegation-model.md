# Delegation model

This page describes the records REGENT reads, the input formats it accepts, the ChainSpec format used by the chain builder and `regent verify`, and the exact rules used to reconstruct a delegation chain.

Sources: `packages/core/src/types.ts` (normalized model), `packages/core/src/schemas.ts` (input schemas and limits), `packages/core/src/normalize.ts` (ingestion), `packages/core/src/chainspec.ts`, `packages/core/src/chain.ts`.

All imported evidence is treated as claims made by the system under audit. Schemas check shape; the verifier checks meaning (does the parent exist, was it valid then, does it bind to the right principal).

## Records

Every input record has a `record_type`. Inside a bundle the type is implied by the array it sits in. Optional fields may be omitted or `null`; REGENT never fills in a missing value with a guess.

### Principal (`record_type: principal`)

| Field | Type | Notes |
|---|---|---|
| `principal_id` | id | Required. |
| `principal_type` | `human` \| `agent` \| `sub_agent` \| `workload` \| `service` | Required. |
| `display_name` | text | Defaults to the id. |
| `issuer` | text | For example the identity provider. |
| `provisioned_scope` | scope | For a root principal, the ceiling of what it can delegate. `null` means not recorded (not "empty"). |
| `root_eligible` | boolean | Defaults to `true` for `human`, `false` otherwise. |
| `created_at`, `suspended_at`, `revoked_at`, `expires_at` | timestamp | Validity window. |
| `status` | `ACTIVE` \| `SUSPENDED` \| `REVOKED` \| `EXPIRED` \| `UNKNOWN` | Stored as `recorded_status`. Status at export time only; never used for action-time decisions. Defaults to `UNKNOWN`. |
| `event_id` | id | Optional reference to the source event. |

### Execution identity (`record_type: execution_identity`)

| Field | Type | Notes |
|---|---|---|
| `execution_identity_id` | id | Required. |
| `kind` | `workload` \| `service` | Defaults to `workload`. |
| `bound_principal_id` | id | The principal this identity is issued to act for. |
| `spiffe_id` | text (≤ 512) | Optional. |
| `provisioned_scope` | scope | Standing permissions of the workload. Kept separate from delegated authority; used only to explain a confused deputy. |
| `issued_at`, `revoked_at`, `expires_at` | timestamp | |
| `status`, `event_id` | | As above. |

### Credential (`record_type: credential`)

Metadata only. There is no field for secret material, and none is stored.

| Field | Type | Notes |
|---|---|---|
| `credential_id` | id | Required. |
| `credential_type` | `oauth_access_token` \| `spiffe_svid` \| `api_key` \| `service_credential` \| `other` | Defaults to `other`. |
| `execution_identity_id` | id | The credential binding: which execution identity it authenticates. |
| `issued_at`, `expires_at`, `revoked_at` | timestamp | |
| `status`, `event_id` | | As above. |

### Tool and resource (`record_type: tool`, `resource`)

| Record | Fields |
|---|---|
| Tool | `tool_id` (required), `display_name`, `kind`: `mcp` \| `api` \| `connector` \| `function` \| `service` (default `api`), `event_id` |
| Resource | `resource_id` (required), `display_name`, `kind`: `database` \| `file` \| `api` \| `object` \| `application` \| `service` (default `service`), `event_id` |

### Policy (`record_type: policy`)

An authorization policy recorded by the system under audit. It is identified by `policy_id` and `policy_version` together; two versions of the same policy are two records.

| Field | Type | Notes |
|---|---|---|
| `policy_id` | id | Required. |
| `policy_version` | string or number | Required. Numbers are converted to strings. |
| `display_name` | text | |
| `scope_ceiling` | scope | If present, effective scope under this policy can never exceed it. |
| `approval_required_for` | scope | Permissions whose exercise requires `approval_state = APPROVED`. Defaults to empty. |
| `event_id` | id | |

### Delegation (`record_type: delegation`)

| Field | Type | Notes |
|---|---|---|
| `delegation_id` | id | Required. |
| `parent_delegation_id` | id | The delegation under which the delegator held its own authority. `null` for a root hop. |
| `root_principal_id` | id | Declared root. Checked against the reconstructed root, never trusted. |
| `delegator_principal_id` | id | |
| `delegatee_principal_id` | id | |
| `granted_scope` | scope | `null` means not recorded; every downstream scope check becomes `UNKNOWN`. |
| `requested_scope` | scope | What the delegatee asked for. Never authority. |
| `restrictions` | array of text (≤ 64) | Informational, for example `customer-region=EU`. Not evaluated. |
| `policy_id`, `policy_version` | id, string | The policy that governed the grant. Its scope ceiling applies to the hop. |
| `created_at`, `expires_at`, `revoked_at` | timestamp | |
| `approval_state` | approval state | Defaults to `UNKNOWN`. `PENDING`, `REJECTED` and `EXPIRED` mean the delegation was not in force. |
| `status`, `event_id` | | As above. |

### Action (`record_type: action`)

| Field | Type | Notes |
|---|---|---|
| `event_id` | id | Required. Identifies the action event. |
| `action_id` | id | Defaults to `event_id`. |
| `timestamp` | timestamp | When the action ran. |
| `root_principal_id` | id | Declared root. Checked, never trusted. |
| `actor_principal_id` | id | The principal that performed the action. |
| `parent_principal_id` | id | Declared delegator of the actor. Checked, never trusted. |
| `delegation_id` | id | The delegation the actor claims to act under. |
| `parent_event_id` | id | The event that caused this one, if any. |
| `execution_identity_id`, `credential_id`, `tool_id`, `resource_id` | id | The execution path. |
| `operation` | text (≤ 128) | What the action did. |
| `parameters` | object | Dropped (with a warning) if its JSON exceeds 16,384 bytes. |
| `requested_scope`, `exercised_scope` | scope | |
| `policy_id`, `policy_version` | id, string | The policy version that made the recorded decision. |
| `recorded_decision` | `ALLOW` \| `DENY` \| `CONDITIONAL` \| `UNKNOWN` | What the system decided. REGENT derives its own. `authorization_decision` is accepted as a synonym. |
| `decision_reason` | text | |
| `authorization_evaluated_at` | timestamp | When the decision was evaluated. Missing means unknown, and is reported. |
| `approval_state` | approval state | Defaults to `UNKNOWN`. |
| `downstream_result` | `success` \| `failure` \| `partial` | Whether the action took effect. |

An action record cannot grant authority to itself. A `delegated_scope` field on an action is accepted for compatibility and ignored, with an `IGNORED_FIELD` warning. Authority comes only from delegation records.

### Revocation (`record_type: revocation`)

| Field | Type | Notes |
|---|---|---|
| `target_type` | `principal` \| `execution_identity` \| `credential` \| `delegation` | Required. |
| `target_id` | id | Required. |
| `timestamp` | timestamp | Required. |
| `reason`, `event_id` | | Optional. |

A revocation sets `revoked_at` on its target. If several revocations name the same target, or the target already carries `revoked_at`, the earliest time wins. A revocation naming a target that is not in the evidence produces an `UNKNOWN_REVOCATION_TARGET` warning.

## Values and limits

| Item | Rule |
|---|---|
| Identifier | `^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$`. A record whose primary id does not match is rejected (`INVALID_ID`, error); so is an action whose `event_id` does not match, even when it carries a valid `action_id`. A reference to another record (`parent_delegation_id`, `root_principal_id`, `delegator_principal_id`, `delegatee_principal_id`, `actor_principal_id`, `parent_principal_id`, `delegation_id`, `parent_event_id`, `execution_identity_id`, `credential_id`, `tool_id`, `resource_id`, `policy_id`, `bound_principal_id` and the legacy aliases) that does not match is set to `null` with an `INVALID_ID` warning: it is treated as not recorded, never matched against anything. |
| Text | Every string in a record, keys included, is cleaned before parsing: C0 control characters other than tab, LF and CR, DEL and C1 control characters (U+007F–U+009F, which includes ESC), and bidirectional overrides and isolates are removed. A record that changed gets a `TEXT_SANITIZED` warning. The cleaning is done once, by `sanitizeDeep` in `packages/core/src/text.ts`, so every output (CLI, console, CSV, PDF) receives clean text. |
| Timestamp | ISO-8601 with an explicit offset (`Z` or `±hh:mm`), seconds and fractions optional. Normalized to UTC with milliseconds. Anything else is treated as missing and reported (`INVALID_TIMESTAMP`). |
| Scope | Array of strings, at most 256 items of at most 256 characters. Sorted and de-duplicated on ingestion. Permissions that do not parse are kept as opaque literals and reported (`INVALID_SCOPE_SYNTAX`); see [authority-model.md](authority-model.md). |
| Enumerations | `status`, `approval_state` and decisions are case-insensitive (`allow` is read as `ALLOW`). |
| Text | At most 4,096 characters. |
| Records per input | 50,000. Records beyond the limit are not read (`TOO_MANY_RECORDS`). |
| Unknown fields | Dropped. |

## Input formats

`parseEvidenceText` and `flattenInput` in `normalize.ts` accept:

1. **A bundle object.** Arrays keyed by kind; records inside them may omit `record_type`.

   | Key | Record type |
   |---|---|
   | `principals` | principal |
   | `execution_identities` | execution_identity |
   | `credentials` | credential |
   | `tools` | tool |
   | `resources` | resource |
   | `policies` | policy |
   | `delegations` | delegation |
   | `events` or `actions` | action |
   | `revocations` | revocation |

   A wrapper object with a `records` array (as in `scenarios/*.json` and `tests/adversarial/*.json`) is also read; its records must carry `record_type`.

2. **A JSON array** of typed records.
3. **A single record** (an object with `record_type`, or with `event_id`).
4. **JSONL**, one JSON value per line. Blank lines are skipped. A line that is not valid JSON is reported as `PARSE_ERROR` with its line number and the rest of the file is still read.

An object with an `event_id` and no `record_type` is read as an action. A leading byte-order mark is ignored. Nothing in the input is ever evaluated.

### Duplicates

Records are keyed by type and id (policies by id and version). A second record with identical content is collapsed (`DUPLICATE_IDENTICAL`, warning). A second record with different content is rejected and the first occurrence is kept (`DUPLICATE_CONFLICT`, error): a conflicting duplicate is a tampering signal or a broken exporter, and REGENT reports it rather than choosing silently. Revocation records are not de-duplicated.

### Legacy aliases

The original audit-record draft used different field names. They are accepted and rewritten during normalization; each rewrite produces an `ALIAS_APPLIED` warning so the dataset owner can see it. The canonical field wins when both are present.

| Legacy field | Canonical field | Record |
|---|---|---|
| `delegated_user` | `root_principal_id` | action |
| `agent_id` | `actor_principal_id` | action |
| `parent_agent` | `parent_principal_id` | action |
| `tool` | `tool_id` | action |
| `resource` | `resource_id` | action |
| `action` | `operation` | action |
| `decision` | `recorded_decision` | action |
| `delegated_scope` | `granted_scope` | delegation |

`agent_type` on an action is accepted and ignored. `delegated_scope` on an action is ignored (see above).

`examples/events.json` is a single action in the legacy format:

```json
[
  {
    "event_id": "evt-001",
    "timestamp": "2026-10-03T10:30:00Z",
    "delegated_user": "user-001",
    "agent_id": "agent-001",
    "parent_agent": null,
    "tool": "customer-search",
    "resource": "customer-db",
    "action": "read",
    "requested_scope": ["customer.read"],
    "exercised_scope": ["customer.read"],
    "policy_version": "policy-4",
    "decision": "allow"
  }
]
```

On its own it is unattributable: no principal, delegation, tool or resource record exists for it. REGENT reports that instead of assuming the declared `delegated_user` is the root (see the output in [cli.md](cli.md#analyze)).

### Ingestion issues

Every problem found during ingestion is an `IngestIssue` with a severity (`error` or `warning`), a code, a message, and the record index, type, id and field where known. Codes: `PARSE_ERROR`, `SCHEMA_ERROR`, `INVALID_ID`, `DUPLICATE_CONFLICT`, `DUPLICATE_IDENTICAL`, `INVALID_TIMESTAMP`, `INVALID_SCOPE_SYNTAX`, `TOO_MANY_RECORDS`, `PARAMETERS_TOO_LARGE`, `IGNORED_FIELD`, `ALIAS_APPLIED`, `UNKNOWN_REVOCATION_TARGET`, `TIMESTAMP_ORDER`, `TEXT_SANITIZED`.

`TIMESTAMP_ORDER` warnings are internal-consistency checks: a delegation that expires at or before its creation, or is revoked before its creation. They are reported and do not change the data.

## ChainSpec

ChainSpec is a compact, hand-writable description of one synthetic delegation chain. The console's chain builder produces it, `POST /api/builder/verify` and `POST /api/builder/save` accept it, and `regent verify chain.json` reads it. `chainSpecToRecords` converts it into ordinary evidence records, so a built chain goes through the same normalization and verification as an import.

Schema (`ChainSpecSchema` in `chainspec.ts`):

| Field | Rule |
|---|---|
| `name` | Optional, ≤ 120 characters. |
| `principals[]` | 1 to 24. `id`, `type` (`human` \| `agent` \| `sub_agent`), `name` (1–80), `scope` (human only: its provisioned scope; omitted means an empty recorded scope), `revoked` (boolean). |
| `delegations[]` | Up to 40. `from`, `to`, `granted` (scope or `null`), `expired`, `revoked`, `approval` (approval state, default `APPROVED`), `policy_version` (default `"1"`, `null` to omit), `cite_parent` (default `true`; `false` leaves out the parent reference so the link must be found by registry lookup). |
| `actions[]` | Up to 20. `actor`, `tool`, `resource`, `operation` (default `invoke`), `requested`, `exercised` (scope or `null`), `execution_identity` (`id`, `bound_to`, `standing_scope`, `revoked`), `credential` (`id`, `bound_to_execution_identity`, `revoked`), `approval` (default `NOT_REQUIRED`), `requires_approval` (scope), `policy_version`, `cite_delegation` (default `true`), `decision_cached_before_revocation` (boolean). |

ChainSpec ids must match `^[A-Za-z0-9][A-Za-z0-9._:@-]{0,95}$`; scopes hold at most 32 permissions of at most 160 characters. The limits keep `POST /api/builder/verify`, which any viewer can call, cheap to serve.

Conversion rules (all times are synthetic and deterministic, on 2026-10-03 UTC):

- Delegation *i* (0-based) is created at 09:00 + *i* minutes, expires at 17:00, or at 09:20 if `expired`. `revoked` sets `revoked_at` to 09:25. The parent reference is the first delegation into the delegator, unless `cite_parent` is `false`.
- Action *i* runs at 09:30 + *i* minutes and cites the first delegation into the actor, unless `cite_delegation` is `false`. Its decision is recorded as `ALLOW` and evaluated at action time, or at 09:01 if `decision_cached_before_revocation`.
- Without an explicit `execution_identity`, each action gets `wl-<actor>-<n>` bound to the actor with no standing scope; without an explicit `credential`, `cred-<execution identity>` bound to that identity, valid 09:00–21:00.
- Two policies are created: `pol-builder-delegation` v1 for delegations and `pol-builder-runtime` v1 for actions, whose `approval_required_for` is the union of every action's `requires_approval`.
- Each action records its root principal. Humans are their own root; going through the delegations in spec order, a delegatee that has no root yet inherits its delegator's root, if the delegator has one. An actor no human delegates to records no root. As everywhere, the declared root is checked against the reconstructed chain, not trusted. Built actions record no `parameters`, so record completeness is at most `WARN` (19 of 20 fields).

`examples/chain.json`:

```json
{
  "name": "Research assistant writes a customer record",
  "principals": [
    { "id": "human-alice", "type": "human", "name": "Alice", "scope": ["customer.read", "customer.write"] },
    { "id": "agent-research", "type": "agent", "name": "ResearchAgent" },
    { "id": "agent-customer", "type": "sub_agent", "name": "CustomerAgent" }
  ],
  "delegations": [
    { "from": "human-alice", "to": "agent-research", "granted": ["customer.read"] },
    { "from": "agent-research", "to": "agent-customer", "granted": ["customer.read"] }
  ],
  "actions": [
    {
      "actor": "agent-customer",
      "tool": "CustomerSearch",
      "resource": "CustomerDB",
      "operation": "update",
      "requested": ["customer.read"],
      "exercised": ["customer.read", "customer.write"],
      "execution_identity": { "id": "workload-042", "bound_to": "agent-customer", "standing_scope": ["customer.read", "customer.write"] }
    }
  ]
}
```

Both delegations are read-only, but the action exercises `customer.write` through a workload that holds standing write access. `regent verify examples/chain.json` reports one critical `AUTHORITY_AMPLIFICATION` finding; the full output is in [cli.md](cli.md#verify).

## Chain reconstruction

Reconstruction is done by `resolveActorDelegation` and `ChainAnalyzer` in `chain.ts`. Nothing is assumed: a hop that cannot be linked breaks the chain, and the break is reported.

### Locating the actor's delegation

For each action:

1. If the action names no actor, there is no chain (`no_delegation`).
2. If the action cites a `delegation_id`, that delegation must exist (`missing_delegation` otherwise) and must have been issued to the actor. A cited delegation whose delegatee is someone else (`delegatee_mismatch`) gives the actor no authority at all: the reconstructed root is cleared and the derived decision is `DENY`. This is how a forged parent reference looks in the evidence.
3. If the action cites no delegation and the actor is root-eligible, the actor acted directly (`resolution: direct`); its effective scope is its provisioned scope.
4. Otherwise REGENT looks in the registry for delegations into the actor created at or before the action timestamp, narrowed by the declared `parent_principal_id` if present, and then (only when more than one remains) by the declared `root_principal_id`. Exactly one candidate is linked (`resolution: lookup`). Zero is `no_delegation` (an orphaned principal); more than one is `ambiguous`, and REGENT refuses to choose.

### Walking back to the root

From the actor's delegation, each delegation is linked to the one under which its delegator held authority:

1. **Explicit parent.** If `parent_delegation_id` is recorded, that delegation must exist (`missing_delegation`) and must have been issued to this delegation's delegator (`delegatee_mismatch`). A delegator holds nothing through a delegation issued to someone else, so the available scope at that hop becomes unknown.
2. **Root hop.** If no parent is recorded and the delegator is root-eligible, this is the root hop. The root principal is the delegator.
3. **Unique registry lookup.** Otherwise REGENT looks for delegations into the delegator created at or before this one (missing creation times do not exclude a candidate). Exactly one candidate is linked with `link: lookup`; zero is `no_root` (the delegator is an orphaned principal); more than one is `ambiguous`.

A delegation that names no delegator breaks the chain (`no_root` with no principal). A delegator or delegatee that is not in the principal registry is reported as an unknown reference.

Links found by lookup are marked on the hop (`link: lookup`) and make the chain completeness check `WARN`: every hop is present, but the record did not cite its parent.

### Declared values are checked, not trusted

- A delegation's declared `root_principal_id` that differs from the reconstructed root is a `root_mismatch` break.
- An action's declared `root_principal_id` that differs from the reconstructed root is a `root_mismatch` break and a `BROKEN_DELEGATION_CHAIN` finding.
- An action's declared `parent_principal_id` that differs from the delegator of the delegation it relied on is a `parent_mismatch` break.

Declared values are used only to narrow an otherwise ambiguous registry lookup.

### Cycles and depth

- A delegation whose parents lead back to itself is a `cycle` break. The adversarial dataset `tests/adversarial/cycle.json` produces `BROKEN_DELEGATION_CHAIN` and `UNATTRIBUTABLE_ACTION`.
- Chains are followed for at most 32 hops (`MAX_CHAIN_DEPTH`). A longer chain is a `too_deep` break (`tests/adversarial/excessive-nesting.json` has 40 hops). The limit is applied to path length, so the result does not depend on which delegation happened to be analyzed first.
- Independently of the hop limit, the walk stops at a recursion depth of 512, so a hostile chain of tens of thousands of hops cannot exhaust the stack.

### Break kinds

| Break | Meaning |
|---|---|
| `missing_delegation` | A cited delegation is not in the evidence. |
| `delegatee_mismatch` | A cited delegation was issued to a different principal. |
| `cycle` | Following parents leads back to the same delegation. |
| `too_deep` | The chain exceeds 32 hops. |
| `no_root` | A non-root delegator holds no recorded delegation, or a delegation names no delegator. |
| `no_delegation` | A non-root actor has no delegation to it, or the action names no actor. |
| `ambiguous` | More than one candidate delegation, and the record does not say which. |
| `unknown_principal` | A delegator, delegatee or actor is not in the identity registry. |
| `root_mismatch` | A declared root disagrees with the reconstructed root. |
| `parent_mismatch` | A declared delegator disagrees with the reconstructed one. |

How each break becomes a finding is described in [verification-engine.md](verification-engine.md).
