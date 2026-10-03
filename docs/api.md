# API

The REGENT API is a JSON HTTP API served by `apps/api` (Hono on Node.js). Every verdict it returns is computed server-side by `@regent/core`; the API never asks a client to decide anything. In production the same process also serves the web console, so the console and the API share one origin.

The OpenAPI 3.1 description is served at `GET /api/openapi.json` (no authentication). It is hand-written in `apps/api/src/openapi.ts`, and the API test suite checks that every documented path is routed. At the time of writing it lags this page in three places: it does not list `GET /api/tokens` or `DELETE /api/tokens/{prefix}`, its token-creation schema omits `expires_in_days`, and it gives `POST /api/scenarios` and the `events.*` exports the old minimum role. This page reflects the routes in `apps/api/src/app.ts`.

Examples below use:

```bash
export REGENT_URL=http://127.0.0.1:8787      # or http://localhost:5173 in development (Vite proxies /api)
export REGENT_TOKEN=rgt_...                   # an API token, see below
```

## Authentication

Two mechanisms, both resolved by the `authenticate` middleware in `apps/api/src/security.ts`.

### Session cookie (the console)

`POST /api/auth/login` (email and password) or `POST /api/auth/demo` (demo persona, only when `REGENT_DEMO_MODE` is on) creates a session and sets two cookies:

| Cookie | Flags | Contents |
|---|---|---|
| `regent_session` | `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when `REGENT_COOKIE_SECURE` is true (the production default) | A random 32-byte session token. Only its SHA-256 hash is stored in the database. |
| `regent_csrf` | `SameSite=Strict`, `Path=/`, readable by script | The session's CSRF token. |

Sessions last `REGENT_SESSION_HOURS` (default 8). The CSRF token is also returned in the JSON body of the sign-in response and by `GET /api/auth/session`.

Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) are protected in three layers (the `csrf` middleware):

1. **Synchronizer token.** With a session cookie, the request must send the session's CSRF token in the `X-REGENT-CSRF` header. The server compares it with the token stored server-side for that session; a missing or different value is `403 CSRF_TOKEN_INVALID`.
2. **Origin check.** Any mutating request that carries an `Origin` header must come from the API's own origin or an origin in `REGENT_ALLOWED_ORIGINS`, otherwise `403 ORIGIN_REJECTED`.
3. **JSON only.** Every mutating request that has a body, and every `POST` that declares a content type, must send `Content-Type: application/json`, otherwise `415 UNSUPPORTED_MEDIA_TYPE`. A cross-site form or `text/plain` request (a browser "simple request") therefore cannot reach any mutating route, including sign-in and demo sign-in. Body-less `POST` and `DELETE` requests without a content type (for example `POST /api/analyze`) are accepted.

```bash
# Sign in as the demo analyst (development) and keep the cookies
curl -s -c jar.txt -X POST "$REGENT_URL/api/auth/demo" \
  -H "Content-Type: application/json" -d '{"persona":"analyst"}'
# {"ok":true,"csrf_token":"..."}
CSRF=$(curl -s -b jar.txt "$REGENT_URL/api/auth/session" | jq -r .csrf_token)
```

### Bearer tokens (automation)

API tokens belong to password accounts. Demo personas cannot create them (`403 DEMO_PERSONA`).

```bash
# Sign in with a password account, then create a token (analyst or admin); it is shown once
curl -s -c jar.txt -X POST "$REGENT_URL/api/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"..."}'
CSRF=$(curl -s -b jar.txt "$REGENT_URL/api/auth/session" | jq -r .csrf_token)
curl -s -b jar.txt -X POST "$REGENT_URL/api/tokens" \
  -H "Content-Type: application/json" -H "X-REGENT-CSRF: $CSRF" \
  -d '{"name":"ci","expires_in_days":30}'
