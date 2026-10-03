# Roadmap

Nothing on this page is implemented. These are the next steps that would close known gaps or widen the evidence REGENT can read. They are listed so that the current limits are explicit; there are no dates.

## Evidence integrity

- **Signed evidence.** Accept records signed by the producing system (for example JWS over the canonical JSON REGENT already computes) and verify signatures against configured keys, so a finding can say not only "this record has not changed since ingestion" but "this record was produced by that system". Today digests detect change and are not signatures.
- **Transparency log.** Append record and run digests to an append-only log (a Merkle tree with signed tree heads), so deletion or modification of stored evidence is detectable without relying on an external copy of the evidence package.
- **Retain the raw upload** alongside its SHA-256, for datasets where the original bytes need to be preserved.

## Importers

All importers would produce ordinary REGENT records and go through the same normalization and verification as any other input.

- **OpenTelemetry ingestion adapter.** Read agent and tool spans (for example GenAI semantic conventions) and map spans and their attributes to action records and delegations, with the mapping reported as ingestion issues where fields are missing.
- **OAuth 2.0 Token Exchange (RFC 8693) actor-claim importer.** Turn nested `act` claims of exchanged tokens into delegation chains, with the token as a credential record bound to the presenting workload.
- **SPIFFE bundle verification.** Verify SVIDs against SPIFFE trust bundles at import, so the binding between a credential and an execution identity is checked cryptographically rather than taken from the record.
- **SCIM lifecycle import.** Read user and group lifecycle events as principal creation, suspension and revocation.
- **MCP gateway logs.** Map MCP tool calls to action records with the tool, resource and requested scope.

## Policy

- **Policy-as-code ceilings.** Let an organization declare scope ceilings and approval requirements per agent type or tool in versioned files, evaluated alongside the ceilings recorded in the evidence, with the file's digest in the run's input digest.
- **Rule set history.** Keep every rule set revision, not only the current overrides, so any past run can be reproduced exactly from the API.

## Multi-tenancy and accounts

- **Multi-tenant admin UI and API.** Create organizations and users, assign roles, disable users. Today the only accounts are the demo personas (demo organization) and one bootstrap administrator (`org_primary`).
- **Single sign-on** for REGENT's own users through OpenID Connect.
- **Row-level security** in PostgreSQL as a second layer under the application's organization filters.
- **Shared rate limiting and caching** so more than one API instance can run.

## Hardening

Residual items from the internal security review (see [security-model.md](security-model.md#not-fixed)):

- **`__Host-` cookie prefix** for the session and CSRF cookies.
- **Pin GitHub Actions by commit SHA** instead of by tag.
- **Verification in a worker thread**, so a large import does not block the API's event loop.
- **Continuous purge** of expired sessions (today they are purged at startup and rejected once expired).

## Verification

- **Restriction evaluation.** Delegation `restrictions` (such as `customer-region=EU`) are recorded and displayed but not evaluated.
- **Streaming verification** for datasets beyond the 50,000-record import limit.

## Operations

- **First deployment.** Deploy the CI-verified image to a container host with a managed PostgreSQL, run `scripts/smoke.ts` against it, and record the result. See [deployment.md](deployment.md#status).
