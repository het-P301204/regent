# Security model

This page lists the security controls that are implemented in the code, where they live, the boundary of what REGENT is, and the results of the internal security review. Threats, residual risks and what is out of scope are in [threat-model.md](threat-model.md).

## Security boundary

REGENT is a defensive verification tool. It reads evidence records that other systems produced, reconstructs delegation chains, and reports where the recorded authority does not hold together.

- It does not connect to, scan, test or exploit any target system. It has no network client in the engine and makes no outbound requests from the API.
- It does not enforce anything at runtime. It is not a gateway or a policy decision point; it verifies records after the fact.
- It never stores credential material. Credential records are metadata (id, type, binding, validity); the schema has no field for a secret value.
- All bundled data (scenarios, demo environment, adversarial datasets, examples) is synthetic.

Whatever a user imports is their own evidence. Imported content is untrusted throughout: as input to the engine, as text in the CLI's terminal output, in the console, and in exports and reports.

## API controls

| Control | Implementation | Where |
|---|---|---|
| Password hashing | scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), compared with `timingSafeEqual`. Sign-in with an unknown email runs a dummy verification and returns the same error as a wrong password. | `apps/api/src/auth.ts`, `app.ts` |
| Session tokens | 32 random bytes (base64url). Only the SHA-256 hash is stored. Expire after `REGENT_SESSION_HOURS` (default 8). Logout deletes the session row; expired sessions are purged at startup. | `auth.ts`, `sessions` table |
| Session cookie | `regent_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when `REGENT_COOKIE_SECURE` is true (default in production). | `app.ts` |
| CSRF protection | Three layers on every `POST`/`PUT`/`PATCH`/`DELETE`. (1) Synchronizer token: with a session cookie, `X-REGENT-CSRF` must equal the CSRF token stored server-side for that session (it is delivered to the page in the readable `regent_csrf` cookie and in the session response). (2) Origin check: a request with an `Origin` header must come from the API's own origin or an allowlisted origin. (3) JSON only: a mutating request with a body, or a `POST` declaring a content type, must use `Content-Type: application/json` (`415 UNSUPPORTED_MEDIA_TYPE` otherwise), so no cross-site "simple request" (form or `text/plain`) can reach a mutating route, sign-in and demo sign-in included. | `security.ts` (`csrf`) |
| API tokens | `rgt_` + 32 random bytes; only the SHA-256 hash is stored, with a 20-character prefix (`rgt_` plus 16 characters) for identification; shown once at creation. Expire after `expires_in_days` (1–365, default 90). Listed with `GET /api/tokens` (admins: the organization's tokens; others: their own) and revoked with `DELETE /api/tokens/{prefix}`, also from the console's Settings page. Demo personas cannot create tokens (`403 DEMO_PERSONA`). Bearer requests skip the CSRF token check but not the Origin and content-type checks. | `auth.ts`, `app.ts`, `api_tokens` table, migration `0002_token_expiry.sql` |
| CORS | Strict allowlist (`REGENT_ALLOWED_ORIGINS`). Only allowlisted origins receive `Access-Control-Allow-Origin` (never `*`) with credentials; an unlisted origin's preflight gets a bare `204` and the browser blocks the read. Production default allowlist is empty (same origin only). | `security.ts` (`cors`) |
| Roles | `viewer` < `auditor` < `analyst` < `admin`, checked on every route by `requireRole`. Anything that creates a dataset (imports, scenario loads, builder saves) needs `analyst`; raw evidence exports and the evidence package need `auditor`. | `security.ts`, `app.ts` |
| Tenant isolation | Every evidence and run query filters on `organization_id` as well as the dataset id; a dataset id from another organization returns nothing (`404`). Token listing and revocation are scoped to the organization. Tested in "tenant isolation". | `repo/evidence.ts`, `services/workspace.ts`, `app.ts` |
| Rate limiting | Fixed windows held in memory, swept periodically. Per client address: 600/min for all API calls, 10/min for password sign-in, 60/min for demo sign-in, 30/min validate, 20/min import. Per account: 20 sign-in attempts per 15 minutes across all addresses. Per user: 30/min builder verify. The client address is the socket address unless `REGENT_TRUST_PROXY_HOPS=N` is set, in which case it is the Nth `X-Forwarded-For` entry from the right (the legacy `REGENT_TRUST_PROXY=true` means 1 hop). IPv6 addresses are bucketed by /64. | `security.ts` (`rateLimit`, `clientAddress`, `bucketAddress`), `app.ts` |
| Input validation | Every request body is parsed with a zod schema; invalid input is `400 VALIDATION_FAILED` with paths and messages. Evidence is sanitized and validated record by record by the engine. | `app.ts`, `packages/core/src/schemas.ts`, `normalize.ts` |
| Size limits | Request bodies are limited while streaming: import endpoints to 1.1 × `REGENT_MAX_IMPORT_BYTES` (default 5 MiB) plus 4 KiB, every other API request to 256 KiB; import `content` ≤ `REGENT_MAX_IMPORT_BYTES`; ≤ 50,000 records; parameters ≤ 16 KiB per action; scope ≤ 256 items; text fields ≤ 4,096 characters; ids ≤ 192 characters of a restricted alphabet; ChainSpec ≤ 24 principals, 40 delegations, 20 actions, 32 permissions per scope; CLI input ≤ 50 MB. | `app.ts`, `schemas.ts`, `chainspec.ts`, `main.ts` |
| Bounded work | Chains are followed for at most 32 hops, and the walk stops at a recursion depth of 512 regardless. Finding relations are merged with sets, permission parsing is memoized (bounded cache) and hops are cached per delegation, so verification does no quadratic re-sorting. The API builds one index per verification run and caps long lists in detail views. | `chain.ts`, `verify.ts`, `scope.ts`, `apps/api/src/services/views.ts` (`indexOf`) |
| Parameterized SQL | All queries use `$1, $2, ...` placeholders. Bulk inserts build placeholder lists; table and column names are compile-time constants, never input. | `db/driver.ts`, `repo/evidence.ts`, `services/workspace.ts` |
| Security headers | `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, a restrictive `Permissions-Policy`, `Strict-Transport-Security` in production, `Cache-Control: no-store` on API responses. | `security.ts` (`secureHeaders`) |
| Errors | Structured error bodies with a code, message and request id. Unexpected errors return a generic `500 INTERNAL`; the stack trace is logged server-side (first six frames) and never sent to the client. | `app.ts` |
| Structured logging | One JSON line per request: time, level, request id, user id, organization id, operation, duration and status. Bodies, cookies, tokens and credentials are never logged. | `security.ts` (`logger`, `requestContext`) |
| Audit log | REGENT's own record of who did what: sign-ins, token creation and revocation, imports, scenario loads, verification runs, triage changes (with the dataset id), rule changes, dataset deletion and resets, builder saves, every export and report download. Export names and roles are validated before an entry is written. Readable by admins at `GET /api/audit-log`, with the acting user's name and email. | `app.ts`, `audit_log` table |
| Static file serving | Paths are normalized and must resolve inside `apps/web/dist`; anything else falls back to `index.html`; an undecodable path is `400`. Hashed assets are cacheable; everything else is `no-cache`. | `app.ts` (`serveStatic`) |
| Sign-in redirect | The console's `?next` parameter accepts only local paths and rejects control characters and encoded slashes or backslashes that could re-form `//host`. | `apps/web/src/pages/SignIn.tsx` |
| Secrets | No secrets in the repository. Sessions need no signing key; the only production credential is `DATABASE_URL`. The optional bootstrap admin password comes from the environment, must be at least 12 characters, and is stored only as a scrypt hash. `.dockerignore` keeps `.env` files, local databases, CLI state and `.git` out of the image build context. | `config.ts`, `bootstrap.ts`, `.dockerignore` |

