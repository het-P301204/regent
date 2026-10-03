# Threat model

REGENT verifies evidence that other systems produced. That shapes the model: the evidence itself is untrusted input, the verdicts are only as good as the records behind them, and some attacks on the record (deletion before export, consistent forgery) are outside what a verifier can see. This page states each threat, what REGENT does about it, and what remains.

The implemented controls are listed in [security-model.md](security-model.md).

## Assets

| Asset | Why it matters |
|---|---|
| Identity data | Principals, execution identities and their bindings decide who an action is attributed to. |
| Delegation data | Delegations, their parents, granted scopes and validity windows decide what authority existed. |
| Policies | Recorded authorization policy versions (ceilings, approval requirements) and REGENT's own verification rule configuration decide what is reported. |
| Event records | Action records are the subject of every verdict. |
| Findings | Verdicts, triage status and notes drive incident response and audit conclusions. |
| Credential metadata | Credential ids, types, bindings and validity. No secret material is stored, but the metadata still describes an organization's authentication topology. |
| REGENT's own accounts | Sessions, API tokens, user roles and the audit log. |

## Trust boundaries

| Boundary | Trust |
|---|---|
| Evidence producer → REGENT ingestion | Untrusted. Every record is a claim by the system under audit. Shapes are validated; meaning is verified. REGENT cannot authenticate who produced a record. |
| Browser → API | Authenticated by session cookie with CSRF protection, or by bearer token. Only the API computes verdicts. |
| API → database | Trusted. The database is reachable only by the API (in Docker Compose, on an internal network with no published port). Anyone with database write access can change stored evidence and findings. |
| Operator → configuration | Trusted. Environment variables decide demo mode, cookie security, allowed origins and proxy trust. |
| CLI → local files | The user's own machine. Input files are untrusted content; `.regent/last.json` holds the full normalized evidence of the last analysis. |
| REGENT outputs → spreadsheets, PDF viewers, downstream tools | Outputs repeat untrusted evidence text; REGENT neutralizes the known injection vectors before emitting it. |

## Threats

### Forged events

An attacker (or a faulty exporter) submits action or delegation records that never happened.

- **Mitigation.** Every record is schema-validated, and every relationship is verified: a cited delegation must exist and must have been issued to the actor; parents must exist and must have been issued to the delegator; declared roots and delegators must match the reconstruction; execution identities and credentials must bind to the actor; unregistered references are findings. An action cannot grant itself authority. A forged action that does not fit the recorded chain shows up as a broken chain, an unattributable action, amplification or a binding mismatch (`tests/adversarial/forged-parent.json`, `missing-principal.json`).
- **Residual risk.** REGENT checks internal consistency, not authenticity. A complete, internally consistent forged dataset (forged delegations, identities and actions that agree with each other) verifies as healthy. Evidence digests are not signatures and cannot show who created a record. Signed evidence is on the [roadmap](roadmap.md), not implemented.

### Manipulated parent relationships

A record cites a parent delegation it was never entitled to, to borrow someone else's authority.

- **Mitigation.** A parent must have been issued to the delegator (`delegatee_mismatch` otherwise), and the delegator then holds nothing through it: available scope becomes unknown, the root is cleared for the action, and the derived decision is `DENY`. Without a recorded parent REGENT links only a unique candidate and refuses to choose between several (`ambiguous`). Cycles and chains over 32 hops are breaks. Links found by lookup are marked and make chain completeness `WARN`.
- **Residual risk.** If the attacker can also write the parent delegation record itself, the chain is consistent and passes (see forged events).

### Identity spoofing

An action claims to be performed by one principal while running as another identity, or presents someone else's credential.

- **Mitigation.** The execution identity must be bound to the recorded actor (`EXECUTION_IDENTITY_MISMATCH`), the credential must be bound to that execution identity (`CREDENTIAL_BINDING_MISMATCH`), and an unregistered actor, execution identity or credential is an `UNKNOWN_REFERENCE` with the relevant checks `UNKNOWN`. Credentials are never treated as principals, and an execution identity's standing permissions are never added to delegated authority.
- **Residual risk.** REGENT trusts the binding records in the evidence. It does not verify SPIFFE SVIDs, OAuth tokens or trust bundles cryptographically. If the registry itself is wrong, REGENT reports against the wrong registry.

