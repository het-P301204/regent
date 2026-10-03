# Testing

## Running the tests

| Command | What it runs |
|---|---|
| `npm test` | All Vitest suites: engine, API (against in-memory PGlite), production database driver, performance, CLI. Same as `npx vitest run`. |
| `npx vitest run packages/core` | Engine suites only. |
| `npx vitest run apps/api` | API, driver, security and performance suites. |
| `npx vitest run apps/cli` | CLI suite only. |
| `npm run build && npm run test:e2e` | Playwright end-to-end tests against the production build (`npx playwright install chromium` once first). |
| `npm run verify` | Lint, typecheck, `npm test` and the production build, in that order. Run this before a pull request. |
| `node scripts/bench.ts` | Engine benchmark on large, hostile-but-valid inputs. |
| `node scripts/smoke.ts <url>` | Post-deployment smoke test against a running instance. |

Vitest picks up `packages/*/test/**/*.test.ts`, `apps/api/test/**/*.test.ts`, `apps/cli/test/**/*.test.ts`, `tests/**/*.test.ts` and `apps/web/src/**/*.test.{ts,tsx}`, excluding `tests/e2e/` (`vitest.config.ts`). Tests run in forked processes with a 30-second timeout. None of them needs Docker, a database server or external network access (the driver test listens on a loopback port).

## What the suites cover

| Suite | File | Tests | Covers |
|---|---|---|---|
| Scope algebra | `packages/core/test/scope.test.ts` | 26 | Permission grammar (valid and invalid forms), covering (reflexive, wildcards, no narrower-covers-broader, segment boundaries, opaque literals), subset, excess, intersection as greatest lower bound and its commutativity, `minimal` and code-point ordering. |
| Engine | `packages/core/test/engine.test.ts` | 20 | Chain reconstruction (lookup marked as `WARN`, refusal to choose between candidates, declared root used only to disambiguate, contradicting declared root flagged, root acting directly, upper bound never `PASS`); authority monotonicity (amplification reported once where it entered, policy ceiling and scope violation, wildcard grants); action-time authorization (cached decision, decision after revocation, correct refusal, same action before revocation); approval separate from authorization; rule configuration (disabled rule → `SKIPPED` and no findings, severity override, `applies_to`, rule set version on the run); record completeness arithmetic. |
| Scenarios and demo | `packages/core/test/scenarios.test.ts` | 22 | The 12 scenarios each produce exactly their expected finding types; valid scenarios pass every check; targeted assertions on amplification location, grant-level amplification, action-time supersession and missing evidence; demo environment ingests cleanly and contains healthy and problematic chains. |
| Adversarial, ingestion, determinism, views, exports | `packages/core/test/ingestion-and-determinism.test.ts` | 37 | Every adversarial dataset produces exactly its documented findings; duplicate and malformed handling, including prototype-pollution safety; legacy aliases, JSONL with a broken line, self-granted authority ignored, timestamps without a timezone, bundles; terminal escapes and bidi overrides stripped at ingestion and malformed references nulled; an action with an invalid `event_id` rejected; determinism; explanation, replay, time travel, chain diff, control evaluation, investigation; `regent.finding/v1` validation; CSV formula and bidi neutralization. |
| API integration | `apps/api/test/api.test.ts` | 31 | Runs the real Hono app against in-memory PGlite with migrations and bootstrap applied, plus a second organization: health and security headers, every documented OpenAPI path is routed, structured errors without stack traces, unauthenticated access rejected, password sign-in with identical errors for unknown user and wrong password, CSRF header required, foreign origin rejected, JSON required on mutations (cross-site simple requests impossible), role enforcement, bearer tokens without CSRF plus token listing and revocation, no API tokens for demo personas, demo sessions refused once demo mode is off, only analysts load scenarios, raw evidence exports gated on the auditor role with the export name validated before auditing, tenant isolation, relational round trip giving the same input digest and finding ids as the engine, validation before storage, `422` when nothing is accepted, demo reset, `413` on oversized import, every scenario through the API, chain detail, chain filters, triage note requirement and persistence across re-runs, disabling a rule (`SKIPPED`, findings removed, restored on reset), builder verify and validation errors, time travel, diff, investigation, controls, search, JSON/CSV/PDF exports, evidence package, audit log, sign-in rate limiting. |
| Rate-limit bucketing | `apps/api/test/security.test.ts` | 2 | IPv4 and IPv4-mapped addresses kept as they are; IPv6 bucketed by /64. |
| Performance | `apps/api/test/performance.test.ts` | 7 | Imports 15,000 actions by one unregistered actor (so every finding is shared by all of them) and requires `/api/overview`, `/api/chains`, `/api/findings`, `/api/identities`, `/api/credentials` and `/api/delegations` each to answer in under 3 seconds after warming the per-run cache, and a finding shared by all 15,000 actions to open in under 3 seconds with `related_total` 15,000 and at most 200 related actions listed. This is the regression test for the quadratic-work denial of service found in the security review. |
| Production database driver | `apps/api/test/postgres-driver.test.ts` | 3 | The `node-postgres` driver used in production, connected over the PostgreSQL wire protocol to PGlite served on a local socket (`@electric-sql/pglite-socket`, port 55432): reports the `postgres` engine, applies migrations once and is idempotent, round-trips the demo dataset to the same input digest as the engine, and rolls back a failed transaction. This exercises the production code path without a PostgreSQL install; it is not a test against PostgreSQL itself. |
| CLI | `apps/cli/test/cli.test.ts` | 6 | Spawns the real CLI: analyze the documented example and reuse saved state, verify a ChainSpec and report amplification, replay with the first violation marked, `--fail-on` exit codes, export of `regent.finding/v1`, clean failure on a missing file. |
| End-to-end | `tests/e2e/regent.spec.ts` | 17 (18 runs) | Playwright against `node apps/api/src/index.ts --production` with an in-memory database and demo mode on (`playwright.config.ts`): landing page, redirect to sign-in and persona sign-in, populated command center, tracing `evt-0042` to its human principal and the first broken edge, replay jump to the violation, finding detail with authority delta and digest note, scenario load matching expectations, import validation, command palette search and keyboard navigation, CSV and PDF downloads, phone-width overflow check, chain builder flagging amplification, time travel, chain diff, GRC controls and the evidence package, a viewer not offered verification, and the theme toggle. All 17 run in a desktop Chrome project; the `@mobile` test also runs in a Pixel 7 project. |