# {"token":"rgt_...","prefix":"rgt_XXXXXXXXXXXXXXXX","expires_at":"...","note":"Shown once. Store it in a secret manager."}
```

Send it as `Authorization: Bearer rgt_...`. A token acts as the user who created it, with that user's role and organization.

- **Storage.** Only the SHA-256 hash is stored, together with a 20-character prefix (`rgt_` plus 16 characters) that identifies the token in lists without revealing it.
- **Expiry.** `expires_in_days` is 1 to 365 and defaults to 90; the response carries `expires_at`. Expired tokens are rejected. (Migration `0002_token_expiry.sql` gave tokens created before expiry existed 90 days from their creation.)
- **Listing.** `GET /api/tokens` lists tokens with prefix, name, owner, creation, last use, expiry and revocation times. Admins see every token in their organization; analysts see their own.
- **Revocation.** `DELETE /api/tokens/{prefix}` revokes a token immediately. Admins can revoke any token in their organization; analysts their own. The console's Settings page lists and revokes tokens.
- **CSRF.** Bearer requests carry no ambient credentials, so they skip the CSRF token check; the `Origin` and content-type checks still apply.

An unknown, expired or revoked token is `401 INVALID_TOKEN`.

### Roles

Roles are ordered; each includes the ones before it.

| Role | Can additionally |
|---|---|
| `viewer` | Read everything in the organization's datasets; switch the active dataset and reset to the demo dataset; verify a ChainSpec without saving; replay; download findings as JSON and CSV. |
| `auditor` | Download the raw evidence exports (`events.json`, `events.csv`), the security report PDF, investigation PDFs and the auditor evidence package. |
| `analyst` | Create, list and revoke their own API tokens (password accounts only); validate and import evidence; generate synthetic datasets; load scenarios (each creates a dataset); re-run verification; triage findings; save built chains; delete non-demo datasets. |
| `admin` | Change and reset verification rules; list and revoke every API token in the organization; read REGENT's own audit log. |

Note that `analyst` ranks above `auditor`, so analysts can also download evidence exports and reports. A request below the required role is `403 FORBIDDEN`; an unauthenticated request is `401 UNAUTHENTICATED`.

### Demo personas

With `REGENT_DEMO_MODE=true` (the default in development; in production mode it defaults to `false`, and only the exact value `true` enables it), four password-less personas of the fictional Acme AI Operations organization can sign in through `POST /api/auth/demo`: `admin` (Rowan Hale), `analyst` (Sam Ortiz), `auditor` (Jordan Lee), `viewer` (Casey Wu). With demo mode off the endpoint returns `404 DEMO_DISABLED`, and demo credentials stop working at once: sessions and tokens of demo personas are rejected on every request, and at startup the API deletes demo sessions and revokes any demo tokens (it also purges expired sessions).

## Datasets and the active workspace

Evidence lives in datasets owned by an organization. Each dataset has a source (`demo`, `scenario`, `import`, `builder`), its normalized records, its ingestion issues and its verification runs. Each user has an active dataset; read endpoints operate on the latest run of it, falling back to the organization's demo dataset if it has one (only the demo organization does). Any endpoint that works on the active dataset also accepts `?dataset=<id>` to target another dataset of the same organization. A dataset id from another organization returns `404`.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request did not match the expected shape.",
    "details": [{ "path": "principals.0.type", "message": "Invalid option: expected one of \"human\"|\"agent\"|\"sub_agent\"" }],
    "request_id": "6f1c2d0e-..."
  }
}
```

`request_id` is also returned in the `X-Request-Id` response header and written to the server log. An `X-Request-Id` request header matching `^[A-Za-z0-9-]{8,64}$` is reused; otherwise a UUID is generated. Unexpected errors return `500 INTERNAL` with a generic message; the stack trace is logged server-side and never sent to the client.

