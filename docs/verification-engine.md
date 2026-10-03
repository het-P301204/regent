# Verification engine

`verify(bundle, options)` in `packages/core/src/verify.ts` takes a normalized evidence bundle and returns a `VerificationRun`: one `ActionVerification` per action, a list of findings, and a summary. It is pure: no I/O, no clock, no randomness. The same bundle, rule set and completeness schema always produce a byte-identical run.

```ts
import { analyze } from '@regent/core'

const { normalized, run } = analyze(text) // ingestion + normalization + verification
run.input_digest      // sha256 over the bundle, rule set, completeness schema and engine version
run.actions[0].checks // ten dimension checks
run.findings          // sorted by severity, type, id
```

`options` accepts a `ruleset` (default `DEFAULT_RULESET`, version `2026.10.1`), a `completeness` schema (default `regent.action-record/v1`) and a `maxDepth` (default 32).

## Order of work

1. Build indexes over principals, delegations, policies and inbound delegations per delegatee.
2. Compute a SHA-256 digest of every normalized record (see [Evidence references](#evidence-references)).
3. **Delegation-level checks.** For every delegation, whether or not any action uses it: amplification at the grant, missing granted scope, missing policy version, its own chain breaks, unknown delegatee.
4. **Action-level checks.** For every action: resolve the actor's delegation, reconstruct the chain, then run the checks below.
5. Rewrite ISO timestamps inside prose (`2026-10-03T13:30:00.000Z` becomes `2026-10-03 13:30 UTC`). Structured fields keep fixed-width ISO strings so they sort lexically.
6. Sort findings by severity, type and id; sort each finding's evidence references; compute the input digest and the summary.

When the same finding is observed by many actions (for example one unregistered actor behind 15,000 actions), its related events, affected principals and resources and evidence references are collected in sets and sorted once at the end, rather than re-sorted on every merge. Resolved hops are cached per delegation, link, position and validity at the action time, and permission parsing is memoized. None of this changes the output; it keeps large runs near-linear (see [testing.md](testing.md#performance)).

## Checks per action

Every action gets ten `DimensionCheck`s. Each check names the rules that govern it. If every rule a check maps to is disabled, the check reports `SKIPPED` with the rule set version; a disabled rule never turns a check into `PASS`.

| Dimension | Label | Rules | PASS | WARN | UNKNOWN | FAIL |
|---|---|---|---|---|---|---|
| `attribution` | Attribution | AUTH-003 | Traced to a root principal with no conflicting evidence. | — | — | No root, or the chain has breaks (including a declared root or delegator that disagrees). |
| `chain_completeness` | Chain completeness | AUTH-002, AUTH-004 | Every hop cites its parent delegation (or the root acted directly). | At least one link was found by registry lookup. | — | Any break, or no root. |
| `authority` | Authority integrity | AUTH-010, AUTH-001 | Authority narrows or is preserved at every hop. | The root's own authority is not recorded, so the first grant is unverified. | A non-root hop's available scope, or the effective scope, cannot be established. | A hop amplifies, or the action exercised authority no delegation conveyed. |
| `scope` | Scope containment | AUTH-001 | Exercised ⊆ effective. | Requested exceeded effective but was not exercised, or effective is only an upper bound. | Exercised or effective scope missing, or the bound comes with chain breaks. | Exercised ⊄ effective; the outside permissions are named. |
| `identity` | Identity binding | AUTH-006, AUTH-009 | The execution identity is issued to the actor. | The execution identity does not record its bound principal. | No execution identity recorded, or it is not registered. | Issued to a different principal. |
| `credential_binding` | Credential binding | AUTH-006 | The credential is bound to the execution identity. | — | No credential recorded, or it is not registered. | Bound to a different (or no) execution identity. |
| `temporal` | Action-time validity | AUTH-005 | Everything was valid at the action timestamp and the decision was evaluated at or before it with nothing changing in between. | No `authorization_evaluated_at` on an executed action, or the evaluation is after the action. | The action has no timestamp. | Something was invalid at action time and the action ran. |
| `policy` | Policy traceability | AUTH-007 | The decision names a policy version that is in the evidence. | The policy version is named but its record is not in the evidence, so its ceiling and approval requirements were not applied. | — | No policy version recorded. |
| `approval` | Approval | AUTH-008 | No approval required, or approval recorded as `APPROVED`. | Approval required and missing, but the action did not run. | No policy record, so approval requirements are unknown. | Approval required and missing and the action ran, or a delegation in the chain is pending, rejected or expired and the action ran. |
| `evidence` | Record completeness | AUTH-007, AUTH-003 | Every schema field present. | Some non-critical field missing. | — | A critical field missing. |

The worst result across the checks is the action's `overall` result, ranked `FAIL > UNKNOWN > WARN > PASS > SKIPPED`.

Each action also gets an `execution_edges` list for the execution path: `INVOKES` (actor → tool, carries the scope result), `EXECUTES_AS` (tool → execution identity), `AUTHENTICATES_WITH` (execution identity → credential), `TARGETS` (→ resource; `UNKNOWN` if the resource is not registered) and `GOVERNED_BY` (action → policy version). Each delegation hop carries its own result and reasons (amplified, carried amplification, invalid at action time, approval not in force, delegator authority unknown, linked by lookup, policy ceiling applied, policy version missing).

## Record completeness

The default schema `regent.action-record/v1` (`DEFAULT_COMPLETENESS_SCHEMA`) lists 20 action fields. Six are critical because attribution and scope checks depend on them.

| Field | Critical | Why it matters |
|---|---|---|
| `event_id` | yes | Identity of the record. |
| `timestamp` | yes | Action-time checks need to know when the action ran. |
| `root_principal_id` | yes | Names the root principal the action is attributed to. |
| `actor_principal_id` | yes | Names the principal that performed the action. |
| `delegation_id` | no | Links the action to its delegation, so the chain is not reconstructed by lookup. |
| `tool_id` | no | Which interface executed the action. |
| `resource_id` | no | What the action operated on. |
| `operation` | no | What the action did. |
| `parameters` | no | The inputs the action was invoked with. |
| `requested_scope` | yes | Without it, the decision cannot be re-checked. |
| `exercised_scope` | yes | Without it, containment cannot be verified. |
| `execution_identity_id` | no | Which workload identity the action ran as. |
| `credential_id` | no | Which credential authenticated the execution. |
| `policy_id` | no | Which policy made the decision. |
| `policy_version` | no | Which exact revision of the policy. |
| `recorded_decision` | no | What the system decided. |
| `decision_reason` | no | Why. |
| `authorization_evaluated_at` | no | Whether the decision was made at action time. |
| `approval_state` | no | Whether a required approval was in place. `UNKNOWN` counts as missing. |
| `downstream_result` | no | Whether the action took effect. |

A field is present if it is not `null`, not absent and not an empty string. The percentage is shown with its arithmetic everywhere it appears:

```
percent = round(present / required_count × 100)
```

For example `100% (20 of 20 fields)`. The result lists `present`, `missing` and `critical_missing`. A custom schema can be passed to `verify` as `options.completeness`.

## Chain health

`chainHealth(actionVerification)` assigns each action one of four classes for the chain health map, the chain list filters and the summary:

| Class | Condition (evaluated in this order) |
|---|---|
| `violated` | Any of `authority`, `scope`, `identity`, `credential_binding`, `temporal`, `approval` is `FAIL`. |
| `incomplete` | `attribution` or `chain_completeness` is `FAIL`. |
| `unknown` | Any of `authority`, `scope`, `identity` is `UNKNOWN`. |
| `incomplete` | Any other check is `WARN`, `FAIL` or `UNKNOWN`. |
| `verified` | Everything else. |

Missing evidence is `incomplete` (or `unknown`), never `violated`: an unattributable action, a missing policy version or a missing field cannot by themselves turn a chain red. Only a check that fails against recorded evidence can. Scenario 5 (`missing-delegated-user`) and the test "missing evidence is never reported as unauthorized behaviour" enforce this.

## Findings

A finding is produced only when its rule is enabled and, if the rule has an `applies_to` list, the relevant principal type is in it (the actor for action findings, the delegatee for delegation findings). Unknown-reference findings are not filtered by principal type.

REGENT's canonical finding list has 14 types. `REVOKED_CREDENTIAL` and `UNKNOWN_REFERENCE` extend it: the first separates credential validity from identity validity, the second makes an unregistered identity, tool or resource an explicit finding instead of a silent gap.

| Type | Rule | Default severity | Raised when |
|---|---|---|---|
| `AUTHORITY_AMPLIFICATION` | AUTH-001 (exercise) or AUTH-010 (grant) | critical (AUTH-001), high (AUTH-010) | A delegation grants more than the delegator held, or an action exercised authority no delegation conveyed. |
| `SCOPE_VIOLATION` | AUTH-001 | critical | An action exercised authority the chain conveyed but a policy ceiling removed, or a root principal exceeded its own provisioned scope. |
| `BROKEN_DELEGATION_CHAIN` | AUTH-002 | high | Missing or mis-issued parent, cycle, chain too deep, ambiguous link, a delegation with no delegator, a declared root or delegator that contradicts the reconstruction, or a delegation created after the action that relies on it. |
| `UNATTRIBUTABLE_ACTION` | AUTH-003 | high | No root principal can be established for an action. |
| `ORPHANED_PRINCIPAL` | AUTH-004 | high | A non-root principal delegates or acts with no delegation to it. |
| `MISSING_DELEGATED_SCOPE` | AUTH-004 | high | A delegation records no granted scope. |
| `ACTION_TIME_AUTHORIZATION_FAILURE` | AUTH-005 | high | An action ran on a decision evaluated before a revocation or expiry it relied on (supersedes the two findings below for that action). |
| `STALE_DELEGATION` | AUTH-005 | high | An executed action relied on a delegation that had expired or been revoked. |
| `REVOKED_IDENTITY` | AUTH-005 | high | An executed action relied on a principal or execution identity that was revoked, suspended, expired or not yet valid. |
| `REVOKED_CREDENTIAL` | AUTH-005 | high | An executed action authenticated with a credential that was revoked, expired or not yet valid. |
| `CREDENTIAL_BINDING_MISMATCH` | AUTH-006 | critical | The credential is bound to a different execution identity. |
| `EXECUTION_IDENTITY_MISMATCH` | AUTH-006 | critical | The execution identity is issued to a different principal. |
| `MISSING_POLICY_VERSION` | AUTH-007 | medium | An action or a delegation does not record its policy version. |
| `MISSING_REQUESTED_SCOPE` | AUTH-007 | medium | An action does not record its requested scope. |
| `MISSING_APPROVAL` | AUTH-008 | high | A privileged permission was used without approval and the action ran, or the action relied on a delegation whose approval is pending, rejected or expired. |
| `UNKNOWN_REFERENCE` | AUTH-009 | medium | A principal, execution identity, credential, tool or resource is referenced but not registered. |

Severities and remediation text come from the rule set and can be overridden per organization ([policy-engine.md](policy-engine.md)).

Each finding carries: a one-sentence `summary`, a `root_cause` derived from the evidence, the rule's `remediation`, the `action_id` and/or `delegation_id`, the `broken_edge` (the first edge where the invariant broke: `from`, `to`, `hop_index`, `delegation_id`), affected principals and resources, an `authority_delta` (available, granted, requested, effective, exercised, excess) where scopes are involved, `missing_fields`, `evidence` references, `related_event_ids`, and `first_seen` / `last_seen` from recorded timestamps.

### Finding ids

```
REG-<CODE>-<first 10 hex chars of sha256("<type>|<rule_id>|<subject>")>
```

`CODE` is a short code per type (`AMP`, `SCOPE`, `ATTR`, `CHAIN`, `ORPHAN`, `GRANT`, `REQ`, `POLV`, `CRED`, `EXID`, `STALE`, `REVID`, `REVCRED`, `APPR`, `ATA`, `UNK`). The subject is a stable key for what the finding is about, for example `action|evt-s4-write`, `grant|del-research-customer` or `principal|agent-sync`. The id therefore identifies the finding's subject rather than hashing the full record content: re-running the same evidence yields the same ids, which is why triage status survives a re-run. Two observations with the same id are merged: related events, affected principals and resources and evidence references are unioned, and `first_seen` / `last_seen` widen. Example: `REG-AMP-672136ea9a`.

### Evidence references

Every finding points at the records it rests on. Each reference has a `kind` (`action`, `delegation`, `principal`, `execution_identity`, `credential`, `policy`, `tool`, `resource`), an `id`, the record's `event_id` if any, a `note`, and a `digest`:

```
digest = "sha256:" + sha256(canonical JSON of the normalized record)
```

Canonical JSON sorts object keys by code point and drops `undefined`. The digest shows whether a record has changed since it was ingested. It is not a signature: it does not prove who created the record, and it provides no non-repudiation. See [threat-model.md](threat-model.md).

## Summary

`run.summary` counts: total actions; attributable (root found and attribution `PASS`), unattributable (no root) and unknown-attribution (root found but conflicting evidence) actions; authority violations (scope or authority `FAIL`); amplification events (authority `FAIL`); broken chains; records with missing fields; authority integrity as `passing / evaluated` with `unknown` counted separately (actions whose scope or authority check is `UNKNOWN` or `SKIPPED` are not evaluated and never counted as passing); findings by severity and by type; derived decisions; chain health classes.

## Explanation and replay

Two deterministic views are generated from a run. Neither can change a verdict; they only phrase it. No language model is involved.

**Explanation** (`explainAction` in `explain.ts`). Picks one of four questions, "Why was this action allowed?", "Why is this a finding?", "Why can this action not be verified?" or "Why was this action refused?", then lists steps (each hop, the requested and exercised scope, the containment result, failed identity, credential, temporal and approval checks) with a tone (`pass`, `warn`, `fail`, `neutral`), and a conclusion assembled from the finding types present.

**Replay** (`buildReplay` in `replay.ts`). A timeline of the action built only from recorded timestamps: each delegation (or sub-agent spawn), revocations and expiries that happened at or before the action, the request, the authorization evaluation, the execution identity and credential, the resource access and the downstream result. Steps are sorted by time, then by kind. A step with no timestamp is listed separately as untimed rather than given an invented time. `violation_index` is the first step whose status is `FAIL`; a temporal failure is shown at the revocation or expiry step, not at the delegation's creation. `regent replay` prints it; see [cli.md](cli.md#replay).

## Other views over the same run

| Function | Module | Purpose |
|---|---|---|
| `authorityAt` | `timetravel.ts` | Authority that existed at an instant ([authority-model.md](authority-model.md#time-travel)). |
| `timeCheckpoints` | `timetravel.ts` | Every recorded authority change and action time, as instants to stop at. |
| `diffChains` | `diff.ts` | Compares two reconstructed chains hop by hop (aligned by position from the root): authority added or removed, identity, policy, execution identity, credential, tool, resource or root changed, hops added or removed. |
| `investigate` | `investigate.ts` | Starts from one event and collects the chain, explanation, replay, findings, and every other action that shares a delegation, actor, execution identity or credential, or is its parent or child event. |
| `evaluateControls` | `grc.ts` | Seven controls (RGT-C1 to RGT-C7) evaluated from the same run: `SATISFIED`, `PARTIALLY_SATISFIED`, `NOT_SATISFIED` or `NOT_EVALUATED`. The mapping is REGENT's own and claims no compliance with any framework. |
| `toFindingExports`, `findingsCsv`, `actionsCsv` | `export.ts` | Machine-readable findings (`regent.finding/v1`) and CSV exports. |
