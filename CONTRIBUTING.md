# Contributing

## Setup

```bash
npm install          # Node 24 or later
npm run dev          # API on :8787 and console on http://localhost:5173
```

No database server or Docker is needed; the API uses PGlite locally. See [docs/getting-started.md](docs/getting-started.md).

## Checks

Before opening a pull request, run:

```bash
npm run verify       # lint, typecheck, tests, production build
```

If you changed anything the console shows or the API serves to it, also run the end-to-end tests against the production build:

```bash
npm run build
npx playwright install chromium   # first time only
npm run test:e2e
```

CI runs the same checks plus tests against PostgreSQL, a container build and scan, a dependency audit, secret scanning and CodeQL (`.github/workflows/`).

If you changed the engine's hot paths (normalization, chain reconstruction, scope algebra, finding generation) or an API view, run the benchmark and compare with the numbers in [docs/testing.md](docs/testing.md#performance):

```bash
node scripts/bench.ts
```

`apps/api/test/performance.test.ts` (part of `npm test`) fails if a main view takes 3 seconds or more on a 15,000-action dataset.

## Engine rules

`packages/core` is the only place verdicts are computed. Changes to it follow these rules:

- **Deterministic.** No clock, no randomness, no I/O, no DOM. ESLint rejects `Date.now`, `Math.random`, `fetch`, `window` and `document` in `packages/core/src`. Times come only from the evidence. Compare strings with `compareStrings` (code point order), sort every list that reaches output, and keep the determinism tests passing (including the record-order shuffle).
- **Unknown is never `PASS`.** Missing or unverifiable evidence yields `UNKNOWN` or `WARN` and, where appropriate, a finding that says what is missing. Missing evidence is never reported as a violation either.
- **Disabled is `SKIPPED`.** A disabled rule removes findings and marks its checks `SKIPPED`; it never turns a check into `PASS` and never changes the derived decision.
- **Evidence is a claim.** Declared values (roots, delegators, parents) are checked against the reconstruction, never trusted. Tools, execution identities, credentials and resources are never principals.
- **Tests for new finding types.** A new finding type needs: a rule mapping in `RULE_FOR_FINDING`, a code in `FINDING_CODE`, a title in `FINDING_TITLE`, a scenario or adversarial dataset that produces it, and tests asserting the exact set of finding types produced (both directions: nothing missing, nothing extra). Update `docs/verification-engine.md`.
- **Terminology.** Use the canonical terms in [docs/concepts.md](docs/concepts.md) in code, messages and docs.

## Application rules

- **No security logic in the UI.** The console displays verdicts the API computed. `apps/web/src` may import engine types (`import type`) but not engine functions; ESLint enforces it. Every permission is enforced in the API.
- **Node type stripping.** The API, CLI and engine run as TypeScript under Node 24 without a compile step, so `enum`, `namespace` and constructor parameter properties are not allowed (ESLint enforces it). Import types with `import type`.
- **SQL.** Parameterized queries only. Every query on tenant data filters on `organization_id`.
- **Migrations.** Add a new numbered file in `database/migrations/` (`NNNN_name.sql`). Never edit an applied migration; its checksum is recorded and startup stops on a mismatch.
- **Untrusted text.** Imported strings are cleaned of control and bidi characters once at ingestion (`packages/core/src/text.ts`); keep that path for any new input route. Anything from evidence that reaches CSV, PDF or the console must also go through the existing output sanitizers (`csvCell`, `stripBidi`, the PDF `clean` function) or React's escaping. Do not render evidence as HTML.
- **Mutations.** Every mutating route takes JSON and sits behind the `csrf` middleware (token, Origin and content-type checks); do not add form or `text/plain` endpoints. A route that creates a dataset needs the `analyst` role; one that exposes raw evidence needs `auditor`.
- **Bounded work.** No per-item scans over a whole run inside a loop: use the per-run index (`indexOf` in `apps/api/src/services/views.ts`) and cap long lists, returning the exact total next to them.
- **Synthetic data only.** Scenarios, fixtures and examples use invented names and `example.test` / `acme.example` domains, and never contain real credentials.

## Commits and pull requests

- One logical change per commit, with a short subject that names the area and the change, for example `Core verification engine: scope algebra, chain reconstruction, invariants` or `API: PostgreSQL/PGlite storage, auth, CSRF, roles, reports and exports`.
- Explain in the body why the change is needed when it is not obvious from the subject.
- Keep generated files in sync: run `npm run scenarios:export` after changing scenarios or the demo dataset, and `node scripts/generate-adversarial.ts` after changing adversarial datasets.
- Add an entry to [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## License

By contributing you agree that your contributions are licensed under the Apache License 2.0 ([LICENSE](LICENSE)).