## Hostile content in outputs

Imported evidence is attacker-controlled text, and REGENT repeats it in a terminal, a browser, spreadsheets and PDFs. It is cleaned once at ingestion and again where it is written.

| Place | Control |
|---|---|
| Ingestion | Every string in an imported record, keys included, is stripped of C0 control characters other than tab, LF and CR, of DEL and C1 control characters (U+007F–U+009F; this removes ESC, so terminal escape sequences cannot clear the screen or forge CLI output), and of bidirectional overrides and isolates (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C), before the record is parsed. A record that changed gets a `TEXT_SANITIZED` warning. This protects the CLI, the console, CSV and PDF alike. | 
| CSV exports | `csvCell` strips the same characters again, then prefixes a single quote to any value that starts with `=`, `+`, `-`, `@`, tab or CR, so a spreadsheet does not evaluate it as a formula, and quotes values containing commas, quotes or line breaks. |
| PDF reports | Every string is stripped of bidirectional and control characters and mapped into the character set of the built-in PDF fonts; anything outside it becomes `?`. |
| Web console | React escapes all rendered text; the console does not use `dangerouslySetInnerHTML`. |
| JSON exports | Data only. Consumers must treat the content as untrusted text. |
| Download names | File names in `Content-Disposition` are reduced to `[A-Za-z0-9._-]`, at most 80 characters. |