### Security and adversarial tests

Security behaviour is tested in the suites above rather than in a separate one:

- Evidence-side: the 15 adversarial datasets (forged parents, cycles, excessive nesting, invalid scope syntax, malformed records with prototype-pollution keys, duplicates, conflicting timestamps and policies, missing principals and scopes, orphans, amplification, revoked identities, stale delegations), ingestion text sanitization (terminal escapes, bidi overrides, malformed ids), and CSV injection neutralization.
- API-side: CSRF token, origin and JSON content-type checks, roles, bearer token lifecycle, demo persona restrictions and demo-off revocation, tenant isolation, size limits, rate limiting and address bucketing, worst-case performance, error bodies without stack traces, security headers.

### Determinism tests

- Two analyses of the demo records are byte-identical under canonical JSON.
- The demo records shuffled with three different seeds (1, 7, 42) produce the same input digest and the same canonical run as the unshuffled input.
- Finding ids are stable across runs and match `^REG-[A-Z]+-[0-9a-f]{10}$`.
- The API stores evidence relationally, reloads it and re-verifies it to the same input digest and finding ids as the engine run directly on the same text, through PGlite and through the `node-postgres` driver.

## Current results

Recorded on 2026-10-03 with Node 24.18.0 on the build machine (Windows).

`npx vitest run`:

```
 Test Files  9 passed (9)
      Tests  154 passed (154)
```

| File | Tests |
|---|---|
| `packages/core/test/scope.test.ts` | 26 |
| `packages/core/test/engine.test.ts` | 20 |
| `packages/core/test/scenarios.test.ts` | 22 |
| `packages/core/test/ingestion-and-determinism.test.ts` | 37 |
| `apps/api/test/api.test.ts` | 31 |
| `apps/api/test/security.test.ts` | 2 |
| `apps/api/test/performance.test.ts` | 7 |
| `apps/api/test/postgres-driver.test.ts` | 3 |
| `apps/cli/test/cli.test.ts` | 6 |

