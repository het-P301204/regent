# Getting started

## Requirements

- **Node.js 24** or later (`engines: >=24.0.0`). Node 24 runs the TypeScript sources of the engine, API and CLI directly, so there is no compile step for them.
- **npm** (ships with Node).

Nothing else. Local development uses PGlite, a real PostgreSQL compiled to WebAssembly that runs inside the API process, so no database server or Docker is needed. Docker and PostgreSQL are only needed for the production-style stack described in [deployment.md](deployment.md).

On Windows, everything runs from PowerShell, Command Prompt or Git Bash. There is no Makefile and `make` is not needed: every task is an npm script or a Node script.

## Install and run

```bash
git clone <repository-url> regent
cd regent
npm install
npm run dev
```

`npm run dev` (`scripts/dev.ts`) starts two processes side by side and stops both on Ctrl+C:

- the API on `http://127.0.0.1:8787`, restarting when `apps/api/src` or `packages/core/src` changes;
- the Vite dev server for the console on `http://localhost:5173`, which proxies `/api` to the API so the browser sees one origin.

Open **http://localhost:5173**. On first start the API creates a PGlite database in `.data/pglite`, applies the migrations, and seeds the fictional Acme AI Operations organization with its demo dataset. To start from scratch, stop the server and delete `.data/`.

Other useful commands:

| Command | Purpose |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Run one side only. `dev:api` uses the same repository-root `.data/pglite` database as `npm run dev`. |
| `npm test` | All unit, integration and CLI tests ([testing.md](testing.md)). |
| `npm run regent -- scenario list` | The CLI ([cli.md](cli.md)). |
| `npm run build` then `npm start` | Build the console and run the API in production mode, serving the console from `apps/web/dist` on port 8787. Production mode sets `Secure` cookies and turns demo mode off; to try it locally over plain HTTP with the personas, set `REGENT_COOKIE_SECURE=false` and `REGENT_DEMO_MODE=true`. |

## Demo personas and roles

Sign in from the sign-in page by choosing a persona. Demo personas need no password and can sign in only while `REGENT_DEMO_MODE` is on, which is the default in development (`npm run dev`) and not in production mode. All four belong to the fictional Acme AI Operations organization; every name in it is invented.

| Persona | Role | Can |
|---|---|---|
| Casey Wu (AI platform engineer) | `viewer` | Read chains, findings, the registry and analysis views; browse the scenario catalogue; try the chain builder without saving; download findings as JSON and CSV. |
| Jordan Lee (GRC auditor) | `auditor` | Everything a viewer can, plus the raw evidence exports, the PDF security and investigation reports and the auditor evidence package. |
| Sam Ortiz (Security engineer) | `analyst` | Everything above, plus import evidence, load scenarios (each creates a dataset), re-run verification, triage findings, save built chains, delete imported datasets. |
| Rowan Hale (Security architect) | `admin` | Everything above, plus change verification rules and read REGENT's own audit log. |

The API enforces these roles on every request; the console only reflects them. Demo personas cannot create API tokens; tokens belong to password accounts (see step 13). If demo mode is turned off, demo sessions stop working immediately. Pick `analyst` for the walkthrough below.

## First walkthrough

The demo dataset is a day of agent activity: 37 actions across four humans and ten agents, most of them healthy, a few not. Every step below is also available through the API and the CLI.

### 1. Read the command center

The command center (`/app`) shows the dataset's metrics: total actions, attributable and unattributable actions, authority violations, authority integrity (passing over evaluable actions, with not-evaluable actions counted separately and never as passing), chain health by invariant, and recent findings.

### 2. Open a chain

Go to **Chains** (`/app/chains`). Each row is one action with its reconstructed chain, derived decision and chain health (`verified`, `incomplete`, `violated`, `unknown`). Filter by health `violated` and open **evt-0042**, ReconciliationAgent posting a journal entry to the ledger (`/app/chains/evt-0042`).

### 3. Trace it to the human

The header says who authorized the action: Maya Chen. The chain runs Maya Chen → OperationsAgent → ReconciliationAgent, then through the LedgerPost tool, executing as workload `wl-recon-04` with credential `svid-recon-04`, against LedgerDB. The graph keeps the delegation chain (principals only) separate from the execution path (tool, execution identity, credential, resource).

### 4. Inspect the hops and scopes

Select a delegation edge in the graph to open it in the inspector. Each hop shows the granted scope, what the delegator could pass on (available scope), the resulting effective scope, any policy ceiling, and its validity at action time. The **Authority diff** panel lines up granted, requested, effective and exercised scope for the action. Here Maya granted OperationsAgent `ledger.read` among others, OperationsAgent granted ReconciliationAgent only `ledger.read`, and the action exercised `ledger.read` and `ledger.write`.