| Status | Codes |
|---|---|
| 400 | `INVALID_JSON`, `VALIDATION_FAILED` (up to 20 path/message pairs in `details`), `UNKNOWN_SCENARIO` (generate), `NOTE_REQUIRED`, `INVALID_TIME`, `MISSING_PARAMS` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN` |
| 403 | `FORBIDDEN`, `CSRF_TOKEN_INVALID`, `ORIGIN_REJECTED`, `DEMO_PERSONA` |
| 404 | `NOT_FOUND`, `NO_DATASET`, `NO_DEMO`, `DEMO_DISABLED`, `UNKNOWN_SCENARIO` (load) |
| 413 | `TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `NOTHING_ACCEPTED` (no record in an import passed validation; the first 50 issues are in `details`) |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |
| 503 | `GET /api/health` when the database is unavailable |

## Rate limits

Fixed-window limits held in memory in the API process: they apply per instance and are not shared across replicas. Expired windows are swept periodically. Responses carry `RateLimit-Limit` and `RateLimit-Remaining`; a `429` also carries `Retry-After`.

| Bucket | Applies to | Keyed by | Limit |
|---|---|---|---|
| `api` | every `/api/*` request | client address | 600 per minute |
| `auth` | `POST /api/auth/login` | client address | 10 per minute |
| per account | `POST /api/auth/login` | email address, across all client addresses | 20 attempts per 15 minutes |
| `demo-auth` | `POST /api/auth/demo` | client address | 60 per minute |
| `import` | `POST /api/events/validate` | client address | 30 per minute |
| `import` | `POST /api/events` | client address | 20 per minute |
| `builder` | `POST /api/builder/verify` | user | 30 per minute |

The client address is the socket address by default. Behind trusted reverse proxies, set `REGENT_TRUST_PROXY_HOPS=N`: the client is then the Nth `X-Forwarded-For` entry counted from the right, because everything to its left was supplied by the client and can be forged. The legacy `REGENT_TRUST_PROXY=true` means one hop. IPv4-mapped addresses are reduced to IPv4, and IPv6 addresses are bucketed by /64, so rotating the interface identifier does not reset a limit.

## Limits

Request bodies are limited while they are read, so a chunked body without `Content-Length` cannot bypass the limit:

- `/api/events` and `/api/events/*`: 1.1 × `REGENT_MAX_IMPORT_BYTES` (default 5 MiB) plus 4 KiB; in addition, a `Content-Length` above 1.1 × the limit, or a `content` field longer than the limit, is rejected;
- every other `/api/*` request: 256 KiB.

An oversized body is `413 TOO_LARGE`. The engine's own limits (50,000 records, 16 KiB of parameters per action, 256 permissions per scope, 32 hops) are listed in [delegation-model.md](delegation-model.md#values-and-limits).

## Endpoints

The minimum role is shown for each endpoint; `none` means no authentication. Some list fields in detail views are capped so that one heavily shared delegation, credential or finding cannot produce an unbounded response; where a list is capped, the exact count is returned next to it:

| View | Capped list | Exact count |
|---|---|---|
| `GET /api/findings/{id}` | `related_actions`, 200 | `related_total` |
| `GET /api/delegations` | `used_by`, 100 per delegation | `used_by_total` |
| `GET /api/delegations/{id}` | `used_by`, 200 | — |
| `GET /api/credentials` | `uses`, 200 per credential | `use_count` |
| `GET /api/identities/{id}` | `actions`, 500 | — |

### System

| Method and path | Role | Description |
|---|---|---|
| `GET /api/health` | none | Service and database health: `status`, `database`, `database_engine` (`pglite` or `postgres`), `demo_mode`, `version`. `503` if the database does not answer. |
| `GET /api/openapi.json` | none | The OpenAPI document. |
| `GET /api/audit-log` | admin | The latest 200 entries of REGENT's own audit log for the organization, with the acting user's name and email. |

```bash
curl -s "$REGENT_URL/api/health"
curl -s "$REGENT_URL/api/openapi.json" | jq '.paths | keys'
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/audit-log"
```

### Authentication

