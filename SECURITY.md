# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub security advisories: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include what you can of:

- the affected component (engine, API, CLI, console, container or configuration) and version or commit;
- steps to reproduce, ideally with a minimal evidence file or request;
- the impact you expect (for example a verdict that passes when it should fail, cross-tenant access, or injection through an export);
- any suggested fix.

Use synthetic data in reports. Do not send real credentials, tokens or personal data.

REGENT is maintained by one person. Reports are acknowledged and triaged as soon as practical, fixes are developed in a private advisory, and the reporter is credited in the advisory and the changelog unless they prefer not to be.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

Only the latest release line receives security fixes.

## Scope

In scope:

- **Verification correctness that weakens security**: an action or delegation that should produce a finding but passes, an unknown that is reported as `PASS`, a forged or malformed record that changes another record's verdict, non-deterministic results.
- **API security**: authentication or session flaws, CSRF, CORS, acting above one's REGENT role (for example a viewer changing rules), cross-organization access, injection, information disclosure (including stack traces or secrets), rate-limit bypass.
- **Output injection**: content in imported evidence that executes or misleads in the CLI's terminal output, the console, CSV exports or PDF reports.
- **Ingestion robustness**: input that crashes the engine or API, exhausts memory or CPU far beyond the documented limits, or pollutes prototypes.
- **Container and configuration defaults** in the `Dockerfile`, `.dockerignore`, `docker-compose.yml` and `.env.example`.

Out of scope:

- Behaviour that is documented as an accepted residual item or limitation in [docs/security-model.md](docs/security-model.md#not-fixed) or [docs/threat-model.md](docs/threat-model.md): cookies without the `__Host-` prefix, GitHub Actions pinned by tag, per-instance in-memory rate limits, verification on the API event loop, the absence of a user and organization management API, digests not being signatures, or a fully consistent forged dataset verifying as healthy.
- Access to the synthetic demo organization when `REGENT_DEMO_MODE=true`. Demo personas are password-less by design; demo mode is off by default in production and must stay off for real data. (Demo credentials that keep working after demo mode is turned off, or that reach another organization, are in scope.)
- Vulnerabilities in third-party dependencies without a demonstrated impact on REGENT (report those upstream; Dependabot tracks updates).
- Denial of service by sheer request volume against a single instance.
- Findings that require an attacker who already controls the host, the database or the operator's environment variables.

## Security design

The implemented controls and the results of the internal security review are described in [docs/security-model.md](docs/security-model.md), and the threats in [docs/threat-model.md](docs/threat-model.md).
