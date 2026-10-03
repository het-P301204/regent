# Deployment

## Status

No deployment has been performed. There is no public instance and no deployment URL.

What exists is configuration: a production `Dockerfile` with a `.dockerignore`, a `docker-compose.yml` stack, CI and release workflows, and a post-deployment smoke test. Docker and a PostgreSQL server were not available on the machine REGENT was built on.

What has been run:

- the API in production mode (`node apps/api/src/index.ts --production`, serving the built console, with an in-memory PGlite database), against which `scripts/smoke.ts` passed all nine checks and the Playwright end-to-end suite passed (see [testing.md](testing.md));
- the production `node-postgres` driver, tested over the PostgreSQL wire protocol against PGlite served on a local socket (`apps/api/test/postgres-driver.test.ts`).

What has not been run:

- the Docker image has not been built;
- the Docker Compose stack has not been started;
- nothing has run against a real PostgreSQL server;
- the CI jobs (`verify`, `postgres`, `e2e`, `container`, `dependency-audit`, `secrets`, CodeQL) have not run.

What remains before a first deployment:

1. Build the image and start the Compose stack locally; fix anything that fails.
2. Run the CI workflow, in particular the `postgres` job (migrations and smoke test against PostgreSQL 17) and the `container` job (image build, health check, SBOM, Trivy scan).
3. Choose a host, provision PostgreSQL, and follow the steps below.
4. Run `scripts/smoke.ts` against the deployed URL and record the result.
5. Decide how real users will be provisioned (see [Users and organizations](#users-and-organizations)): today only one password administrator can be created.

## Production architecture

```
Browser ──HTTPS──▶ TLS-terminating proxy or platform router
                          │
                          ▼
              REGENT API (Node 24, one process)
              ├── /api/*   JSON API, verification via @regent/core
              └── /*       built console (apps/web/dist), same origin
                          │
                          ▼
                     PostgreSQL
```

One process serves both the API and the console, so the browser talks to a single origin and the `SameSite=Strict` session cookie works without cross-site configuration. On startup the API runs migrations, seeds the demo organization if it is missing, creates or updates the bootstrap administrator, and purges expired sessions (plus demo sessions and tokens when demo mode is off).

The API is designed to run as a single instance: rate limits and the verification-run cache are in memory per process, and verification runs on the API's event loop.

## Environment variables

From `apps/api/src/config.ts`, `apps/api/src/security.ts`, `apps/api/src/db/driver.ts` and `.env.example`. Copy `.env.example` to `.env` for Docker Compose; never commit `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | — | `production` (or the `--production` flag) enables production mode: serves the console, binds `0.0.0.0`, secure cookies and HSTS by default, demo mode off by default, empty default origin allowlist. The Docker image sets it. |
| `PORT` | `8787` | Listen port. |
| `HOST` | `127.0.0.1` (development), `0.0.0.0` (production) | Listen address. |
| `DATABASE_URL` | unset | `postgres://user:password@host:5432/db`. Unset means an embedded PGlite database in `REGENT_DATA_DIR`. Required in production. |
| `REGENT_DB_POOL_MAX` | `10` | Maximum connections in the PostgreSQL pool. |
| `REGENT_DATA_DIR` | `.data/pglite` | PGlite data directory when `DATABASE_URL` is unset. A relative path is resolved against the repository root, so `npm run dev`, `npm run dev:api` and `npm start` share one database. |
| `REGENT_DB` | unset | `memory` runs PGlite in memory (tests, e2e). |
| `REGENT_DEMO_MODE` | `true` in development, `false` in production mode | Password-less demo personas; only the exact value `true` enables them. When off, demo sessions and tokens are rejected immediately and purged at startup. Keep it off for any deployment holding real data. Docker Compose sets it to `true` unless overridden in `.env`. |
| `REGENT_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` in development; empty in production | Comma-separated origins allowed for credentialed cross-origin requests and for mutating requests that carry an `Origin` header. |
| `REGENT_COOKIE_SECURE` | `true` in production, otherwise `false` | `Secure` flag on cookies. Set `false` only for plain-HTTP local runs. |
| `REGENT_TRUST_PROXY_HOPS` | `0` | Number of trusted reverse proxies in front of the API. With `N > 0`, rate limiting uses the Nth `X-Forwarded-For` entry counted from the right. Leave at `0` if clients can reach the API directly. |
| `REGENT_TRUST_PROXY` | unset | Legacy: `true` is the same as `REGENT_TRUST_PROXY_HOPS=1`. |
| `REGENT_ADMIN_EMAIL`, `REGENT_ADMIN_PASSWORD` | empty | Optional bootstrap administrator in its own organization (`org_primary`). The password must be at least 12 characters (startup fails otherwise) and is stored as a scrypt hash. Applied on every start. |
| `REGENT_MAX_IMPORT_BYTES` | `5242880` (5 MiB) | Maximum import size. |
| `REGENT_SESSION_HOURS` | `8` | Session lifetime. |
| `REGENT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `REGENT_WEB_DIST` | `apps/web/dist` | Directory of the built console (relative paths resolve against the repository root). |
| `POSTGRES_PASSWORD` | — | Docker Compose only: password of the bundled PostgreSQL. |

There are no other secrets. Sessions need no signing key.

## Docker Compose

```bash
cp .env.example .env          # set POSTGRES_PASSWORD to a long random value
docker compose up --build     # PostgreSQL + the API serving the console
# open http://127.0.0.1:8787

# also a Vite dev server on http://127.0.0.1:5173; add the 5173 origins first:
REGENT_ALLOWED_ORIGINS=http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:5173,http://localhost:5173 \
  docker compose --profile dev up --build
```

The stack (configured, not yet run):

- `postgres` — `postgres:17.6-alpine`, data in the `pgdata` volume, health-checked with `pg_isready`, attached only to an internal network with no published port.
- `api` — built from the `Dockerfile`, `DATABASE_URL` pointing at `postgres`, starts after PostgreSQL is healthy, published on `127.0.0.1:8787` only. For local use the stack sets `REGENT_DEMO_MODE=true` and `REGENT_COOKIE_SECURE=false` (plain HTTP), and by default allowlists only the 8787 origins (`http://127.0.0.1:8787`, `http://localhost:8787`); all can be overridden from `.env`. Set `REGENT_DEMO_MODE=false` before loading real data; existing demo sessions and tokens stop working at once.
- `web` (profile `dev`) — `node:24.18-alpine3.22` running Vite against the API.

## Container hardening

The `Dockerfile` (configured, not yet built):

- Multi-stage: a build stage installs all dependencies and builds the console; the runtime stage installs production dependencies only (`npm ci --omit=dev`) and copies the engine, API and CLI sources, migrations, scenarios and the built console.
- `.dockerignore` keeps `.git`, `.github`, `.env` files (except `.env.example`), local databases (`.data`), CLI state (`.regent`), `node_modules`, build output, test reports, logs and screenshots out of the build context.
- Base image `node:24.18-alpine3.22` (override with the `NODE_IMAGE` build argument; pin it by digest in your registry mirror).
- Runs as the unprivileged `node` user. `/data` is created and owned by `node` for an optional PGlite directory.
- No server compile step: Node 24 runs the TypeScript sources.
- `HEALTHCHECK` calls `GET /api/health` every 15 seconds.

In Docker Compose the API container additionally runs with a read-only root filesystem, a `tmpfs` at `/tmp`, `no-new-privileges`, and all Linux capabilities dropped. A read-only root filesystem needs `DATABASE_URL`; to use PGlite in a container, mount a writable volume at `REGENT_DATA_DIR`.

The release workflow (`.github/workflows/release.yml`, triggered by a `vX.Y.Z` tag) builds and pushes the image to GitHub Container Registry with an SBOM and build provenance, and adds a signed provenance attestation. It has not been run. Actions in the workflows are pinned by tag, not by commit SHA.

## Deploying to a container platform

These steps apply to any platform that runs a container image and offers managed PostgreSQL (Fly.io, Render, a Kubernetes cluster, a VM with Docker). Nothing platform-specific is in the repository.

1. **Provision PostgreSQL.** Version 17 is what the Compose stack and CI use. Create a database and a user for REGENT.
2. **Build and push the image** from the repository root (`docker build -t <registry>/regent:<version> .`), or use the release workflow.
3. **Set the environment:**
   - `DATABASE_URL=postgres://...` (as a platform secret);
   - leave `REGENT_DEMO_MODE` unset or `false` for real data (the image runs in production mode, where demo mode is off by default); set it to `true` only for a public demonstration of the synthetic data;
   - `REGENT_ALLOWED_ORIGINS=https://your-host` — set this to the public origin. Behind a TLS-terminating proxy the API sees plain HTTP, so its own origin can differ from the browser's `https://` origin, and mutating requests from the console would be rejected as cross-origin without it;
   - `REGENT_COOKIE_SECURE=true` (the production default; keep it);
   - `REGENT_TRUST_PROXY_HOPS` set to the number of proxies in front of the container (usually `1` on a platform router), only if clients cannot reach the container directly;
   - `REGENT_ADMIN_EMAIL` and `REGENT_ADMIN_PASSWORD` (at least 12 characters) for the first administrator, as secrets.
4. **Expose port 8787** (or set `PORT`) behind HTTPS. The image already runs in production mode.
5. **Migrations.** The API applies pending migrations on every start. To apply them as a separate release step instead, run `npm run db:migrate` with the same `DATABASE_URL`. Never edit an applied migration; the checksum check stops startup if you do. Add a new numbered file instead. Migration `0002_token_expiry.sql` adds token expiry and gives any existing token 90 days from its creation.
6. **Health check.** Point the platform's health check at `GET /api/health`. It returns `200` with `"database_engine":"postgres"` when connected, and `503` if the database does not answer.
7. **Smoke test.**

   ```bash
   node scripts/smoke.ts https://your-host
   ```

   The script signs in as the demo analyst and auditor and works on the demo dataset, so it needs demo mode on. Its `REGENT_SMOKE_TOKEN` mode (an API token instead of demo sign-in) still resets to the demo dataset, which only the demo organization has; with a token from the bootstrap administrator (organization `org_primary`) those steps fail. For a deployment that will hold real data, run the smoke test once with `REGENT_DEMO_MODE=true` before loading any data, then restart with demo mode off: demo sessions and tokens stop working immediately and are purged at startup.

8. **Run one instance.** Rate limits and caches are per process. Size the PostgreSQL pool with `REGENT_DB_POOL_MAX` if the database limits connections.

## Users and organizations

On every start the API ensures the demo organization (Acme AI Operations, `org_acme`), its four demo persona users and its demo dataset exist, regardless of demo mode. With demo mode off the personas cannot sign in (they have no password, the demo sign-in endpoint returns `404`, and any existing demo session or token is rejected and purged), but the organization and its synthetic dataset remain in the database.

The bootstrap administrator from `REGENT_ADMIN_EMAIL` / `REGENT_ADMIN_PASSWORD` is created in a separate organization, `org_primary` ("Primary organization"), which starts with no datasets. Real accounts never share an organization with the password-less demo personas. The administrator can create API tokens for automation (expiring after 1–365 days, 90 by default) and list and revoke them in Settings.

There is currently no API or console page to create organizations or additional users; a multi-tenant admin interface is on the [roadmap](roadmap.md). Plan for this before onboarding more than one operator.

## Backups and retention

REGENT keeps its state in PostgreSQL: normalized evidence, verification runs, findings, triage state, rule configuration, sessions, API token hashes and its audit log. Back up the database with your platform's PostgreSQL tooling. For evidence that may matter later, also export the auditor evidence package (`GET /api/grc/evidence-package`) and keep it outside REGENT: digests detect later changes only if a copy exists to compare against.