| Method and path | Role | Body | Description |
|---|---|---|---|
| `POST /api/auth/login` | none | `{"email","password"}` | Password sign-in. Wrong email and wrong password return the same `401 INVALID_CREDENTIALS`, with similar work done in both cases. |
| `POST /api/auth/demo` | none | `{"persona": "admin" \| "analyst" \| "auditor" \| "viewer"}` | Demo persona sign-in (demo mode only). |
| `POST /api/auth/logout` | session | — | Deletes the session and clears both cookies. |
| `GET /api/auth/session` | none | — | `{authenticated:false, demo_mode, personas}` or the user, organization, CSRF token and active dataset. |
| `POST /api/tokens` | analyst (password accounts only) | `{"name", "expires_in_days"?}` | Creates an API token; `expires_in_days` is 1–365, default 90. Returns the token once, its prefix and `expires_at`. Demo personas get `403 DEMO_PERSONA`. |
| `GET /api/tokens` | analyst | — | Lists tokens: prefix, name, owner, creation, last use, expiry and revocation times. Admins see the organization's tokens, others their own. Up to 200, newest first. |
| `DELETE /api/tokens/{prefix}` | analyst | — | Revokes an active token by its 20-character prefix. Admins can revoke any token in the organization, others only their own; anything else is `404`. |

```bash
curl -s -c jar.txt -X POST "$REGENT_URL/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}'
curl -s -b jar.txt -X POST "$REGENT_URL/api/auth/logout" -H "X-REGENT-CSRF: $CSRF"
curl -s -b jar.txt "$REGENT_URL/api/auth/session"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/tokens"
curl -s -X DELETE -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/tokens/rgt_XXXXXXXXXXXXXXXX"
```

### Datasets

| Method and path | Role | Description |
|---|---|---|
| `GET /api/datasets` | viewer | Datasets in the organization with their latest run, and the active dataset id. |
| `POST /api/datasets/{id}/activate` | viewer | Make a dataset the caller's active dataset. |
| `POST /api/datasets/reset-demo` | viewer | Switch back to the demo dataset. |
| `DELETE /api/datasets/{id}` | analyst | Delete an imported, scenario or builder dataset. The demo dataset cannot be deleted. |
| `GET /api/datasets/{id}/issues` | viewer | Ingestion issues recorded for a dataset. |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/datasets"
curl -s -X POST -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/datasets/ds_0123456789abcdef/activate"
curl -s -X POST -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/datasets/reset-demo"
curl -s -X DELETE -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/datasets/ds_0123456789abcdef"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/datasets/ds_0123456789abcdef/issues"
```

### Ingestion

The import body is `{"name", "filename"?, "format"?: "json" | "jsonl" | "auto", "content"}`, where `content` is the evidence file's text (any format from [delegation-model.md](delegation-model.md#input-formats)). Imported records are untrusted evidence: rejected records are reported with reasons; accepted records are normalized, stored relationally and verified. The raw upload itself is not stored, only its SHA-256 (`input_sha256`) and the normalized records.

| Method and path | Role | Description |
|---|---|---|
| `POST /api/events/validate` | analyst | Parse and normalize without storing. Returns stats, up to 500 issues, the issue count, and principal, delegation and action counts. |
| `POST /api/events` | analyst | Import as a new dataset, verify it and make it active. `201` with the dataset, run id, stats, issues and summary. `422` if nothing was accepted. |
| `POST /api/events/generate` | analyst | `{"scenarios": [slug, ...]}` (1–12): build one synthetic dataset from several scenarios. |

```bash
jq -Rs '{name: "Example import", filename: "events.json", content: .}' examples/events.json \
  | curl -s -X POST "$REGENT_URL/api/events/validate" -H "Authorization: Bearer $REGENT_TOKEN" \
      -H "Content-Type: application/json" --data-binary @-