`npx playwright test`, against the existing production build in `apps/web/dist`:

```
  18 passed (18.4s)
```

`npm run verify` (lint, typecheck, tests and the production build) passes. For this record, lint, typecheck and the tests were re-run individually; the production build was not rebuilt, and the Playwright run used the build already in `apps/web/dist`.

`node scripts/smoke.ts` against a local production-mode server (`node apps/api/src/index.ts --production` with `REGENT_DB=memory`, `REGENT_DEMO_MODE=true`, `REGENT_COOKIE_SECURE=false`):

```
REGENT smoke test → http://127.0.0.1:8799
  ok    health                             33ms  database pglite
  ok    demo sign-in (analyst)             11ms  session issued
  ok    reset to demo dataset              9ms  active
  ok    overview                           19ms  37 actions, 2 violations
  ok    chains + chain detail              28ms  evt-0033
  ok    findings                           15ms  17 findings
  ok    scenario: authority amplification  48ms  expected findings produced
  ok    security report PDF                61ms  23 KB
  ok    console served                     16ms  index.html

smoke test passed
```

## Performance

`scripts/bench.ts` times `analyze` (ingestion, normalization and verification) on three inputs built to be large and adversarial while staying valid. Output on the build machine:

```
15k actions, one unregistered actor                  925 ms
~50k records (demo registry, 49.8k actions)          4041 ms
8k actions on a 31-hop chain, 256-entry wildcard scopes 3608 ms
```

1. **15,000 actions by one unregistered actor.** Every finding is shared by all actions, the shape that previously made finding merges quadratic.
2. **About 50,000 records.** The demo registry with 49,800 copies of its actions: the import record limit.
3. **8,000 actions on a 31-hop chain with 256-entry wildcard scopes.** Deep chains and large scope intersections.

The figures are single runs on one machine and vary with hardware; use them to compare before and after a change, not as a guarantee. Verification runs on the API's event loop, so an import of this size blocks other requests for about that long; see [security-model.md](security-model.md#not-fixed).

`apps/api/test/performance.test.ts` is the corresponding regression test for the API views (above).

## Not yet run

The following are configured in the repository but have not been executed, because Docker and a PostgreSQL server were not available on the build machine and the CI workflows have not run yet:

| What | Where | Status |
|---|---|---|
| API against a real PostgreSQL server (migrations via `npm run db:migrate`, API boot, `database_engine: postgres` check, smoke test) | `.github/workflows/ci.yml`, job `postgres` | Configured, not yet run. The API suite runs against PGlite; the production driver has been exercised only over the wire protocol against PGlite. |
| Container build, health check, SBOM and Trivy scan | `.github/workflows/ci.yml`, job `container` | Configured, not yet run. |
| End-to-end tests in CI | `.github/workflows/ci.yml`, job `e2e` | Configured, not yet run in CI (the suite passes locally, above). |
| Docker Compose stack | `docker-compose.yml` | Configured, not yet run. |
| Dependency audit, secret scanning, CodeQL | `ci.yml` jobs `dependency-audit` and `secrets`, `codeql.yml` | Configured, not yet run. |

PGlite is PostgreSQL compiled to WebAssembly and runs the same migration SQL, which makes divergence unlikely but not impossible (for example connection pooling, transaction behaviour under concurrency, and `statement_timeout` exist only on the server path). The wire-protocol test narrows that gap for the driver code, but treat behaviour against a PostgreSQL server as untested until the `postgres` job has passed.

## Smoke test

`scripts/smoke.ts` exercises a running instance the way a person would: health (and the CSP header), demo sign-in, reset to the demo dataset, overview, a violated chain and its detail, findings, loading the authority-amplification scenario and checking it matches expectations, the security report PDF (as the demo auditor), and that the console is served.

```bash
node scripts/smoke.ts http://127.0.0.1:8787
```

It needs demo mode on the target. A `REGENT_SMOKE_TOKEN` (API token) can replace the demo sign-in, but the script still resets to the demo dataset, which exists only in the demo organization, and demo personas cannot create tokens; with a token from a real account those steps fail (see [deployment.md](deployment.md#deploying-to-a-container-platform)). Every check runs and is printed with its timing; the script exits non-zero if any check failed.
