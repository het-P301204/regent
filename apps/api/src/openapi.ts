/**
 * OpenAPI 3.1 description of the REGENT API. Hand-written and kept next to the
 * routes; the API test suite checks that every documented path is routed.
 */

type Op = { summary: string; description?: string; role?: string; tags: string[]; params?: [string, 'path' | 'query', string][]; body?: string; responses?: Record<string, string>; produces?: string }

const ops: Record<string, Record<string, Op>> = {
  '/api/health': { get: { summary: 'Service and database health', tags: ['system'], role: 'none' } },
  '/api/openapi.json': { get: { summary: 'This document', tags: ['system'], role: 'none' } },
  '/api/auth/login': { post: { summary: 'Sign in with email and password', tags: ['auth'], role: 'none', body: 'Login' } },
  '/api/auth/demo': { post: { summary: 'Sign in as a demo persona (demo mode only)', tags: ['auth'], role: 'none', body: 'DemoLogin' } },
  '/api/auth/logout': { post: { summary: 'End the session', tags: ['auth'] } },
  '/api/auth/session': { get: { summary: 'Current session, CSRF token and organization', tags: ['auth'], role: 'none' } },
  '/api/tokens': { post: { summary: 'Create an API token (returned once)', tags: ['auth'], role: 'analyst', body: 'TokenCreate' } },
  '/api/datasets': { get: { summary: 'List datasets in the organization with their latest run', tags: ['datasets'] } },
  '/api/datasets/{id}/activate': { post: { summary: 'Make a dataset the active workspace', tags: ['datasets'], params: [['id', 'path', 'Dataset id']] } },
  '/api/datasets/reset-demo': { post: { summary: 'Switch back to the demo dataset', tags: ['datasets'] } },
  '/api/datasets/{id}': { delete: { summary: 'Delete an imported, scenario or builder dataset', tags: ['datasets'], role: 'analyst', params: [['id', 'path', 'Dataset id']] } },
  '/api/datasets/{id}/issues': { get: { summary: 'Ingestion issues recorded for a dataset', tags: ['datasets'], params: [['id', 'path', 'Dataset id']] } },
  '/api/events/validate': { post: { summary: 'Validate JSON/JSONL evidence without storing it', tags: ['ingestion'], role: 'analyst', body: 'Import' } },
  '/api/events': { post: { summary: 'Import JSON/JSONL evidence as a new dataset and verify it', description: 'Imported records are untrusted evidence. Rejected records are reported with reasons; accepted records are normalized, stored and verified.', tags: ['ingestion'], role: 'analyst', body: 'Import' } },
  '/api/events/generate': { post: { summary: 'Generate a synthetic dataset from scenarios', tags: ['ingestion'], role: 'analyst', body: 'Generate' } },
  '/api/analyze': { post: { summary: 'Re-run verification on the active dataset with the current rule set', tags: ['verification'], role: 'analyst' } },
  '/api/runs': { get: { summary: 'Verification run history for the active dataset', tags: ['verification'] } },
  '/api/overview': { get: { summary: 'Command center aggregates for the active dataset', tags: ['verification'] } },
  '/api/chains': { get: { summary: 'Reconstructed chains (one per action) with filters', tags: ['chains'], params: [['health', 'query', 'verified | incomplete | violated | unknown'], ['actor', 'query', 'Actor principal id'], ['root', 'query', 'Root principal id'], ['resource', 'query', 'Resource id'], ['tool', 'query', 'Tool id'], ['severity', 'query', 'Worst finding severity'], ['attribution', 'query', 'attributable | unattributable'], ['authority', 'query', 'PASS | WARN | FAIL | UNKNOWN'], ['policy', 'query', 'Policy id'], ['from', 'query', 'ISO timestamp'], ['to', 'query', 'ISO timestamp'], ['q', 'query', 'Text search'], ['sort', 'query', 'time_desc | time_asc | risk'], ['limit', 'query', 'Max 1000'], ['offset', 'query', 'Offset']] } },
  '/api/chains/{id}': { get: { summary: 'Full verification of one action: hops, checks, findings, explanation and replay', tags: ['chains'], params: [['id', 'path', 'Action or event id']] } },
  '/api/chains/{id}/replay': { get: { summary: 'Replay timeline for one action', tags: ['chains'], params: [['id', 'path', 'Action or event id']] } },
  '/api/replay': { post: { summary: 'Replay timeline and explanation for an event', tags: ['chains'], body: 'Replay' } },
  '/api/findings': { get: { summary: 'Findings in the latest run', tags: ['findings'], params: [['severity', 'query', 'critical | high | medium | low | info'], ['type', 'query', 'Finding type'], ['status', 'query', 'Finding status'], ['rule', 'query', 'Rule id'], ['principal', 'query', 'Affected principal'], ['resource', 'query', 'Affected resource'], ['q', 'query', 'Text search']] } },
  '/api/findings/{id}': {
    get: { summary: 'One finding with evidence records and related actions', tags: ['findings'], params: [['id', 'path', 'Finding id']] },
    patch: { summary: 'Change triage status (note required to accept or suppress)', tags: ['findings'], role: 'analyst', params: [['id', 'path', 'Finding id']], body: 'FindingStatus' },
  },
  '/api/identities': { get: { summary: 'Identity registry: principals, execution identities, credentials, tools, resources', tags: ['registry'] } },
  '/api/identities/{id}': { get: { summary: 'One principal with its delegations, actions and findings', tags: ['registry'], params: [['id', 'path', 'Principal id']] } },
  '/api/delegations': { get: { summary: 'Delegation registry with contract integrity', tags: ['registry'] } },
  '/api/delegations/{id}': { get: { summary: 'One delegation rendered as a contract', tags: ['registry'], params: [['id', 'path', 'Delegation id']] } },
  '/api/credentials': { get: { summary: 'Credential lineage and binding conditions', tags: ['registry'] } },
  '/api/rules': { get: { summary: 'Verification rule set for the organization', tags: ['policy'] } },
  '/api/rules/{id}': { put: { summary: 'Enable/disable a rule or change severity, scope or remediation', tags: ['policy'], role: 'admin', params: [['id', 'path', 'AUTH-001 … AUTH-010']], body: 'RulePatch' } },
  '/api/rules/reset': { post: { summary: 'Restore the default rule set', tags: ['policy'], role: 'admin' } },
  '/api/policies': { get: { summary: 'Authorization policies recorded in the evidence', tags: ['policy'] } },
  '/api/scenarios': {
    get: { summary: 'Scenario lab catalogue', tags: ['scenarios'] },
    post: { summary: 'Load a scenario as a dataset and verify it', tags: ['scenarios'], body: 'ScenarioLoad' },
  },
  '/api/builder/verify': { post: { summary: 'Verify a ChainSpec without storing it', tags: ['builder'], body: 'ChainSpec' } },
  '/api/builder/save': { post: { summary: 'Store a ChainSpec as a dataset', tags: ['builder'], role: 'analyst', body: 'ChainSpec' } },
  '/api/time-travel': { get: { summary: 'Authority that existed at an instant, plus checkpoints', tags: ['analysis'], params: [['at', 'query', 'ISO timestamp (omit for checkpoints only)']] } },
  '/api/diff': { get: { summary: 'Compare two reconstructed chains', tags: ['analysis'], params: [['left', 'query', 'Action id'], ['right', 'query', 'Action id'], ['left_dataset', 'query', 'Optional dataset id'], ['right_dataset', 'query', 'Optional dataset id']] } },
  '/api/investigations/{event}': { get: { summary: 'Incident investigation starting from an event', tags: ['analysis'], params: [['event', 'path', 'Event id']] } },
  '/api/grc/controls': { get: { summary: 'Control evaluation derived from the latest run', tags: ['grc'] } },
  '/api/grc/evidence-package': { get: { summary: 'Downloadable auditor evidence package', tags: ['grc'], role: 'auditor', produces: 'application/json' } },
  '/api/search': { get: { summary: 'Fuzzy search across principals, chains, findings, events, credentials, tools, resources and delegations', tags: ['analysis'], params: [['q', 'query', 'Query']] } },
  '/api/reports': { get: { summary: 'Available reports and exports', tags: ['reports'] } },
  '/api/reports/security.pdf': { get: { summary: 'Security report (PDF)', tags: ['reports'], role: 'auditor', produces: 'application/pdf' } },
  '/api/reports/investigation/{event}': { get: { summary: 'Investigation report for one event (PDF)', tags: ['reports'], role: 'auditor', params: [['event', 'path', 'Event id, optionally with .pdf']], produces: 'application/pdf' } },
  '/api/exports/{file}': { get: { summary: 'findings.json | findings.csv | events.json | events.csv', tags: ['reports'], params: [['file', 'path', 'Export file name']] } },
  '/api/audit-log': { get: { summary: "REGENT's own audit log", tags: ['system'], role: 'admin' } },
}

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [path, methods] of Object.entries(ops)) {
    paths[path] = {}
    for (const [method, op] of Object.entries(methods)) {
      paths[path]![method] = {
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        tags: op.tags,
        'x-regent-min-role': op.role ?? 'viewer',
        security: op.role === 'none' ? [] : [{ session: [], csrf: [] }, { bearer: [] }],
        parameters: (op.params ?? []).map(([name, where, description]) => ({ name, in: where, required: where === 'path', description, schema: { type: 'string' } })),
        ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.body}` } } } } } : {}),
        responses: {
          200: { description: 'OK', content: { [op.produces ?? 'application/json']: {} } },
          400: { $ref: '#/components/responses/Error' },
          401: { $ref: '#/components/responses/Error' },
          403: { $ref: '#/components/responses/Error' },
          404: { $ref: '#/components/responses/Error' },
          429: { $ref: '#/components/responses/Error' },
        },
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'REGENT API',
      version: '0.1.0',
      description: 'REGENT reconstructs the authority chain behind AI-agent actions and verifies that delegated authority never silently expands. Every verdict is computed server-side by the deterministic engine in @regent/core; the API never asks a client to decide anything.',
      license: { name: 'Apache-2.0' },
    },
    servers: [{ url: '/' }],
    tags: ['system', 'auth', 'datasets', 'ingestion', 'verification', 'chains', 'findings', 'registry', 'policy', 'scenarios', 'builder', 'analysis', 'grc', 'reports'].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'regent_session', description: 'HttpOnly, SameSite=Strict session cookie.' },
        csrf: { type: 'apiKey', in: 'header', name: 'X-REGENT-CSRF', description: 'Required on POST/PUT/PATCH/DELETE with a session cookie. Value from GET /api/auth/session.' },
        bearer: { type: 'http', scheme: 'bearer', description: 'API token from POST /api/tokens. No CSRF header needed.' },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, request_id: { type: 'string' } }, required: ['code', 'message', 'request_id'] } } },
        Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
        DemoLogin: { type: 'object', required: ['persona'], properties: { persona: { enum: ['admin', 'analyst', 'auditor', 'viewer'] } } },
        TokenCreate: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 } } },
        Import: { type: 'object', required: ['name', 'content'], properties: { name: { type: 'string' }, filename: { type: 'string' }, format: { enum: ['json', 'jsonl', 'auto'] }, content: { type: 'string', description: 'JSON (bundle, array or single record) or JSONL text. Max 5 MB by default.' } } },
        Generate: { type: 'object', required: ['scenarios'], properties: { scenarios: { type: 'array', items: { type: 'string' } } } },
        Replay: { type: 'object', required: ['event_id'], properties: { event_id: { type: 'string' } } },
        FindingStatus: { type: 'object', required: ['status'], properties: { status: { enum: ['OPEN', 'INVESTIGATING', 'ACCEPTED', 'RESOLVED', 'SUPPRESSED'] }, note: { type: 'string', maxLength: 2000 } } },
        RulePatch: { type: 'object', properties: { enabled: { type: 'boolean' }, severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] }, applies_to: { type: 'array', items: { enum: ['human', 'agent', 'sub_agent', 'workload', 'service'] } }, remediation: { type: 'string' } } },
        ScenarioLoad: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
        ChainSpec: { type: 'object', description: 'See docs/delegation-model.md#chainspec', required: ['principals', 'delegations', 'actions'] },
        ActionRecord: {
          type: 'object',
          description: 'Canonical action record. Legacy aliases (delegated_user, agent_id, parent_agent, tool, resource, action, decision) are accepted and rewritten.',
          required: ['event_id'],
          properties: {
            record_type: { const: 'action' }, event_id: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' }, root_principal_id: { type: 'string' },
            actor_principal_id: { type: 'string' }, delegation_id: { type: 'string' }, execution_identity_id: { type: 'string' }, credential_id: { type: 'string' },
            tool_id: { type: 'string' }, resource_id: { type: 'string' }, operation: { type: 'string' }, requested_scope: { type: 'array', items: { type: 'string' } },
            exercised_scope: { type: 'array', items: { type: 'string' } }, policy_id: { type: 'string' }, policy_version: { type: 'string' },
            recorded_decision: { enum: ['ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN'] }, authorization_evaluated_at: { type: 'string', format: 'date-time' },
            approval_state: { enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'UNKNOWN'] }, downstream_result: { enum: ['success', 'failure', 'partial'] },
          },
        },
        Finding: { type: 'object', description: 'regent.finding/v1 — stable machine-readable finding. See docs/api.md.', required: ['schema', 'finding_id', 'type', 'rule_id', 'severity', 'status'] },
      },
    },
  }
}

export const DOCUMENTED_PATHS = Object.keys(ops)