jq -Rs '{name: "Example import", filename: "events.json", content: .}' examples/events.json \
  | curl -s -X POST "$REGENT_URL/api/events" -H "Authorization: Bearer $REGENT_TOKEN" \
      -H "Content-Type: application/json" --data-binary @-
curl -s -X POST "$REGENT_URL/api/events/generate" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"scenarios":["authority-amplification","stale-delegation"]}'
```

### Verification

| Method and path | Role | Description |
|---|---|---|
| `POST /api/analyze` | analyst | Re-run verification of the active dataset with the organization's current rule set. Returns the run id, input digest, rule set version and summary. |
| `GET /api/runs` | viewer | Up to 50 runs of the active dataset, newest first, with digests, rule set and engine versions, durations and summaries. |
| `GET /api/overview` | viewer | Command center aggregates: metrics, hourly activity by chain health, risk distribution, per-dimension results, finding status counts, recent findings and actions. |

```bash
curl -s -X POST -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/analyze"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/runs"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/overview" | jq .metrics
```

### Chains

| Method and path | Role | Description |
|---|---|---|
| `GET /api/chains` | viewer | One row per action. Filters: `health` (`verified`, `incomplete`, `violated`, `unknown`), `actor`, `root`, `resource`, `tool`, `decision`, `severity` (worst finding severity), `attribution` (`attributable`, `unattributable`), `authority` (check result), `policy`, `from`, `to` (ISO timestamps), `q` (text). `sort`: `time_desc` (default), `time_asc`, `risk`. `limit` (default 200, max 1000), `offset`. Also returns facets. |
| `GET /api/chains/{id}` | viewer | Full verification of one action (action or event id): hops, checks, findings, involved principals and records, explanation and replay. |
| `GET /api/chains/{id}/replay` | viewer | Replay timeline for one action. |
| `POST /api/replay` | viewer | `{"event_id"}`: replay and explanation together. |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/chains?health=violated&sort=risk&limit=20"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/chains/evt-0042" | jq .explanation
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/chains/evt-0042/replay"
curl -s -X POST "$REGENT_URL/api/replay" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"event_id":"evt-0042"}'
```

### Findings

| Method and path | Role | Description |
|---|---|---|
| `GET /api/findings` | viewer | Findings of the latest run with triage status. Filters: `severity`, `type`, `status`, `rule`, `principal`, `resource`, `q`. |
| `GET /api/findings/{id}` | viewer | One finding, its evidence references with the referenced normalized records, related actions (up to 200, with `related_total`) and principal names. |
| `PATCH /api/findings/{id}` | analyst | `{"status": "OPEN" \| "INVESTIGATING" \| "ACCEPTED" \| "RESOLVED" \| "SUPPRESSED", "note"?}`. A note is required to accept or suppress. The audit log entry records the dataset id and the previous and new status. |

Triage status is stored per organization, dataset and finding id. Because finding ids are stable across runs, status survives a re-run.

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/findings?severity=critical"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/findings/REG-AMP-e38c7a42f8"
curl -s -X PATCH "$REGENT_URL/api/findings/REG-AMP-e38c7a42f8" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"INVESTIGATING","note":"Checking LedgerPost credentials"}'
```

### Registry

| Method and path | Role | Description |
|---|---|---|
| `GET /api/identities` | viewer | Principals with lifecycle (as of the latest action time), inbound delegations, execution identities, last activity and finding count; principals referenced but not registered; execution identities; credentials; tools; resources. |
| `GET /api/identities/{id}` | viewer | One principal with its inbound and outbound delegations, execution identities, actions and findings. |
| `GET /api/delegations` | viewer | Delegations with available and effective scope, amplification, the actions that used them, findings and a contract integrity summary (`PASS`, `WARN`, `VIOLATION`, `UNVERIFIED`). |
| `GET /api/delegations/{id}` | viewer | One delegation with its hop analysis, policy, parent, children, uses and findings. |
| `GET /api/credentials` | viewer | Credential lineage: binding, bound principal, actors that used it, uses, and binding conditions (`NO_BINDING`, `BINDING_TO_UNKNOWN_IDENTITY`, `NO_PARENT_LINEAGE`, `USED_OUTSIDE_BINDING`, `REVOKED_CREDENTIAL_USED`, `STALE_CREDENTIAL_USED`). |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/identities"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/identities/agent-recon"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/delegations"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/delegations/del-ops-recon"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/credentials"
```