## Engine input safety

- Input is parsed with `JSON.parse`; nothing is evaluated.
- Unknown fields are dropped by the schemas, including `__proto__` and `constructor` keys. The ingestion sanitizer copies keys with `Object.defineProperty`, so a `__proto__` key stays inert data; canonical JSON builds objects with `Object.create(null)`, and bundle keys are read with `hasOwnProperty`. `tests/adversarial/malformed-events.json` carries prototype-pollution payloads, and the test checks that `Object.prototype` is untouched afterwards.
- Identifiers must match `^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$`. A record whose own id, or an action whose `event_id`, does not match is rejected (`INVALID_ID`). A malformed reference to another record (a delegation, principal, credential and so on) is set to `null` with an `INVALID_ID` warning, so it is treated as not recorded rather than matched against anything.
- An action cannot grant itself authority (`delegated_scope` on an action is ignored).
- Unparseable permissions are kept as opaque literals instead of being dropped, so they cannot slip out of a containment check.
- Declared roots and delegators are verified against the reconstructed chain, never trusted.
- An unknown identity never receives implicit authority; unknown results are never reported as `PASS`.

## Demo mode

With `REGENT_DEMO_MODE=true`, anyone who can reach the API can sign in as one of four password-less personas of the fictional Acme organization, including `admin`. Demo mode is on by default in development, so a fresh clone works, and off by default in production mode (`--production` or `NODE_ENV=production`, as in the Docker image); only the exact value `true` turns it on. The Docker Compose stack turns it on explicitly for local use.

Turning demo mode off takes effect immediately for existing credentials:

- every request authenticated by a demo persona's session or API token is rejected (`resolveSession` and `resolveApiToken` check the persona flag against the current mode);
- at startup, `purgeCredentials` deletes demo sessions, revokes demo API tokens and purges expired sessions;
- demo personas could not create API tokens in the first place.

Real accounts never share an organization with the demo personas. The bootstrap administrator (`REGENT_ADMIN_EMAIL`, `REGENT_ADMIN_PASSWORD`) is created in its own organization, `org_primary`; the demo organization `org_acme` and its synthetic dataset are still seeded on every start, but are reachable only through the demo personas.

Demo mode exists for local use and for public demonstrations of synthetic data; keep it off on any deployment that holds real evidence.

## Security review

An internal review of the API, engine, CLI and build configuration found the following issues. All of them are fixed in the code described above.

