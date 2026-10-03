# CLI

`regent` is an offline command line for the REGENT engine (`apps/cli/src/main.ts`). It runs the same `@regent/core` code as the API, so `regent analyze` on a file prints the same input digest and finding ids the API would record for that file. It needs no server and no database.

## Running it

From the repository root, after `npm install`:

```bash
npm run regent -- <command> [args]     # via the root package.json script
npx regent <command> [args]            # workspace bin linked into node_modules/.bin
node apps/cli/src/main.ts <command>    # directly (Node 24 runs the TypeScript source)
```

Colour is used only on a TTY and is disabled by `NO_COLOR`. Text from evidence is stripped of control characters (ESC included) and bidirectional overrides at ingestion, so an imported record cannot inject terminal escape sequences into CLI output.

## Commands

```
regent analyze <events.json|.jsonl> [--json] [--fail-on <severity>]
regent verify <chain.json> [--fail-on <severity>]
regent findings [--severity <s>] [--json] [--input <file>]
regent replay <event-id> [--input <file>]
regent explain <event-id> [--input <file>]
regent chains [--input <file>]
regent scenario <slug|number|list>
regent export <out.json|out.csv> [--input <file>]
regent help
```

Flags accept `--flag value` or `--flag=value`.

| Command | What it does | Saves state |
|---|---|---|
| `analyze <file>` | Ingests a JSON or JSONL evidence file (any format in [delegation-model.md](delegation-model.md#input-formats)), verifies it, prints a summary, ingestion errors (first 10) and findings. `--json` prints `stats`, `issues`, `summary`, `input_digest` and `findings` (`regent.finding/v1`) instead. | yes |
| `verify <file>` | If the file is a valid ChainSpec, converts it to evidence records and verifies it; otherwise treats it as an evidence file. Prints each reconstructed chain with its ten checks, the derived decision, and the authority delta of any amplification. | yes |
| `findings` | Prints findings of the last analysis. `--severity` filters to one severity; `--json` prints `regent.finding/v1` objects. | no |
| `replay <event-id>` | Prints the replay timeline of one action (offsets from the first timed step), untimed steps, and the first violation. | no |
| `explain <event-id>` | Prints the explanation: the question, headline, steps and conclusion. | no |
| `chains` | One line per action: chain health, event id, root → actor. | no |
| `scenario list` | Lists the 12 scenarios. | no |
| `scenario <slug or number>` | Runs one scenario and prints its chains, findings and what it teaches. | yes |
| `export <file>` | Writes findings of the last analysis to a file: CSV if the name ends in `.csv`, otherwise JSON (`{schema: "regent.findings/v1", source, input_digest, ruleset_version, findings}`). Parent directories are created. | no |
| `help` | Usage. Also shown with no command, `--help` or `-h`. | no |

The CLI always uses the default rule set (`2026.10.1`). Organization rule overrides exist only in the API.

## State: `.regent/last.json`

`analyze`, `verify` and `scenario` save the source name, the normalized evidence bundle and the verification run to `.regent/last.json` in the current working directory. `findings`, `replay`, `explain`, `chains` and `export` read it, unless `--input <file>` is given, in which case they analyze that file fresh and do not touch the saved state. Without either, they exit with code 2: `no previous analysis. Run regent analyze <file> first, or pass --input <file>.`

The file contains the full normalized evidence. `.regent/` is in `.gitignore`; do not commit it.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. With `--fail-on`, no finding at or above the threshold. |
| 1 | `--fail-on <severity>` was given (to `analyze` or `verify`) and at least one finding is at or above that severity. |
| 2 | Usage or input error: unknown command, missing argument, file not found, input larger than 50 MB, unknown event id, no saved analysis, invalid `--fail-on` value. |

Severities, highest first: `critical`, `high`, `medium`, `low`, `info`. `--fail-on high` fails on critical or high findings.

## Examples

All output below was captured with `NO_COLOR=1` from the commands shown.

### analyze

```
$ regent analyze examples/events.json
REGENT  Authority, traced.

Delegation Chain Verification
─────────────────────────────
Source                examples/events.json
Records               1 accepted
Actions               1
Attributable          0   1 unattributable
Authority violations  0
Authority integrity   0/0 evaluable passed, 1 not evaluable
Chain health          0 verified  1 incomplete  0 violated  0 unknown
Input digest          sha256:bc7fe04a0ad7769db6b3d6da241011882480332aab16e7a6013e90a59ab68e67
Rule set              2026.10.1

Findings (4)
HIGH     Unattributable action  REG-ATTR-7637c255ad
         evt-001 cannot be traced to a root principal.
MEDIUM   Unknown identity or reference  REG-UNK-975458574b
         The evidence references resource "customer-db", which is not registered.
MEDIUM   Unknown identity or reference  REG-UNK-c4a6ba3c1a
         The evidence references tool "customer-search", which is not registered.
MEDIUM   Unknown identity or reference  REG-UNK-ef3cfd019d
         The evidence references principal "agent-001", which is not registered.
```

The single legacy-format event names a delegated user but no delegation, principal, tool or resource record exists for it, so REGENT reports it as unattributable rather than taking the declared user on trust. Missing evidence makes the chain `incomplete`, not `violated`.

### verify

```
$ regent verify examples/chain.json
REGENT  Authority, traced.

Delegation Chain Verification
─────────────────────────────

evt-builder-01  2026-10-03T09:30:00.000Z
Human       Alice
Agent       ResearchAgent  {customer.read}
Sub-Agent   CustomerAgent  {customer.read}
Tool        CustomerSearch
Execution   workload-042
Credential  cred-workload-042

ATTRIBUTION             PASS
CHAIN COMPLETENESS      PASS
AUTHORITY INTEGRITY     FAIL
SCOPE CONTAINMENT       FAIL
IDENTITY BINDING        PASS
CREDENTIAL BINDING      PASS
ACTION-TIME VALIDITY    PASS
POLICY TRACEABILITY     PASS
APPROVAL                PASS
RECORD COMPLETENESS     WARN
DECISION                DENY  (recorded ALLOW)

Authority amplification detected

Delegated (effective):
  customer.read
Exercised:
  customer.read, customer.write
Unauthorized expansion:
  customer.write

Findings (1)
CRITICAL Authority amplification  REG-AMP-32553331da
         CustomerAgent exercised customer.write, which no delegation in its chain legitimately conveyed.
```

In the amplification block, `Delegated (effective)` is the authority the chain actually conveyed to the actor, `Exercised` is what the action used, and `Unauthorized expansion` is the excess. Record completeness is `WARN` only because the built action records no `parameters`; ChainSpec actions record their root principal (see [delegation-model.md](delegation-model.md#chainspec)).

### scenario

```
$ regent scenario list
REGENT  Authority, traced.

Scenario Lab
─────────────────────────────
 1  valid-single-agent          Valid single-agent delegation
 2  valid-multi-agent           Valid multi-agent delegation
 3  broken-parent-chain         Broken parent chain
 4  authority-amplification     Authority amplification
 5  missing-delegated-user      Missing delegated user
 6  credential-mismatch         Credential mismatch
 7  revoked-credential          Revoked credential
 8  stale-delegation            Stale delegation
 9  excessive-sub-agent-scope   Sub-agent receives excessive scope
10  missing-policy-version      Missing policy version
11  action-time-authorization   Action-time authorization failure
12  complex-multi-agent         Complex multi-agent chain
```

### replay

```
$ regent scenario 11 > /dev/null
$ regent replay evt-s11-read
REGENT  Authority, traced.

Action Replay — evt-s11-read
─────────────────────────────
   00:00   WARN    Alice Romero delegated to ResearchAgent
                  Granted {customer.read}. del-alice-research.
   00:00   WARN    Authorization evaluated: ALLOW
                  pol-agent-runtime v7. REGENT's action-time decision: DENY. Reason recorded: "cached grant decision".
01:00:00 ◆ FAIL    Delegation del-alice-research revoked
                  Alice Romero → ResearchAgent is no longer in force.
01:05:00   PASS    ResearchAgent requested CustomerSearch
                  Requested {customer.read} for read on CustomerDB.
01:05:00   PASS    Executed as wl-research-01
                  Credential svid-research-01. wl-research-01 is issued to ResearchAgent.
01:05:00   PASS    CustomerDB accessed
                  Exercised {customer.read}. Exercised {customer.read} ⊆ effective {customer.read}.
01:05:00   PASS    Downstream result: success
                  The action took effect.

First violation at step 3: Delegation del-alice-research revoked
```

The decision was evaluated at 09:00, the delegation was revoked at 10:00, and the action ran at 10:05 without re-evaluation. The violation is placed on the revocation step, not on the delegation's creation.

### explain

```
$ regent explain evt-s11-read
REGENT  Authority, traced.

Why is this a finding?
─────────────────────────────
evt-s11-read was allowed on a decision made at 2026-10-03 09:00 UTC, before delegation del-alice-research was revoked (at 2026-10-03 10:00 UTC).

✕ Alice Romero delegated {customer.read} to ResearchAgent under pol-agent-delegation v4. Revoked before the action.
· ResearchAgent requested {customer.read}.
· ResearchAgent exercised {customer.read} through CustomerSearch against CustomerDB, executing as wl-research-01.
✓ The exercised scope remained within the effective scope {customer.read}.
✕ delegation del-alice-research was revoked (at 2026-10-03 10:00 UTC), yet the action ran.

Therefore: The decision was made before the authority ended and was never re-evaluated at action time.
```

### Gating CI on findings

`--fail-on` turns the CLI into a CI gate. On the synthetic Acme demo dataset:

```
$ regent analyze scenarios/acme-demo.json --fail-on high
...
Records               104 accepted
Actions               37
Attributable          35   2 unattributable
Authority violations  2
Authority integrity   33/35 evaluable passed, 2 not evaluable
Chain health          27 verified  2 incomplete  8 violated  0 unknown
Input digest          sha256:a546e39a092ef25a75d71f46cc99da35a73a3881b942c6245223df9b7c7404a3
Rule set              2026.10.1

Findings (17)
CRITICAL Authority amplification  REG-AMP-e38c7a42f8
         ReconciliationAgent exercised ledger.write, which no delegation in its chain legitimately conveyed.
CRITICAL Execution identity mismatch  REG-EXID-8536b5fe47
         evt-0014 ran as wl-shared-batch, which belongs to NightlySyncAgent, not OperationsAgent.
...
$ echo $?
1
```

`regent analyze scenarios/01-valid-single-agent.json --fail-on low` exits 0.

A GitHub Actions step that fails the job when an exported evidence file contains critical or high findings, and keeps the findings as an artifact:

```yaml
- name: Verify agent delegation evidence
  run: |
    node apps/cli/src/main.ts analyze audit/agent-events.jsonl --fail-on high
- name: Export findings
  if: always()
  run: node apps/cli/src/main.ts export out/regent-findings.json
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: regent-findings
    path: out/regent-findings.json
```

The repository's own CI runs the CLI against `scenarios/acme-demo.json` and `scenarios/01-valid-single-agent.json --fail-on low` as a smoke test (`.github/workflows/ci.yml`).