### Rules and policies

| Method and path | Role | Description |
|---|---|---|
| `GET /api/rules` | viewer | The organization's verification rule set. |
| `PUT /api/rules/{id}` | admin | `{"enabled"?, "severity"?, "applies_to"?, "remediation"?}` for `AUTH-001` … `AUTH-010`. Returns the new rule set. |
| `POST /api/rules/reset` | admin | Restore the defaults. |
| `GET /api/policies` | viewer | Authorization policies recorded in the active dataset, unversioned decisions, and the record completeness schema. |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/rules"
curl -s -X PUT "$REGENT_URL/api/rules/AUTH-007" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"severity":"low"}'
curl -s -X POST -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/rules/reset"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/policies"
```

See [policy-engine.md](policy-engine.md).

### Scenarios and builder

| Method and path | Role | Description |
|---|---|---|
| `GET /api/scenarios` | viewer | The scenario catalogue (without records). |
| `POST /api/scenarios` | analyst | `{"slug"}` (slug or number): load a scenario as a new dataset (hence the same role as an import), verify it and make it active. Returns `expected`, `produced` and `matches_expected`. |
| `POST /api/builder/verify` | viewer | Body is a ChainSpec (at most 24 principals, 40 delegations, 20 actions). Rate limited to 30 per minute per user. Verifies it without storing: run, explanations, replays, names, generated records and ingestion issues. |
| `POST /api/builder/save` | analyst | Body is a ChainSpec. Stores it as a dataset and makes it active. |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/scenarios" | jq '.scenarios[].slug'
curl -s -X POST "$REGENT_URL/api/scenarios" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"slug":"authority-amplification"}'
curl -s -X POST "$REGENT_URL/api/builder/verify" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" --data-binary @examples/chain.json | jq '.run.findings[].type'
curl -s -X POST "$REGENT_URL/api/builder/save" -H "Authorization: Bearer $REGENT_TOKEN" \
  -H "Content-Type: application/json" --data-binary @examples/chain.json
```

### Analysis views