### 5. Verify

The **Verification checks** panel lists the ten checks for this action (attribution, chain completeness, authority integrity, scope containment, identity binding, credential binding, action-time validity, policy traceability, approval, record completeness), each `PASS`, `WARN`, `FAIL`, `UNKNOWN` or `SKIPPED` with the reason. REGENT's derived decision is `DENY`; the recorded decision was `ALLOW`.

### 6. See the amplification

**Locate the broken edge** points at the first place an invariant broke: no delegation conveyed `ledger.write`, and the workload `wl-recon-04` holds standing `ledger.write`, so the action used the workload's own authority instead of the delegated one. The explanation panel ("Why is this a finding?") walks through it step by step. It is generated from the evidence by the engine, not by a language model.

### 7. Replay it

Switch to the **Action replay** tab (`?tab=replay`). The timeline is built only from recorded timestamps, from the first delegation to the resource access; steps without a timestamp are listed separately rather than given an invented time. Use **Jump to violation** to go to the step where the invariant broke.

### 8. Check the evidence

Open the finding (from the chain, or from **Findings**, `/app/findings`). The finding page shows the summary, root cause, remediation, the authority delta (`excess: ledger.write`) and every evidence record it rests on, each with its SHA-256 digest. Digests show whether a record has changed since it was ingested; they are not signatures. As an analyst you can set a triage status (accepting or suppressing requires a note); status survives re-runs because finding ids are stable.

### 9. Build a chain

Open **Chain builder** (`/app/builder`). Add a human, an agent and a sub-agent, connect them with delegations, set granted scopes, and add an action with requested and exercised scopes. Run verification (Ctrl+Enter also works); the chain is converted to evidence records and verified server-side by the same engine as an import. Try granting the sub-agent a permission its delegator does not hold and verify again: the hop becomes an amplification finding. Analysts can save the chain as a dataset. The same format, ChainSpec, can be verified with `regent verify` ([delegation-model.md](delegation-model.md#chainspec)).

### 10. Import JSON

Open **Import events** (`/app/import`). Paste or upload JSON or JSONL evidence, or load the example, and **Validate** first: nothing is stored, and the report lists accepted and rejected records with a reason for each rejection. Importing creates a new dataset, verifies it and makes it active; the demo dataset is untouched, and you can switch back with **Reset to demo** in Settings or from the command palette (Ctrl+K). Formats and limits are in [delegation-model.md](delegation-model.md#input-formats).

### 11. Export

Open **Reports & exports** (`/app/reports`). Findings are available as `regent.finding/v1` JSON and as CSV, the normalized evidence as JSON, and per-action verification results as CSV. The auditor evidence package bundles the dataset, run digests, rule set, control evaluation, findings and the full normalized evidence.

### 12. Generate a report

From the same page (auditor role or higher), download the Delegation Authority Security Report PDF for the dataset, or an investigation report PDF for one event (for example `evt-0042`).

### 13. Use the CLI and the API

The CLI runs the same engine offline:

```bash
npm run regent -- analyze scenarios/acme-demo.json
npm run regent -- explain evt-0042
npm run regent -- replay evt-0042
npm run regent -- analyze scenarios/acme-demo.json --fail-on high   # exits 1: CI gate
```

The API exposes everything the console does. With a demo persona, call it with the session cookie and CSRF header (see [api.md](api.md#session-cookie-the-console)):

```bash
curl -s -c jar.txt -X POST http://localhost:5173/api/auth/demo -H "Content-Type: application/json" -d '{"persona":"analyst"}'
curl -s -b jar.txt http://localhost:5173/api/chains/evt-0042 | jq .verification.derived_decision
```

For automation, use an API token. Demo personas cannot create tokens, so start the API with a password administrator (`REGENT_ADMIN_EMAIL` and a `REGENT_ADMIN_PASSWORD` of at least 12 characters), sign in with it, and create a token in Settings or with `POST /api/tokens`. The administrator belongs to its own organization, `org_primary`, which starts empty: import evidence or load a scenario there before querying. Tokens expire (90 days by default) and can be revoked in Settings.

See [cli.md](cli.md) and [api.md](api.md).

## Where to go next

- [Scenario lab](scenarios.md): twelve small datasets, each showing one property. Load them from **Scenario lab** in the console (analyst role) or with `regent scenario <n>`.
- [Concepts](concepts.md) for the vocabulary, [authority-model.md](authority-model.md) for how effective scope is computed, [verification-engine.md](verification-engine.md) for every check and finding type.
