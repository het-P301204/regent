# Policy engine

REGENT has two kinds of policy, and they must not be confused:

| | Verification rules | Authorization policies |
|---|---|---|
| What | REGENT's own invariants over the evidence, AUTH-001 to AUTH-010 | Policies recorded by the system under audit (`record_type: policy`) |
| Owned by | The REGENT deployment (per organization) | The system that made the decisions |
| Identified by | Rule id and rule set version | `policy_id` and `policy_version` |
| Effect | Decide which findings a verification run reports and with what severity | Contribute a scope ceiling and approval requirements to the evidence |
| Source | `packages/core/src/rules.ts` | Imported records, normalized by `normalize.ts` |

REGENT reads authorization policies but never edits them. Changing a verification rule changes what REGENT reports about the evidence; it never changes the evidence.

## Verification rules

| Rule | Title | Statement | Default severity | Finding types |
|---|---|---|---|---|
| AUTH-001 | Exercised authority must be contained in effective authority | Exercised ⊆ Effective for the principal that performed the action. | critical | `AUTHORITY_AMPLIFICATION` (at exercise), `SCOPE_VIOLATION` |
| AUTH-002 | Every delegation must have a recorded delegator chain | Each delegation names its delegator and, unless the delegator is a root principal, the delegation under which the delegator held its authority. | high | `BROKEN_DELEGATION_CHAIN` |
| AUTH-003 | Every action must resolve to a root principal | An action is traceable through a complete chain to the principal that originated the authority. | high | `UNATTRIBUTABLE_ACTION` |
| AUTH-004 | Sub-agents must receive explicit delegated authority | An agent acts or delegates only under a recorded delegation with an explicit granted scope. Spawning a sub-agent is a delegation event. | high | `ORPHANED_PRINCIPAL`, `MISSING_DELEGATED_SCOPE` |
| AUTH-005 | Authorization must be valid at action time | Every delegation, principal, execution identity and credential is valid when the action executes, and the decision is evaluated then. | high | `ACTION_TIME_AUTHORIZATION_FAILURE`, `STALE_DELEGATION`, `REVOKED_IDENTITY`, `REVOKED_CREDENTIAL` |
| AUTH-006 | Execution identity and credential must bind to the acting principal | The execution identity is issued to the actor and the credential is bound to that execution identity. | critical | `EXECUTION_IDENTITY_MISMATCH`, `CREDENTIAL_BINDING_MISMATCH` |
| AUTH-007 | Decision evidence must be recorded | Every decision records its policy version; every action records its requested scope. | medium | `MISSING_POLICY_VERSION`, `MISSING_REQUESTED_SCOPE` |
| AUTH-008 | Privileged actions must record approval | Permissions marked as requiring approval are exercised only with `approval_state = APPROVED`. | high | `MISSING_APPROVAL` |
| AUTH-009 | Unknown identities cannot receive implicit authority | Every referenced principal, execution identity, credential, tool and resource is known. | medium | `UNKNOWN_REFERENCE` |
| AUTH-010 | Delegation cannot increase authority | Granted ⊆ Effective(delegator). | high | `AUTHORITY_AMPLIFICATION` (at grant) |

Each rule also carries a remediation text, shown on every finding it produces. The full descriptions and remediation texts are in `DEFAULT_RULES`.

## Configuration

Four properties of a rule can be changed: `enabled`, `severity`, `applies_to` and `remediation`.

| Property | Effect |
|---|---|
| `enabled: false` | The rule produces no findings. Every dimension check whose rules are all disabled reports `SKIPPED` with the rule set version, for example `Skipped: AUTH-001 disabled in rule set test-1.` A disabled rule never turns a check into `PASS`, and the derived authorization decision is not affected. |
| `severity` | Severity of findings the rule produces from now on. |
| `applies_to` | A list of principal types (`human`, `agent`, `sub_agent`, `workload`, `service`). When non-empty, the rule produces findings only when the relevant principal is of a listed type: the actor for action findings, the delegatee for delegation findings, the orphaned principal for `ORPHANED_PRINCIPAL`. It does not make checks `SKIPPED`. |
| `remediation` | The remediation text attached to the rule's findings. |

A check maps to more than one rule in some cases (authority integrity maps to AUTH-010 and AUTH-001; identity binding to AUTH-006 and AUTH-009). Such a check reports `SKIPPED` only when all of its rules are disabled.

### In code

```ts
import { buildRuleSet, normalizeRecords, verify } from '@regent/core'

const ruleset = buildRuleSet({ 'AUTH-007': { severity: 'low' }, 'AUTH-001': { enabled: false } }, 'my-rules-1')
const run = verify(normalizeRecords(records).bundle, { ruleset })
```

`buildRuleSet` merges partial overrides onto the defaults and ignores unknown rule ids.

### Through the API

Admins change rules for their organization:

```bash
# Disable AUTH-008 for the organization
curl -X PUT https://regent.example.com/api/rules/AUTH-008 \
  -H "Authorization: Bearer $REGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Re-run verification so the active dataset reflects the change
curl -X POST https://regent.example.com/api/analyze -H "Authorization: Bearer $REGENT_TOKEN"

# Restore the defaults
curl -X POST https://regent.example.com/api/rules/reset -H "Authorization: Bearer $REGENT_TOKEN"
```

Changes take effect on the next verification run; existing runs keep the results they were computed with. In the console the same controls are on the Policy engine page.

## Rule set versioning

Every run records the rule set version it was produced with (`run.ruleset_version`), and the rule set is part of the input digest, so a different configuration always produces a different digest.

- The default rule set is `regent-default`, version `2026.10.1`.
- In the API, each organization stores its overrides in `rule_configs` and keeps a `ruleset_revision` counter. Every update or reset increments it. While the revision is 0 the organization uses `2026.10.1`; after changes the version is `2026.10.1+org.<revision>` and the rule set id is `regent-custom`. Resetting restores default values but still increments the revision, so the version string records that a change happened.
- Each change is recorded in REGENT's audit log (`rule.update`, `rule.reset`) with the user and the patch.

## Authorization policies in the evidence

A policy record contributes two things to verification:

- **Scope ceiling.** If a delegation names a policy version whose record has a `scope_ceiling`, the hop's effective scope is intersected with it, and the removed part is recorded as `policy_restricted`. If an action names a policy version with a ceiling, the actor's effective scope is intersected with it as well. Exercising something the chain conveyed but a ceiling removed is a `SCOPE_VIOLATION` (`tests/adversarial/conflicting-policy.json`).
- **Approval requirements.** `approval_required_for` lists permissions that need `approval_state = APPROVED`. A permission requested or exercised by the action is matched if either covers the other.

A policy is looked up by `policy_id` and `policy_version` together. If the action names a version whose record is not in the evidence, the policy traceability check is `WARN` and neither the ceiling nor the approval requirements are applied; REGENT says so in the check detail instead of assuming the policy was permissive. If the action names no version at all, the check is `FAIL` and `MISSING_POLICY_VERSION` is raised: a decision that cannot be tied to an exact policy revision cannot be reconstructed, and a policy change cannot be told apart from a bypass.

`GET /api/policies` lists the policy versions in the active dataset with how many decisions and delegations reference each, the events that recorded no policy version, and the record completeness schema.