| Method and path | Role | Description |
|---|---|---|
| `GET /api/time-travel` | viewer | Without `at`: checkpoints only. With `at` (ISO timestamp): the authority that existed at that instant, plus checkpoints and names. |
| `GET /api/diff` | viewer | `left`, `right` (action ids), optional `left_dataset`, `right_dataset`: compare two chains. |
| `GET /api/investigations/{event}` | viewer | Incident investigation starting from an event. |
| `GET /api/grc/controls` | viewer | Control evaluation (RGT-C1 … RGT-C7) derived from the latest run, with finding statuses. |
| `GET /api/grc/evidence-package` | auditor | Download the auditor evidence package (see below). |
| `GET /api/search` | viewer | `q`: fuzzy search across principals, chains, findings, events, credentials, tools, resources and delegations. |

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/time-travel?at=2026-10-03T14:30:00Z"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/diff?left=evt-0015&right=evt-0042"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/investigations/evt-0042"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/grc/controls"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/grc/evidence-package"
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/search?q=recon"
```

### Reports and exports

| Method and path | Role | Description |
|---|---|---|
| `GET /api/reports` | viewer | Available reports and exports for the active dataset. |
| `GET /api/reports/security.pdf` | auditor | Delegation Authority Security Report (PDF): executive summary, environment, analyzed chains, authority, attribution, identity and policy findings, controls, remediation, evidence and method. |
| `GET /api/reports/investigation/{event}` | auditor | Investigation report for one event (PDF); `.pdf` suffix optional. |
| `GET /api/exports/findings.json`, `GET /api/exports/findings.csv` | viewer | Findings: a `regent.findings/v1` wrapper of `regent.finding/v1` items, or CSV. |
| `GET /api/exports/events.json`, `GET /api/exports/events.csv` | auditor | Raw evidence: the normalized evidence (`regent.evidence/v1`), or one CSV row per action verification. Gated like the evidence package. |

Downloads are sent with `Content-Disposition: attachment` and a sanitized file name. The export name is validated (anything else is `404`) and the role is checked before anything is written to the audit log, so the log records only real exports. Every export and report download is audited.

```bash
curl -s -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/reports"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/reports/security.pdf"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/reports/investigation/evt-0042.pdf"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/exports/findings.json"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/exports/findings.csv"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/exports/events.json"
curl -s -OJ -H "Authorization: Bearer $REGENT_TOKEN" "$REGENT_URL/api/exports/events.csv"
```

CSV cells taken from evidence are neutralized against spreadsheet formula injection and stripped of bidirectional-override and control characters; PDF text is sanitized the same way. See [security-model.md](security-model.md#hostile-content-in-outputs).

## The `regent.finding/v1` schema

Machine-readable findings use a stable, versioned schema, defined as `FindingExportSchema` in `packages/core/src/schemas.ts` and produced by `toFindingExports`. The API's `findings.json` export, the evidence package, `regent analyze --json`, `regent findings --json` and `regent export` all use it.

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"regent.finding/v1"` | Schema identifier. |
| `finding_id` | string | `REG-<CODE>-<10 hex>`, stable for the same evidence and rule set. |
| `type` | string | One of the 16 finding types. |
| `rule_id` | string | `AUTH-001` … `AUTH-010`. |
| `severity` | `critical` \| `high` \| `medium` \| `low` \| `info` | From the rule set. |
| `status` | `OPEN` \| `INVESTIGATING` \| `ACCEPTED` \| `RESOLVED` \| `SUPPRESSED` | Triage status (`OPEN` outside the API). |
| `title`, `summary`, `root_cause`, `remediation` | string | Prose derived from the evidence and the rule. |
| `action_id`, `delegation_id` | string or null | What the finding is about. |
| `broken_edge` | object or null | First edge where the invariant broke: `from`, `to`, `hop_index`, `delegation_id`. |
| `affected_principal_ids`, `affected_resource_ids` | string[] | |
| `authority_delta` | object or null | `available`, `granted`, `requested`, `effective`, `exercised` (string[] or null) and `excess` (string[]). |
| `missing_fields` | string[] | Fields whose absence caused the finding. |
| `evidence` | object[] | `kind`, `id`, `event_id`, `digest` (`sha256:...` of the normalized record), `note`. |
| `related_event_ids` | string[] | |
| `first_seen`, `last_seen` | string or null | ISO timestamps from the evidence. |
| `input_digest` | string | Digest of the run's input (bundle, rule set, completeness schema, engine version). |
| `ruleset_version`, `engine_version` | string | |

Example, produced by `regent scenario authority-amplification` followed by `regent findings --json`:

```json
{
  "schema": "regent.finding/v1",
  "finding_id": "REG-AMP-672136ea9a",
  "type": "AUTHORITY_AMPLIFICATION",
  "rule_id": "AUTH-001",
  "severity": "critical",
  "status": "OPEN",
  "title": "Authority amplification",
  "summary": "CustomerAgent exercised customer.write, which no delegation in its chain legitimately conveyed.",
  "root_cause": "Alice Romero's authority reached CustomerAgent as {customer.read}. The action exercised {customer.read, customer.write}. No delegation in the chain grants it: the last delegation to CustomerAgent granted {customer.read}. The execution identity wl-customer-02 holds standing permission for {customer.write}: the action used the workload's own authority instead of the authority delegated to the agent. That is a confused deputy spread across a chain, authorized by no single component. Authority expanded across a delegation boundary, so the action is not contained in what was delegated.",
  "remediation": "Enforce the delegated scope at the tool or gateway at action time, and do not let a tool fall back to the standing permissions of its workload identity.",
  "action_id": "evt-s4-write",
  "delegation_id": null,
  "broken_edge": { "from": "agent-customer", "to": "tool-customer-update", "hop_index": null, "delegation_id": null },
  "affected_principal_ids": ["agent-customer", "agent-research", "human-alice"],
  "affected_resource_ids": ["res-customer-db"],
  "authority_delta": {
    "available": ["customer.read"],
    "granted": ["customer.read"],
    "requested": ["customer.read", "customer.write"],
    "effective": ["customer.read"],
    "exercised": ["customer.read", "customer.write"],
    "excess": ["customer.write"]
  },
  "missing_fields": [],
  "evidence": [
    { "kind": "action", "id": "evt-s4-write", "event_id": "evt-s4-write", "digest": "sha256:9d5a3c9284f0de49eb343f7305b71b2a7d61f2a8a7976ea1c0649f05eb9c2b72", "note": "The action record." },
    { "kind": "delegation", "id": "del-alice-research", "event_id": "evt-del-alice-research", "digest": "sha256:57f12c2314b3777a5b959aa55b54b2b3189b7b03cf484eaa2f24f1502700d488", "note": "Hop 1." },
    { "kind": "delegation", "id": "del-research-customer", "event_id": "evt-del-research-customer", "digest": "sha256:f8fa440100c529351be18195e3932e1ba3aa1b20dd5aaae19943f8c2362a5099", "note": "Hop 2." },
    { "kind": "execution_identity", "id": "wl-customer-02", "event_id": null, "digest": "sha256:94e60ad1f2a2a9c78fb5b2776de8085184923bbbe20c7d17d3cc6bfa9b6e76aa", "note": "Execution identity." },
    { "kind": "principal", "id": "agent-customer", "event_id": null, "digest": "sha256:eed38e782214e25ba5dee7139f4520e85287496676ddf5c913f1b67b050f8759", "note": "Actor principal." },
    { "kind": "principal", "id": "human-alice", "event_id": null, "digest": "sha256:cf08648b60f88f78a21a1740238dce6c16a7f1f75868c80acac9237a189aa41e", "note": "Root principal." },
    { "kind": "resource", "id": "res-customer-db", "event_id": null, "digest": "sha256:59748d4c08061cfebc739fadcdde8f02489b8a763f4ce633772f6e729367c22a", "note": "Target resource." },
    { "kind": "tool", "id": "tool-customer-update", "event_id": null, "digest": "sha256:e09cb188e2c106dc0d4e6f398e72cfc69b4f95ec791f9763450efeb0d9e1b319", "note": "Tool invoked." }
  ],
  "related_event_ids": ["evt-s4-write"],
  "first_seen": "2026-10-03T09:31:00.000Z",
  "last_seen": "2026-10-03T09:31:00.000Z",
  "input_digest": "sha256:f5029d7e52ec91e8d9da323183992b2b9862a08ab4668f834317b755f79e832b",
  "ruleset_version": "2026.10.1",
  "engine_version": "0.1.0"
}
```

New fields may be added in a later `v1`-compatible release; existing fields keep their names and meaning. A breaking change gets a new schema identifier.

## Auditor evidence package

`GET /api/grc/evidence-package` returns `regent.evidence-package/v1` as JSON with sorted keys: generation time and user, the dataset, the run (id, time, input digest, rule set and engine versions), the organization's rule set, the control evaluations, every finding in `regent.finding/v1` with its triage status, the full normalized evidence bundle, and a note that record digests are SHA-256 over canonical JSON and are not signatures. Keeping a copy of this package outside REGENT is what makes later changes to the stored evidence detectable; see [threat-model.md](threat-model.md).