### Scope manipulation

Evidence uses unusual permission strings to make an action look contained: wildcards, malformed permissions, look-alike prefixes, or a self-declared scope on the action.

- **Mitigation.** Wildcards are only trailing and match by segment (`customer.*` does not cover `customers.read`, a narrower wildcard never covers a broader one). Permissions that do not parse are kept as opaque literals that match only themselves, so they cannot vanish from a containment check (`tests/adversarial/invalid-scope-syntax.json`). Effective scope is an intersection and can never contain what a delegator did not hold. Requested scope is never authority. `delegated_scope` on an action is ignored.
- **Residual risk.** Permission strings mean whatever the producing system says they mean. REGENT compares strings under its grammar; it cannot know that a resource treats `customer.read` as granting more than its name suggests, or that two different strings are equivalent at the resource.

### Replay

The same event is submitted twice, or an old decision is reused for a new action.

- **Mitigation.** Records are keyed by id: an identical duplicate is collapsed with a warning, a conflicting duplicate is rejected with an error and the first record kept (`tests/adversarial/duplicate-event.json`). A decision evaluated before a revocation or expiry and reused afterwards is an `ACTION_TIME_AUTHORIZATION_FAILURE`. On the API side, sessions are bound to a CSRF token, and mutating requests need it.
- **Residual risk.** A replayed action under a new event id is a new action as far as the evidence says; REGENT does not detect semantic duplicates. REGENT does not observe token replay at the resource. A leaked REGENT API token stays valid until it expires (at most 365 days, 90 by default) or is revoked through `DELETE /api/tokens/{prefix}` or the Settings page.

### Event deletion

Records that would reveal a problem are removed: before export, inside REGENT's database, or by deleting a dataset.

- **Mitigation.** A deleted parent delegation leaves a dangling reference, which is a broken chain and an unattributable action rather than a silent pass. Every finding carries SHA-256 digests of the normalized records it rests on, and every run carries an input digest; the auditor evidence package contains both together with the full normalized evidence. Dataset deletion requires the analyst role, cannot remove the demo dataset, and is written to the audit log.
- **Residual risk.** REGENT cannot detect a record that was never emitted, or one removed before export together with everything that referenced it. Deletion or modification inside REGENT's database is detectable only if digests or an evidence package were kept outside REGENT and are compared later; nothing in REGENT is immutable, the audit log is an ordinary table, and a database administrator can change any row. Digests detect change; they do not prevent it and do not provide non-repudiation.

### Timestamp manipulation

Records are backdated or post-dated to move an action inside a validity window.

- **Mitigation.** Timestamps must be ISO-8601 with an explicit offset; anything else is treated as missing, which makes action-time checks `UNKNOWN` rather than `PASS`. Internal ordering is checked: a delegation that expires or is revoked before it was created produces `TIMESTAMP_ORDER` warnings; an action that predates the delegation it relies on is a `BROKEN_DELEGATION_CHAIN` (`tests/adversarial/conflicting-timestamps.json`); a decision timestamped after its action makes the temporal check `WARN`; an executed action with no evaluation time is `WARN`.
- **Residual risk.** Timestamps are trusted as recorded, apart from these internal-ordering checks. Consistent backdating across all related records is undetectable, and REGENT has no independent clock or time-stamping authority. Clock skew between producers can create false ordering findings or hide real ones.

### Cross-tenant access

A user of one organization reads or changes another organization's evidence or findings.

- **Mitigation.** Every query filters on the caller's `organization_id`; dataset ids are random (`ds_` plus 16 hex characters) and looked up together with the organization; triage state and rule configuration are keyed by organization. The API test "cannot read or activate another organization's dataset" checks activation, `?dataset=` access and dataset listing across tenants.
- **Residual risk.** Isolation is enforced in application code, not by PostgreSQL row-level security; a missing filter in a future query would not be caught by the database. All tenants share one database.

