# Authority model

This page defines how REGENT represents authority, how it computes the effective scope at every delegation hop, where it locates authority amplification, and how it derives an action-time authorization decision.

Sources: `packages/core/src/scope.ts` (scope algebra), `packages/core/src/chain.ts` (effective scope per hop), `packages/core/src/verify.ts` (containment, decisions, temporal checks).

## Scope grammar

A permission is a dot-separated string of at least two segments. Each segment matches `[a-z][a-z0-9_-]{0,63}`, and the whole permission is at most 160 characters. The last segment may be a wildcard `*`.

| Permission | Valid | Why |
|---|---|---|
| `customer.read` | yes | |
| `customer.pii.read` | yes | |
| `invoice.*` | yes | Trailing wildcard. |
| `a.b-c.d_e` | yes | |
| `*` | no | A wildcard needs at least one named segment. |
| `customer` | no | Fewer than two segments. |
| `Customer.read` | no | Segments are lower case. |
| `customer..read` | no | Empty segment. |
| `customer.*.read` | no | A wildcard is only ever trailing. |

A scope is a set of permissions, always held sorted (by code point) and de-duplicated.

### Covering

`covers(g, p)` answers "does holding `g` include holding `p`?":

- Every permission covers itself.
- `a.b.*` covers anything strictly beneath `a.b`: `a.b.c`, `a.b.c.d` and `a.b.c.*`.
- A wildcard never covers its own prefix (`customer.*` does not cover `customer`) or a broader wildcard (`customer.pii.*` does not cover `customer.*`).
- Matching is by segment, not by string prefix: `customer.*` does not cover `customers.read`.

### Invalid syntax is kept as an opaque literal

A permission that does not parse is not dropped. It is kept as an opaque literal that covers only itself and is covered only by itself, and an `INVALID_SCOPE_SYNTAX` warning is recorded. Dropping it would be the unsafe choice: an unparseable permission in an exercised scope would vanish from the containment check and the action would look contained. `tests/adversarial/invalid-scope-syntax.json` checks that such a permission still fails containment.

### Set operations

| Operation | Definition |
|---|---|
| `isSubset(A, B)` | Every member of A is covered by some member of B. |
| `excess(A, B)` | Members of A not covered by B. Used to name exactly what expanded. |
| `intersect(A, B)` | The greatest lower bound: everything both convey. `{customer.*} ∧ {customer.read, invoice.read} = {customer.read}`. Commutative. |
| `minimal(S)` | Canonical and without entries already covered by another entry. Used for computed scopes. |

## Effective scope

Authority flows from a root principal outward. For each delegation hop REGENT computes:

- **Available scope**: what the delegator could legitimately pass on.
  - At a root hop: the root principal's `provisioned_scope`.
  - At any later hop: the effective scope of the parent delegation.
  - Unknown (`null`) when the root's provisioned scope is not recorded, when the parent hop's effective scope is unknown, or when the parent delegation was issued to someone other than this delegator.
- **Effective scope**: `granted ∩ available ∩ policy ceiling`, where the policy ceiling is the `scope_ceiling` of the delegation's policy version, if that policy record is present and has one.
- **Policy-restricted scope**: the part of `granted ∩ available` that the ceiling removed.

When an action executes, the actor's effective scope is the effective scope of the delegation it acted under, further intersected with the scope ceiling of the action's own policy version. A root principal acting directly has its provisioned scope as effective scope.

Granted, requested, effective, exercised and provisioned scope are never conflated:

- A granted scope larger than the available scope does not make the delegatee hold more: the excess is amplification and is excluded from the effective scope.
- Requested scope is never authority. A request beyond the effective scope makes the derived decision `DENY` even if the excess was not exercised.
- The provisioned scope of an execution identity (its standing permissions) is never added to delegated authority.

### Upper bounds when upstream authority is unknown

If the available scope is unknown, REGENT still computes `granted ∩ ceiling` but marks it as an upper bound (`effective_is_bound`). The bound propagates downstream, together with any break upstream. Consequences:

- Excess over an upper bound is still definite amplification or violation, because the true effective scope can only be smaller.
- A containment check that passes only against an upper bound is reported as `WARN`, not `PASS` (`UNKNOWN` if the chain also has breaks).
- A delegation with no recorded `granted_scope` has no effective scope at all; every downstream scope check is `UNKNOWN`, and a `MISSING_DELEGATED_SCOPE` finding is raised.

The engine test "carries an unrecorded root authority as an upper bound, never as a PASS" checks this.

## Authority amplification

Authority amplification is any point where a principal ends up holding or exercising authority that no delegation in its chain conveyed. REGENT finds it in two places.

### At a grant (AUTH-010)

`amplified = granted \ available` at a hop, when the available scope is known. Such a delegation is a finding on its own (`AUTHORITY_AMPLIFICATION`, rule AUTH-010), located on the delegation edge (`broken_edge` names the delegator, delegatee, hop index and delegation id), even if nobody ever uses the extra authority. Scenario 9 (`excessive-sub-agent-scope`) shows this: the action stays contained, because its effective scope can never include what the delegator did not hold.

### Reported once, where it entered

Authority amplified at one hop and passed on by later hops is recorded on the later hops as `inherited_amplified`, not as new amplification. A later delegator re-granting it holds it nominally, so the later hop is not a new break; it is marked `WARN` ("passes on authority amplified at an earlier hop"). The engine test "reports amplification once at the hop where it entered" checks that a three-hop chain with one amplifying hop produces exactly one finding, on that hop.

### At the exercise boundary (AUTH-001)

For an executed action, REGENT computes `excess(exercised, effective)`. Each permission in the excess is classified:

| Condition | Result |
|---|---|
| Some hop's `amplified` covers it | `AUTHORITY_AMPLIFICATION` located at the earliest such hop. |
| The last delegation to the actor did not grant it | `AUTHORITY_AMPLIFICATION` located on the actor → tool edge: no delegation conveyed it. If the action's execution identity holds it as standing permission, the root cause explains the confused deputy. |
| The chain conveyed it but it is not in the effective scope (removed by a policy ceiling), or a root principal acting directly exercised more than its provisioned scope | `SCOPE_VIOLATION`. |

The distinction matters for remediation: amplification means authority came from somewhere other than the delegation chain; a scope violation means the chain conveyed it and a ceiling or the root's own limit should have stopped it.

## The seven invariants

| # | Invariant | Formal statement | Rules |
|---|---|---|---|
| 1 | Containment | Exercised ⊆ Effective(actor) | AUTH-001 |
| 2 | Monotonicity | Granted ⊆ Effective(delegator), so Effective(delegatee) ⊆ Effective(delegator) at every hop | AUTH-010 |
| 3 | Attribution | Every action resolves through a complete delegation chain to a root principal; every non-root delegator and actor holds an explicit delegation with a granted scope | AUTH-002, AUTH-003, AUTH-004 |
| 4 | Identity binding | The execution identity is issued to the acting principal, and the credential is bound to that execution identity | AUTH-006 |
| 5 | Action-time validity | Every delegation, principal, execution identity and credential the action relies on is valid when it executes, and the decision is evaluated then | AUTH-005 |
| 6 | Policy traceability | Every decision records its exact policy version, and every action records its requested scope | AUTH-007 |
| 7 | Approval | Permissions the governing policy marks as requiring approval are exercised only with `approval_state = APPROVED`, and no delegation in the chain is pending, rejected or expired | AUTH-008 |

AUTH-009 states the principle that runs through all of them: an unknown identity or reference never receives implicit authority, and an unknown result is never reported as `PASS`.

## Derived authorization decision

REGENT re-derives an action-time authorization decision for every action from the evidence, independently of the decision the system under audit recorded. It collects reasons in three groups and picks the first group that is non-empty, in the order **DENY > UNKNOWN > CONDITIONAL > ALLOW**.

**DENY** if any of:

- exercised scope exceeds the effective scope;
- requested scope exceeds the effective scope;
- a delegation, principal, execution identity or credential in the chain was not valid at the action timestamp (expired, revoked, suspended or not yet valid);
- the execution identity is bound to a different principal;
- the credential is bound to a different execution identity;
- the cited delegation was issued to a different principal;
- a delegation in the chain has approval state `REJECTED` or `EXPIRED`.

**UNKNOWN** if any of:

- no root principal can be established;
- the delegation chain contains conflicting or missing links;
- the effective scope cannot be established;
- neither requested nor exercised scope is recorded;
- the action has no timestamp.

**CONDITIONAL** if a permission the action's policy marks as requiring approval was used without `APPROVED` (whether or not the action ran), or a delegation in the chain is still `PENDING` and the action ran.

**ALLOW** otherwise.

The derived decision is evidence, not configuration: disabling a rule removes its findings and marks its checks `SKIPPED`, but it does not change the derived decision. The decision agreement is `AGREE` or `DISAGREE` when both the recorded and the derived decision are definite, and `UNVERIFIABLE` when the recorded decision is missing or `UNKNOWN`, or the derived decision is `UNKNOWN`.

## Action time versus provision time

A decision made once, when authority was provisioned, keeps allowing actions after the authority behind it has ended. REGENT checks validity at the action timestamp:

- A delegation hop is `NOT_YET_VALID` if created after the action, `REVOKED` if revoked at or before it, `EXPIRED` if expired at or before it, `UNKNOWN` if it has no creation time, and `VALID` otherwise.
- Principals (root, every delegator, the actor), the execution identity and the credential are checked the same way, including `suspended_at` for principals.
- `recorded_status` is never used for these decisions; only recorded timestamps are.

An action counts as executed if `downstream_result` is `success` or `partial`, or if no result is recorded and the recorded decision is not `DENY`. When something was invalid but the action did not execute, the temporal check passes and notes that the refusal was the correct outcome.

When an executed action relied on something invalid, REGENT chooses between two explanations:

- **Supersession rule.** If the decision was evaluated (`authorization_evaluated_at`) before the action, and at least one revocation or expiry happened after that evaluation and at or before the action, the decision was cached across the change. REGENT emits a single `ACTION_TIME_AUTHORIZATION_FAILURE` and no separate stale-delegation or revoked-identity findings for that action: the action-time failure explains them. Its root cause states both sides: what was decided at provision time, and what was true at action time.
- **Otherwise** each invalid element is its own finding: `STALE_DELEGATION` for an expired or revoked delegation, `BROKEN_DELEGATION_CHAIN` for a delegation created after the action (timestamps that run backwards), `REVOKED_IDENTITY` for a principal or execution identity, `REVOKED_CREDENTIAL` for a credential.

The temporal check is also `WARN` when an executed action records no `authorization_evaluated_at` (REGENT cannot confirm the decision was made at action time), or when the evaluation is timestamped after the action. Scenario 11 (`action-time-authorization`) and the four tests under "action-time authorization" in `packages/core/test/engine.test.ts` cover the cases: cached decision, decision after revocation that still allowed, correct refusal, and the same action before revocation.

## Time travel

`authorityAt(bundle, at)` in `timetravel.ts` reports the authority that existed at an instant: the state of every delegation, principal and credential at that time, and for each principal holding at least one in-force delegation whose whole path is in force, the union of the effective scopes it could exercise. Effective scope depends on grants, not clocks, so only validity is recomputed for the chosen instant. Holders whose scope is only an upper bound are marked `unverified`.