| Issue | Risk | Fix |
|---|---|---|
| Quadratic work on large datasets | One dataset of about 15,000 actions sharing the same findings made the engine re-sort finding relations on every merge and made API views scan whole runs per item, stalling the single event loop for tens of seconds: a denial of service by one import. | The engine merges relations with sets and sorts once, memoizes permission parsing and caches hops per delegation; the API builds a per-run index (`indexOf`, a `WeakMap` in `services/views.ts`) and caps long lists with exact totals. `apps/api/test/performance.test.ts` requires every main view to answer in under 3 seconds on a 15,000-action dataset; `scripts/bench.ts` measures the engine (see [testing.md](testing.md#performance)). |
| Demo credentials surviving demo-off | Sessions and tokens minted while demo mode was on kept working after it was turned off, and the bootstrap administrator shared the demo organization with password-less personas. | Demo credentials are rejected on every request when demo mode is off, purged at startup, and demo personas cannot create tokens. The bootstrap administrator lives in `org_primary`. |
| Non-revocable tokens | API tokens never expired and could not be listed or revoked through the API. | Tokens expire (1–365 days, default 90), can be listed and revoked through the API and the console, and existing tokens were given 90-day expiry by migration. |
| `X-Forwarded-For` trust | With proxy trust on, the left-most `X-Forwarded-For` entry, which the client controls, chose the rate-limit bucket; a client could rotate it, or rotate IPv6 interface identifiers, to escape limits. Sign-in was limited per address only. | `REGENT_TRUST_PROXY_HOPS` picks the entry from the right; IPv6 is bucketed by /64; a per-account sign-in limit applies across addresses; windows are swept periodically. |
| Builder CPU | `POST /api/builder/verify` is open to viewers and verifies synchronously; large ChainSpecs at 120 requests per minute per address could occupy the server. | ChainSpec caps reduced (24 principals, 40 delegations, 20 actions, 32 permissions per scope) and the endpoint limited to 30 requests per minute per user. |
| Inconsistent roles | Viewers could load scenarios, which creates datasets, and download the raw evidence exports, while the equivalent import and the evidence package required higher roles. | Scenario loads require `analyst`; `events.json` and `events.csv` require `auditor`. |
| CLI escape injection | Strings from imported evidence reached the terminal unmodified, so an ESC sequence in a record could rewrite or hide CLI output. Malformed reference ids passed through. | All imported strings are cleaned of C0/C1 controls and bidi overrides at ingestion (`packages/core/src/text.ts`, `TEXT_SANITIZED`); an action's `event_id` must be a valid identifier; malformed references become `null` with a warning. |
| Compose and build context | The Docker build context could include `.env` files, local databases and CLI state; the Compose stack allowlisted the Vite dev origins by default. | `.dockerignore` added; Compose allows only the 8787 origins by default (add 5173 for the dev profile). |
| JSON-only mutations | A cross-site form or `text/plain` POST is a "simple request" that browsers send without a preflight; only the token and Origin checks stood in its way, and sign-in endpoints have no token. | Mutating requests must be `application/json` (`415` otherwise). |
| Audit hygiene | An export request with an arbitrary file name was written to the audit log before being rejected; triage entries did not say which dataset they concerned. | Export names and roles are validated before auditing; `finding.status` entries include the dataset id; token revocation is audited. |

### Not fixed

These residual items were reviewed and accepted for now:

- Cookies do not use the `__Host-` prefix.
- GitHub Actions in the workflows are pinned by tag, not by commit SHA.
- Rate limits are per instance and held in memory; several replicas multiply them and a restart resets them.
- Verification runs on the API's event loop, not in a worker thread. It is bounded by the 50,000-record import limit and by the measured timings in [testing.md](testing.md#performance), but a large import still blocks other requests while it is verified.
- There is no user or organization management API. Besides the demo personas, the only password account is the bootstrap administrator in `org_primary`.

## Known gaps

Other limitations of the current implementation, not hidden features:

- The audit log is an ordinary table; it is not append-only at the database level.
- Expired sessions are purged at startup, not continuously; they are rejected as soon as they expire either way.
- Tenant isolation is enforced in application queries; PostgreSQL row-level security is not used.

See [roadmap.md](roadmap.md) for planned work.