### Hostile content in reports

Evidence text is crafted to attack whoever reads REGENT's output: terminal escape sequences that rewrite or hide CLI output, spreadsheet formulas, bidirectional-override characters that visually reorder text, other control characters, or markup.

- **Mitigation.** Every imported string is stripped of C0 and C1 control characters (ESC included) and bidi overrides at ingestion, before parsing, with a `TEXT_SANITIZED` warning; malformed reference ids are nulled and an action with an invalid `event_id` is rejected. CSV cells are neutralized against formula injection and stripped of bidi and control characters; PDF text is stripped and mapped into the font's character set; the console renders text through React's escaping and never injects HTML; download file names are sanitized. Tested in "CSV neutralises formula injection and bidi overrides from imported evidence" and "strips terminal escapes and bidi overrides from text, and nulls malformed references".
- **Residual risk.** JSON exports and the evidence package carry evidence text unchanged, because they are data; consumers that render them must escape them. Characters outside the PDF fonts' set appear as `?`, which loses information but cannot mislead.

### Abuse of the service

Oversized or deeply nested input, datasets shaped to cause worst-case work, request floods, brute-force sign-in, or credentials left over from demo mode.

- **Mitigation.** Request bodies limited while streaming (256 KiB, or about 5.5 MiB for imports by default); count limits in the engine and ChainSpec caps; a 32-hop limit and a recursion guard; no quadratic work in the engine or the API views (measured, and asserted by a performance test on a 15,000-action dataset); rate limits per address (10/min for password sign-in, with `X-Forwarded-For` read from the right and IPv6 bucketed by /64), per account (20 sign-in attempts per 15 minutes across addresses) and per user (30/min builder verify); structured errors without stack traces. Demo sessions and tokens stop working the moment demo mode is turned off.
- **Residual risk.** Rate limits are per process and in memory; several replicas multiply them and a restart resets them. Verification runs on the API's event loop, so a large import (bounded by the 50,000-record limit; about 4 seconds for 50,000 records in the benchmark) blocks other requests while it runs. Demo mode, if left on, lets anyone sign in as the demo admin of the synthetic organization.

## Security properties

| Property | What REGENT provides | What it does not |
|---|---|---|
| Integrity | Change detection: SHA-256 digests of every normalized record and of each run's input; migrations checksummed; conflicting duplicates reported. | Tamper prevention, signatures, immutable storage, non-repudiation. |
| Attribution | Every action is traced to a root principal through recorded delegations, or reported as unattributable with the exact break. | Proof that the records are authentic. |
| Confidentiality | Role-based access (raw evidence exports need the auditor role), organization-scoped queries, demo personas kept in their own organization, hashed and expiring sessions and tokens, no credential secrets stored, strict CORS and CSP, no outbound connections. | Encryption at rest beyond what the database provides; field-level access control. |
| Deterministic verification | Same evidence and rule set → byte-identical run, independent of record order and machine. | Determinism of the API's own metadata (run ids, creation times, evidence package generation time). |
| Evidence preservation | Normalized records stored per dataset; findings point to records by id and digest; evidence package bundles evidence, findings, controls and rule set; triage state survives re-runs. | Retention of the raw uploaded file (only its SHA-256 is stored), legal hold, or write-once storage. |

## Out of scope

- Authenticating evidence producers or verifying signatures on records.
- Runtime enforcement: REGENT does not block, gate or revoke anything.
- Verifying credentials cryptographically (SPIFFE SVIDs, OAuth tokens, API keys).
- Detecting records that were never emitted.
- Deciding legal or regulatory compliance. The GRC controls and the standards mapping are REGENT's own conceptual mapping; no compliance is claimed.
- Attacks on the host, the database server or the container runtime, beyond the hardening described in [deployment.md](deployment.md).
