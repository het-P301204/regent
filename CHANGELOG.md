# Changelog

All notable changes to REGENT are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-03

Initial release.

### Engine (`@regent/core`)

- Canonical data model keeping the delegation chain, execution path and evidence chain apart.
- Ingestion of JSON bundles, arrays, single records and JSONL, with zod validation, per-record rejection reasons, legacy field aliases, duplicate detection and revocation records.
- Scope algebra with trailing wildcards and opaque literals for invalid syntax.
- Chain reconstruction from recorded parent references and unique registry lookup; ambiguity, cycles and a 32-hop limit reported as breaks.
- Effective scope per hop (granted ∩ delegator effective ∩ policy ceiling) with upper bounds when upstream authority is unknown; amplification located at the hop where it entered.
- Ten verification checks per action, derived authorization decision, chain health classes, 16 finding types, rules AUTH-001 to AUTH-010 with configuration and versioning.
- Record completeness against `regent.action-record/v1`.
- Explanation, replay, time travel, chain diff, investigation and control evaluation (RGT-C1 to RGT-C7).
- `regent.finding/v1` export, CSV export with formula-injection and bidi neutralization.
- Twelve scenarios, the Acme AI Operations demo environment and fifteen adversarial datasets, all synthetic.

### API (`@regent/api`)

- Hono API with PGlite (local, tests) and PostgreSQL (production) through one driver interface and checksummed SQL migrations.
- Session cookies with CSRF protection (synchronizer token, Origin check, JSON-only mutations), expiring and revocable bearer API tokens, scrypt password hashing, roles (viewer, auditor, analyst, admin), organization-scoped queries, rate limits, security headers, structured logging and an audit log.
- Datasets, imports with validation, verification runs, findings with triage, registries, rule configuration, scenarios, chain builder, analysis views, PDF reports, exports and an auditor evidence package.
- OpenAPI 3.1 description at `/api/openapi.json`.

### CLI (`@regent/cli`)

- `analyze`, `verify`, `findings`, `replay`, `explain`, `chains`, `scenario`, `export`; `--fail-on` for CI gating.

### Console (`@regent/web`)

- React console for chains, findings, investigations, registries, the scenario lab, the chain builder, imports, reports and learning material. Visualization only.

### Infrastructure

- Dockerfile, `.dockerignore`, Docker Compose stack, CI, CodeQL and release workflows, Dependabot, smoke test, engine benchmark (`scripts/bench.ts`). All CI jobs pass on GitHub Actions, including the image build, health check, SBOM and Trivy scan, and migrations plus API smoke checks against a real PostgreSQL 17 server. The Compose stack as a whole and the release workflow have not been run (see `docs/deployment.md`).

### Security review

Fixes from an internal review before release (details in `docs/security-model.md#security-review`):

- Denial of service through quadratic work on large datasets: set-based finding merges, memoized permission parsing and per-delegation hop caching in the engine; a per-run index and capped lists with exact totals in the API; a performance test on a 15,000-action dataset.
- Demo credentials no longer survive turning demo mode off: demo sessions and tokens are rejected immediately and purged at startup; demo personas cannot create API tokens; demo mode is off by default in production; the bootstrap administrator lives in its own organization (`org_primary`) and needs a password of at least 12 characters.
- API tokens expire (1–365 days, default 90; migration `0002_token_expiry.sql`), and can be listed (`GET /api/tokens`) and revoked (`DELETE /api/tokens/{prefix}`) through the API and the Settings page.
- Rate limiting: `X-Forwarded-For` read from the right with `REGENT_TRUST_PROXY_HOPS`, IPv6 bucketed by /64, a per-account sign-in limit (20 per 15 minutes), builder verification limited per user (30 per minute), periodic sweeping of expired windows.
- Mutations require `Content-Type: application/json` in addition to the synchronizer token and Origin check.
- Roles made consistent: loading a scenario needs `analyst`; raw evidence exports need `auditor`.
- Imported text is cleaned of C0/C1 control characters and bidi overrides at ingestion (`TEXT_SANITIZED`), closing terminal-escape injection into the CLI; invalid action event ids are rejected and malformed references nulled.
- Smaller ChainSpec limits (24 principals, 40 delegations, 20 actions, 32 permissions per scope); built chains record their root principal.
- Audit log: export names validated before auditing; triage entries record the dataset; token revocation audited.
- Docker build context excludes secrets and local data; Compose allows only the 8787 origins by default; the sign-in `next` parameter rejects control characters and encoded slashes.

### History

The concept was first drafted under the name WARRANT. It was renamed REGENT before any release; no version was ever published under the earlier name.
