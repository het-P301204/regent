import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import {
  actionsCsv,
  authorityAt,
  canonicalJson,
  chainHealth,
  ChainSpecSchema,
  chainSpecToRecords,
  CONTROLS,
  diffChains,
  evaluateControls,
  findingsCsv,
  investigate,
  normalizeRecords,
  normalizeText,
  SCENARIOS,
  scenarioBySlug,
  timeCheckpoints,
  toFindingExports,
  verify,
  buildReplay,
  explainAction,
  DEFAULT_COMPLETENESS_SCHEMA,

} from '@regent/core'
import type { FindingStatus, RuleId } from '@regent/core'
import type { Config } from './config.ts'
import type { Db } from './db/driver.ts'
import { createApiToken, createSession, destroySession, verifyPassword } from './auth.ts'
import type { Role } from './auth.ts'
import { DEMO_ORG_ID, DEMO_PERSONAS } from './bootstrap.ts'
import { openApiDocument } from './openapi.ts'
import { investigationReportPdf, securityReportPdf } from './services/pdf.ts'
import { chainDetail, chainRow, findingView, nameIndex, overview, search, statusOf } from './services/views.ts'
import { WorkspaceService } from './services/workspace.ts'
import type { Workspace } from './services/workspace.ts'
import {
  authenticate,
  cors,
  CSRF_COOKIE,
  csrf,
  currentUser,
  HttpError,
  logger,
  rateLimit,
  requestContext,
  requireRole,
  secureHeaders,
  SESSION_COOKIE,
} from './security.ts'
import type { Env } from './security.ts'

export interface AppDeps {
  db: Db
  config: Config
  workspace: WorkspaceService
}

const RULE_IDS = ['AUTH-001', 'AUTH-002', 'AUTH-003', 'AUTH-004', 'AUTH-005', 'AUTH-006', 'AUTH-007', 'AUTH-008', 'AUTH-009', 'AUTH-010'] as const
const STATUSES = ['OPEN', 'INVESTIGATING', 'ACCEPTED', 'RESOLVED', 'SUPPRESSED'] as const

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, config, workspace } = deps
  const log = logger(config)
  const app = new Hono<Env>()

  app.use('*', requestContext(log))
  app.use('*', secureHeaders(config))
  app.use('/api/*', cors(config))
  app.use('/api/*', rateLimit('api', 600, 60_000))
  app.use('/api/*', authenticate(db))
  app.use('/api/*', csrf(config))

  app.onError((err, c) => {
    const requestId = c.get('requestId')
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null, request_id: requestId } }, err.status as 400)
    if (err instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_FAILED', message: 'The request did not match the expected shape.', details: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })), request_id: requestId } }, 400)
    // Never expose stack traces: log them, return an id the operator can search for.
    log('error', { request_id: requestId, operation: `${c.req.method} ${c.req.routePath}`, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join(' | ') : undefined })
    return c.json({ error: { code: 'INTERNAL', message: 'REGENT could not complete the request. The error has been logged.', request_id: requestId } }, 500)
  })

  const audit = async (c: Context<Env>, action: string, target: string | null, detail: Record<string, unknown> = {}) => {
    const u = c.get('user')
    if (!u) return
    await db.query('INSERT INTO audit_log (organization_id, user_id, action, target, detail, request_id) VALUES ($1, $2, $3, $4, $5, $6)', [u.organization_id, u.user_id, action, target, JSON.stringify(detail), c.get('requestId')])
  }

  const body = async <T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T>> => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
    }
    return schema.parse(raw)
  }

  /** The caller's active dataset, falling back to the organization's demo dataset. */
  const activeWorkspace = async (c: Context<Env>): Promise<Workspace> => {
    const u = currentUser(c)
    const requested = c.req.query('dataset')
    let id = requested ?? u.active_dataset_id ?? (await workspace.demoDatasetId(u.organization_id))
    let ws = id ? await workspace.workspace(u.organization_id, id) : null
    if (!ws && !requested) {
      id = await workspace.demoDatasetId(u.organization_id)
      ws = id ? await workspace.workspace(u.organization_id, id) : null
    }
    if (!ws) throw new HttpError(404, 'NO_DATASET', 'No dataset is available. Load the demo environment or import events.')
    return ws
  }

  const setActive = async (userId: string, org: string, datasetId: string) => {
    await db.query('UPDATE users SET active_dataset_id = $1 WHERE id = $2 AND organization_id = $3', [datasetId, userId, org])
  }

  // ------------------------------------------------------------------ public

  app.get('/api/health', async (c) => {
    let database = 'ok'
    try {
      await db.query('SELECT 1')
    } catch {
      database = 'unavailable'
    }
    return c.json({ status: database === 'ok' ? 'ok' : 'degraded', database, database_engine: db.kind, demo_mode: config.demoMode, version: '0.1.0' }, database === 'ok' ? 200 : 503)
  })

  app.get('/api/openapi.json', (c) => c.json(openApiDocument()))

  // -------------------------------------------------------------------- auth

  const issueSession = async (c: Context<Env>, userId: string, org: string) => {
    const s = await createSession(db, userId, org, config.sessionHours)
    const common = { path: '/', secure: config.cookieSecure, sameSite: 'Strict' as const, expires: s.expires }
    setCookie(c, SESSION_COOKIE, s.token, { ...common, httpOnly: true })
    setCookie(c, CSRF_COOKIE, s.csrf, { ...common, httpOnly: false })
    return s
  }

  app.post('/api/auth/login', rateLimit('auth', 10, 60_000), async (c) => {
    const input = await body(c, z.object({ email: z.string().email().max(254), password: z.string().min(1).max(512) }))
    const [u] = await db.query<{ id: string; organization_id: string; password_hash: string | null }>('SELECT id, organization_id, password_hash FROM users WHERE email = $1', [input.email.toLowerCase()])
    // Same response and similar work whether the user exists or not.
    const ok = u?.password_hash ? await verifyPassword(input.password, u.password_hash) : (await verifyPassword(input.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), false)
    if (!u || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    const s = await issueSession(c, u.id, u.organization_id)
    c.set('user', { user_id: u.id, organization_id: u.organization_id, email: input.email, display_name: '', role: 'viewer', is_demo_persona: false, active_dataset_id: null, via: 'session', csrf_token: s.csrf })
    await audit(c, 'auth.login', u.id)
    return c.json({ ok: true, csrf_token: s.csrf })
  })

  app.post('/api/auth/demo', rateLimit('demo-auth', 60, 60_000), async (c) => {
    if (!config.demoMode) throw new HttpError(404, 'DEMO_DISABLED', 'Demo personas are disabled on this deployment.')
    const input = await body(c, z.object({ persona: z.enum(['admin', 'analyst', 'auditor', 'viewer']) }))
    const p = DEMO_PERSONAS.find((x) => x.role === input.persona)!
    const s = await issueSession(c, p.id, DEMO_ORG_ID)
    c.set('user', { user_id: p.id, organization_id: DEMO_ORG_ID, email: p.email, display_name: p.display_name, role: p.role, is_demo_persona: true, active_dataset_id: null, via: 'session', csrf_token: s.csrf })
    await audit(c, 'auth.demo_login', p.id, { persona: p.role })
    return c.json({ ok: true, csrf_token: s.csrf })
  })

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await destroySession(db, token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    deleteCookie(c, CSRF_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/auth/session', async (c) => {
    const u = c.get('user')
    if (!u) return c.json({ authenticated: false, demo_mode: config.demoMode, personas: config.demoMode ? DEMO_PERSONAS.map(({ id: _id, ...p }) => p) : [] })
    const [org] = await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [u.organization_id])
    return c.json({
      authenticated: true,
      demo_mode: config.demoMode,
      user: { id: u.user_id, email: u.email, display_name: u.display_name, role: u.role, is_demo_persona: u.is_demo_persona },
      organization: { id: u.organization_id, name: org?.name ?? '' },
      csrf_token: u.csrf_token,
      active_dataset_id: u.active_dataset_id,
    })
  })

  app.post('/api/tokens', requireRole('analyst'), async (c) => {
    const input = await body(c, z.object({ name: z.string().min(1).max(80) }))
    const t = await createApiToken(db, currentUser(c), input.name)
    await audit(c, 'token.create', t.prefix, { name: input.name })
    return c.json({ token: t.token, prefix: t.prefix, note: 'Shown once. Store it in a secret manager.' }, 201)
  })

  // ---------------------------------------------------------------- datasets

  app.get('/api/datasets', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const list = await workspace.listDatasets(u.organization_id)
    const active = u.active_dataset_id ?? (await workspace.demoDatasetId(u.organization_id))
    return c.json({ active_dataset_id: active, datasets: list })
  })

  app.post('/api/datasets/:id/activate', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const ds = await workspace.getDataset(u.organization_id, c.req.param('id'))
    if (!ds) throw new HttpError(404, 'NOT_FOUND', 'Dataset not found.')
    await setActive(u.user_id, u.organization_id, ds.id)
    return c.json({ ok: true, active_dataset_id: ds.id })
  })

  app.post('/api/datasets/reset-demo', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const id = await workspace.demoDatasetId(u.organization_id)
    if (!id) throw new HttpError(404, 'NO_DEMO', 'This organization has no demo dataset.')
    await setActive(u.user_id, u.organization_id, id)
    await audit(c, 'dataset.reset_to_demo', id)
    return c.json({ ok: true, active_dataset_id: id })
  })

  app.delete('/api/datasets/:id', requireRole('analyst'), async (c) => {
    const u = currentUser(c)
    const ok = await workspace.deleteDataset(u.organization_id, c.req.param('id'))
    if (!ok) throw new HttpError(404, 'NOT_FOUND', 'Dataset not found, or it is the demo dataset (which cannot be deleted).')
    await db.query('UPDATE users SET active_dataset_id = NULL WHERE organization_id = $1 AND active_dataset_id = $2', [u.organization_id, c.req.param('id')])
    await audit(c, 'dataset.delete', c.req.param('id'))
    return c.json({ ok: true })
  })

  app.get('/api/datasets/:id/issues', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const ds = await workspace.getDataset(u.organization_id, c.req.param('id'))
    if (!ds) throw new HttpError(404, 'NOT_FOUND', 'Dataset not found.')
    return c.json({ dataset: ds, issues: await workspace.issues(u.organization_id, ds.id) })
  })

  // --------------------------------------------------------------- ingestion

  const ImportBody = z.object({
    name: z.string().min(1).max(120),
    filename: z.string().max(200).optional(),
    format: z.enum(['json', 'jsonl', 'auto']).default('auto'),
    content: z.string().min(1),
  })

  app.post('/api/events/validate', requireRole('analyst'), rateLimit('import', 30, 60_000), async (c) => {
    const len = Number(c.req.header('content-length') ?? 0)
    if (len > config.maxImportBytes * 1.1) throw new HttpError(413, 'TOO_LARGE', `Imports are limited to ${Math.round(config.maxImportBytes / 1024 / 1024)} MB.`)
    const input = await body(c, ImportBody)
    if (input.content.length > config.maxImportBytes) throw new HttpError(413, 'TOO_LARGE', `Imports are limited to ${Math.round(config.maxImportBytes / 1024 / 1024)} MB.`)
    const r = normalizeText(input.content)
    return c.json({ stats: r.stats, issues: r.issues.slice(0, 500), issue_count: r.issues.length, counts: { principals: r.bundle.principals.length, delegations: r.bundle.delegations.length, actions: r.bundle.actions.length } })
  })

  app.post('/api/events', requireRole('analyst'), rateLimit('import', 20, 60_000), async (c) => {
    const len = Number(c.req.header('content-length') ?? 0)
    if (len > config.maxImportBytes * 1.1) throw new HttpError(413, 'TOO_LARGE', `Imports are limited to ${Math.round(config.maxImportBytes / 1024 / 1024)} MB.`)
    const u = currentUser(c)
    const input = await body(c, ImportBody)
    if (input.content.length > config.maxImportBytes) throw new HttpError(413, 'TOO_LARGE', 'Import too large.')
    const preview = normalizeText(input.content)
    if (preview.stats.records_accepted === 0) throw new HttpError(422, 'NOTHING_ACCEPTED', 'No record in the import passed validation.', { issues: preview.issues.slice(0, 50) })
    const res = await workspace.createDataset(u.organization_id, u.user_id, {
      name: input.name,
      source: 'import',
      metadata: { filename: input.filename ?? null, format: input.format, bytes: input.content.length, imported_by: u.email, untrusted: true },
      text: input.content,
    })
    await setActive(u.user_id, u.organization_id, res.dataset.id)
    await audit(c, 'dataset.import', res.dataset.id, { name: input.name, records: res.normalized.stats })
    return c.json({ dataset: res.dataset, run_id: res.run_id, stats: res.normalized.stats, issues: res.normalized.issues.slice(0, 500), summary: res.run.summary }, 201)
  })

  app.post('/api/events/generate', requireRole('analyst'), async (c) => {
    const u = currentUser(c)
    const input = await body(c, z.object({ scenarios: z.array(z.string().max(64)).min(1).max(12) }))
    const records = input.scenarios.flatMap((slug) => {
      const s = scenarioBySlug(slug)
      if (!s) throw new HttpError(400, 'UNKNOWN_SCENARIO', `Unknown scenario "${slug}".`)
      return s.records
    })
    // Scenarios share a registry; identical duplicates collapse during normalization.
    const res = await workspace.createDataset(u.organization_id, u.user_id, { name: `Synthetic events: ${input.scenarios.join(', ')}`.slice(0, 120), source: 'scenario', metadata: { generator: 'scenario mix', scenarios: input.scenarios }, records })
    await setActive(u.user_id, u.organization_id, res.dataset.id)
    await audit(c, 'dataset.generate', res.dataset.id, { scenarios: input.scenarios })
    return c.json({ dataset: res.dataset, run_id: res.run_id, stats: res.normalized.stats, issues: res.normalized.issues.slice(0, 200), summary: res.run.summary }, 201)
  })

  // ------------------------------------------------------------ verification

  app.post('/api/analyze', requireRole('analyst'), async (c) => {
    const u = currentUser(c)
    const ws = await activeWorkspace(c)
    const res = await workspace.runVerification(u.organization_id, ws.dataset.id, u.user_id)
    await audit(c, 'verification.run', ws.dataset.id, { run_id: res.run_id, input_digest: res.run.input_digest })
    return c.json({ run_id: res.run_id, dataset_id: ws.dataset.id, input_digest: res.run.input_digest, ruleset_version: res.run.ruleset_version, summary: res.run.summary, stages: ['COLLECTING', 'RECONSTRUCTING', 'VERIFYING', 'CHECKING_AUTHORITY', 'CHECKING_ATTRIBUTION', 'COMPLETE'] })
  })

  app.get('/api/runs', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const ws = await activeWorkspace(c)
    return c.json({ dataset_id: ws.dataset.id, runs: await workspace.runHistory(u.organization_id, ws.dataset.id) })
  })

  app.get('/api/overview', requireRole('viewer'), async (c) => c.json(overview(await activeWorkspace(c))))

  app.get('/api/chains', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const q = c.req.query()
    let rows = ws.run.actions.map((v) => chainRow(ws, v))
    const eq = (key: string, get: (r: (typeof rows)[number]) => string | null | undefined) => {
      const val = q[key]
      if (val) rows = rows.filter((r) => (get(r) ?? '') === val)
    }
    eq('health', (r) => r.health)
    eq('actor', (r) => r.actor_principal_id)
    eq('root', (r) => r.root_principal_id)
    eq('resource', (r) => r.resource_id)
    eq('tool', (r) => r.tool_id)
    eq('decision', (r) => r.derived_decision)
    if (q['attribution']) rows = rows.filter((r) => (q['attribution'] === 'attributable' ? r.root_principal_id !== null : r.root_principal_id === null))
    if (q['authority']) rows = rows.filter((r) => r.checks['authority'] === q['authority'])
    if (q['severity']) rows = rows.filter((r) => r.worst_severity === q['severity'])
    if (q['policy']) rows = rows.filter((r) => ws.bundle.actions.find((a) => a.action_id === r.action_id)?.policy_id === q['policy'])
    if (q['from']) rows = rows.filter((r) => (r.timestamp ?? '') >= q['from']!)
    if (q['to']) rows = rows.filter((r) => (r.timestamp ?? '') <= q['to']!)
    if (q['q']) {
      const needle = q['q'].toLowerCase()
      rows = rows.filter((r) => [r.event_id, r.actor_name, r.root_name, r.tool_name, r.resource_name].some((x) => x?.toLowerCase().includes(needle)))
    }
    const sort = q['sort'] ?? 'time_desc'
    rows.sort((a, b) => {
      if (sort === 'time_asc') return (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
      if (sort === 'risk') return rank(b.health) - rank(a.health) || (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
      return (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
    })
    const limit = Math.min(Number(q['limit'] ?? 200) || 200, 1000)
    const offset = Math.max(Number(q['offset'] ?? 0) || 0, 0)
    return c.json({ total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit), facets: facets(ws) })
  })

  app.get('/api/chains/:id', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const id = c.req.param('id')
    const v = ws.run.actions.find((a) => a.action_id === id || a.event_id === id)
    if (!v) throw new HttpError(404, 'NOT_FOUND', `No action "${id}" in this dataset.`)
    return c.json(chainDetail(ws, v))
  })

  app.get('/api/chains/:id/replay', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const r = buildReplay(ws.bundle, ws.run, c.req.param('id'))
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'No such action.')
    return c.json(r)
  })

  app.post('/api/replay', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const input = await body(c, z.object({ event_id: z.string().min(1).max(192) }))
    const r = buildReplay(ws.bundle, ws.run, input.event_id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'No such event.')
    return c.json({ replay: r, explanation: explainAction(ws.bundle, ws.run, input.event_id) })
  })

  // ---------------------------------------------------------------- findings

  app.get('/api/findings', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const q = c.req.query()
    let list = ws.run.findings.map((f) => findingView(ws, f))
    if (q['severity']) list = list.filter((f) => f.severity === q['severity'])
    if (q['type']) list = list.filter((f) => f.type === q['type'])
    if (q['status']) list = list.filter((f) => f.status === q['status'])
    if (q['rule']) list = list.filter((f) => f.rule_id === q['rule'])
    if (q['principal']) list = list.filter((f) => f.affected_principal_ids.includes(q['principal']!))
    if (q['resource']) list = list.filter((f) => f.affected_resource_ids.includes(q['resource']!))
    if (q['q']) {
      const needle = q['q'].toLowerCase()
      list = list.filter((f) => `${f.finding_id} ${f.title} ${f.summary}`.toLowerCase().includes(needle))
    }
    return c.json({ total: list.length, findings: list, input_digest: ws.run.input_digest, ruleset_version: ws.run.ruleset_version })
  })

  app.get('/api/findings/:id', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const f = ws.run.findings.find((x) => x.finding_id === c.req.param('id'))
    if (!f) throw new HttpError(404, 'NOT_FOUND', 'Finding not found in the latest run of this dataset.')
    const related = ws.run.actions.filter((a) => f.related_event_ids.includes(a.event_id)).map((v) => chainRow(ws, v))
    const evidence = f.evidence.map((e) => ({ ...e, record: evidenceRecord(ws, e.kind, e.id) }))
    return c.json({ finding: findingView(ws, f), related_actions: related, evidence, names: Object.fromEntries(f.affected_principal_ids.map((id) => [id, nameIndex(ws.bundle).p(id)])) })
  })

  app.patch('/api/findings/:id', requireRole('analyst'), async (c) => {
    const u = currentUser(c)
    const ws = await activeWorkspace(c)
    const input = await body(c, z.object({ status: z.enum(STATUSES), note: z.string().max(2000).nullable().optional() }))
    const f = ws.run.findings.find((x) => x.finding_id === c.req.param('id'))
    if (!f) throw new HttpError(404, 'NOT_FOUND', 'Finding not found.')
    if ((input.status === 'SUPPRESSED' || input.status === 'ACCEPTED') && !input.note) throw new HttpError(400, 'NOTE_REQUIRED', 'Accepting or suppressing a finding requires a note explaining why.')
    await workspace.setFindingStatus(u.organization_id, ws.dataset.id, f.finding_id, input.status as FindingStatus, input.note ?? null, u.email)
    await audit(c, 'finding.status', f.finding_id, { from: statusOf(ws, f.finding_id), to: input.status })
    return c.json({ ok: true })
  })

  // ---------------------------------------------------------------- registry

  app.get('/api/identities', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const at = ws.bundle.actions.map((a) => a.timestamp).filter((x): x is string => !!x).sort().at(-1) ?? null
    const lastActivity = new Map<string, string>()
    for (const a of ws.bundle.actions) if (a.actor_principal_id && a.timestamp) lastActivity.set(a.actor_principal_id, a.timestamp)
    const referenced = new Set<string>()
    for (const d of ws.bundle.delegations) for (const p of [d.delegator_principal_id, d.delegatee_principal_id]) if (p) referenced.add(p)
    for (const a of ws.bundle.actions) if (a.actor_principal_id) referenced.add(a.actor_principal_id)
    const known = new Set(ws.bundle.principals.map((p) => p.principal_id))
    const lifecycle = (created: string | null, revoked: string | null, expires: string | null, suspended: string | null) => {
      if (!at) return 'UNKNOWN'
      if (revoked && revoked <= at) return 'REVOKED'
      if (suspended && suspended <= at) return 'SUSPENDED'
      if (expires && expires <= at) return 'EXPIRED'
      return created ? 'ACTIVE' : 'UNKNOWN'
    }
    return c.json({
      as_of: at,
      principals: ws.bundle.principals.map((p) => ({
        ...p,
        lifecycle: lifecycle(p.created_at, p.revoked_at, p.expires_at, p.suspended_at),
        parents: ws.bundle.delegations.filter((d) => d.delegatee_principal_id === p.principal_id).map((d) => d.delegator_principal_id),
        inbound_delegations: ws.bundle.delegations.filter((d) => d.delegatee_principal_id === p.principal_id).map((d) => d.delegation_id),
        execution_identities: ws.bundle.execution_identities.filter((e) => e.bound_principal_id === p.principal_id).map((e) => e.execution_identity_id),
        last_activity: lastActivity.get(p.principal_id) ?? null,
        finding_count: ws.run.findings.filter((f) => f.affected_principal_ids.includes(p.principal_id)).length,
      })),
      unknown: [...referenced].filter((id) => !known.has(id)).sort().map((id) => ({ principal_id: id, lifecycle: 'UNKNOWN' })),
      execution_identities: ws.bundle.execution_identities.map((e) => ({ ...e, lifecycle: lifecycle(e.issued_at, e.revoked_at, e.expires_at, null) })),
      credentials: ws.bundle.credentials.map((x) => ({ ...x, lifecycle: lifecycle(x.issued_at, x.revoked_at, x.expires_at, null) })),
      tools: ws.bundle.tools,
      resources: ws.bundle.resources,
    })
  })

  app.get('/api/identities/:id', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const id = c.req.param('id')
    const p = ws.bundle.principals.find((x) => x.principal_id === id)
    const actions = ws.run.actions.filter((a) => a.chain.actor_principal_id === id || a.chain.hops.some((h) => h.delegator_principal_id === id || h.delegatee_principal_id === id))
    if (!p && actions.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Identity not found.')
    return c.json({
      principal: p ?? null,
      known: !!p,
      inbound: ws.bundle.delegations.filter((d) => d.delegatee_principal_id === id),
      outbound: ws.bundle.delegations.filter((d) => d.delegator_principal_id === id),
      execution_identities: ws.bundle.execution_identities.filter((e) => e.bound_principal_id === id),
      actions: actions.map((v) => chainRow(ws, v)),
      findings: ws.run.findings.filter((f) => f.affected_principal_ids.includes(id)).map((f) => findingView(ws, f)),
    })
  })

  app.get('/api/delegations', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const n = nameIndex(ws.bundle)
    const ix = ws.run.actions
    return c.json({
      delegations: ws.bundle.delegations.map((d) => {
        const hop = ix.flatMap((a) => a.chain.hops).find((h) => h.delegation_id === d.delegation_id)
        const findings = ws.run.findings.filter((f) => f.delegation_id === d.delegation_id)
        return {
          ...d,
          delegator_name: d.delegator_principal_id ? n.p(d.delegator_principal_id) : null,
          delegatee_name: d.delegatee_principal_id ? n.p(d.delegatee_principal_id) : null,
          available_scope: hop?.available_scope ?? null,
          effective_scope: hop?.effective_scope ?? null,
          amplified: hop?.amplified ?? [],
          used_by: ix.filter((a) => a.chain.hops.some((h) => h.delegation_id === d.delegation_id)).map((a) => a.event_id),
          finding_ids: findings.map((f) => f.finding_id),
          contract_integrity: findings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'VIOLATION' : findings.length > 0 ? 'WARN' : hop ? 'PASS' : 'UNVERIFIED',
        }
      }),
    })
  })

  app.get('/api/delegations/:id', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const d = ws.bundle.delegations.find((x) => x.delegation_id === c.req.param('id'))
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Delegation not found.')
    const n = nameIndex(ws.bundle)
    const hop = ws.run.actions.flatMap((a) => a.chain.hops).find((h) => h.delegation_id === d.delegation_id) ?? null
    const findings = ws.run.findings.filter((f) => f.delegation_id === d.delegation_id || f.evidence.some((e) => e.kind === 'delegation' && e.id === d.delegation_id))
    const policy = ws.bundle.policies.find((p) => p.policy_id === d.policy_id && p.policy_version === d.policy_version) ?? null
    return c.json({
      delegation: d,
      delegator_name: d.delegator_principal_id ? n.p(d.delegator_principal_id) : null,
      delegatee_name: d.delegatee_principal_id ? n.p(d.delegatee_principal_id) : null,
      hop,
      policy,
      parent: d.parent_delegation_id ? (ws.bundle.delegations.find((x) => x.delegation_id === d.parent_delegation_id) ?? null) : null,
      children: ws.bundle.delegations.filter((x) => x.parent_delegation_id === d.delegation_id),
      used_by: ws.run.actions.filter((a) => a.chain.hops.some((h) => h.delegation_id === d.delegation_id)).map((v) => chainRow(ws, v)),
      findings: findings.map((f) => findingView(ws, f)),
      contract_integrity: findings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'VIOLATION' : findings.length > 0 ? 'WARN' : hop ? 'PASS' : 'UNVERIFIED',
    })
  })

  app.get('/api/credentials', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const n = nameIndex(ws.bundle)
    const lineage = ws.bundle.credentials.map((cr) => {
      const ex = ws.bundle.execution_identities.find((e) => e.execution_identity_id === cr.execution_identity_id) ?? null
      const uses = ws.run.actions.filter((a) => ws.bundle.actions.find((x) => x.action_id === a.action_id)?.credential_id === cr.credential_id)
      const findings = ws.run.findings.filter((f) => f.evidence.some((e) => e.kind === 'credential' && e.id === cr.credential_id))
      const actorIds = [...new Set(uses.map((u) => u.chain.actor_principal_id).filter((x): x is string => !!x))]
      return {
        credential: cr,
        execution_identity: ex,
        bound_principal: ex?.bound_principal_id ? { id: ex.bound_principal_id, name: n.p(ex.bound_principal_id) } : null,
        lineage: ex?.bound_principal_id ? ws.run.actions.find((a) => a.chain.actor_principal_id === ex.bound_principal_id)?.chain.hops.map((h) => ({ id: h.delegator_principal_id, name: h.delegator_principal_id ? n.p(h.delegator_principal_id) : '?' })) ?? [] : [],
        used_by_actors: actorIds.map((id) => ({ id, name: n.p(id), matches_binding: id === ex?.bound_principal_id })),
        uses: uses.map((u) => ({ event_id: u.event_id, timestamp: u.timestamp, health: chainHealth(u) })),
        conditions: [
          ...(ex ? [] : [cr.execution_identity_id ? 'BINDING_TO_UNKNOWN_IDENTITY' : 'NO_BINDING']),
          ...(ex && !ex.bound_principal_id ? ['NO_PARENT_LINEAGE'] : []),
          ...(actorIds.some((id) => id !== ex?.bound_principal_id) ? ['USED_OUTSIDE_BINDING'] : []),
          ...(cr.revoked_at && uses.some((u) => u.timestamp && u.timestamp >= cr.revoked_at! && u.executed) ? ['REVOKED_CREDENTIAL_USED'] : []),
          ...(cr.expires_at && uses.some((u) => u.timestamp && u.timestamp >= cr.expires_at! && u.executed) ? ['STALE_CREDENTIAL_USED'] : []),
        ],
        finding_ids: findings.map((f) => f.finding_id),
      }
    })
    const unknown = [...new Set(ws.bundle.actions.map((a) => a.credential_id).filter((x): x is string => !!x && !ws.bundle.credentials.some((c2) => c2.credential_id === x)))]
    return c.json({ lineage, unknown_credentials: unknown })
  })

  // ---------------------------------------------------------- rules & policy

  app.get('/api/rules', requireRole('viewer'), async (c) => c.json(await workspace.ruleset(currentUser(c).organization_id)))

  app.put('/api/rules/:id', requireRole('admin'), async (c) => {
    const u = currentUser(c)
    const id = z.enum(RULE_IDS).parse(c.req.param('id')) as RuleId
    const input = await body(c, z.object({
      enabled: z.boolean().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
      applies_to: z.array(z.enum(['human', 'agent', 'sub_agent', 'workload', 'service'])).max(5).optional(),
      remediation: z.string().min(1).max(1000).optional(),
    }))
    const rs = await workspace.updateRule(u.organization_id, u.email, id, input)
    await audit(c, 'rule.update', id, input)
    return c.json(rs)
  })

  app.post('/api/rules/reset', requireRole('admin'), async (c) => {
    const u = currentUser(c)
    await workspace.resetRules(u.organization_id)
    await audit(c, 'rule.reset', null)
    return c.json(await workspace.ruleset(u.organization_id))
  })

  app.get('/api/policies', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    return c.json({
      policies: ws.bundle.policies.map((p) => ({
        ...p,
        decisions: ws.bundle.actions.filter((a) => a.policy_id === p.policy_id && a.policy_version === p.policy_version).length,
        delegations: ws.bundle.delegations.filter((d) => d.policy_id === p.policy_id && d.policy_version === p.policy_version).length,
      })),
      unversioned_decisions: ws.bundle.actions.filter((a) => !a.policy_version).map((a) => a.event_id),
      completeness_schema: DEFAULT_COMPLETENESS_SCHEMA,
    })
  })

  // --------------------------------------------------------------- scenarios

  app.get('/api/scenarios', requireRole('viewer'), (c) =>
    c.json({ scenarios: SCENARIOS.map(({ records, ...s }) => ({ ...s, record_count: records.length })) }))

  app.post('/api/scenarios', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const input = await body(c, z.object({ slug: z.string().min(1).max(64) }))
    const s = scenarioBySlug(input.slug)
    if (!s) throw new HttpError(404, 'UNKNOWN_SCENARIO', `Unknown scenario "${input.slug}".`)
    const res = await workspace.createDataset(u.organization_id, u.user_id, { name: `Scenario ${s.number}: ${s.title}`, source: 'scenario', metadata: { slug: s.slug, number: s.number, synthetic: true }, records: s.records })
    await setActive(u.user_id, u.organization_id, res.dataset.id)
    await audit(c, 'scenario.load', s.slug, { dataset: res.dataset.id })
    const expected = [...s.expected].sort()
    const got = [...new Set(res.run.findings.map((f) => f.type))].sort()
    return c.json({ dataset: res.dataset, run_id: res.run_id, focus_event: s.focus_event, summary: res.run.summary, expected, produced: got, matches_expected: JSON.stringify(expected) === JSON.stringify(got) }, 201)
  })

  // ----------------------------------------------------------- chain builder

  app.post('/api/builder/verify', requireRole('viewer'), rateLimit('builder', 120, 60_000), async (c) => {
    const spec = await body(c, ChainSpecSchema)
    const records = chainSpecToRecords(spec)
    const normalized = normalizeRecords(records)
    const run = verify(normalized.bundle, { ruleset: await workspace.ruleset(currentUser(c).organization_id) })
    const n = nameIndex(normalized.bundle)
    return c.json({
      run,
      explanations: run.actions.map((a) => explainAction(normalized.bundle, run, a.action_id)),
      replays: run.actions.map((a) => buildReplay(normalized.bundle, run, a.action_id)),
      names: Object.fromEntries(normalized.bundle.principals.map((p) => [p.principal_id, n.p(p.principal_id)])),
      records,
      issues: normalized.issues,
    })
  })

  app.post('/api/builder/save', requireRole('analyst'), async (c) => {
    const u = currentUser(c)
    const spec = await body(c, ChainSpecSchema)
    const res = await workspace.createDataset(u.organization_id, u.user_id, { name: spec.name?.trim() || 'Built chain', source: 'builder', metadata: { synthetic: true, spec }, records: chainSpecToRecords(spec) })
    await setActive(u.user_id, u.organization_id, res.dataset.id)
    await audit(c, 'builder.save', res.dataset.id)
    return c.json({ dataset: res.dataset, run_id: res.run_id }, 201)
  })

  // ---------------------------------------------------------- analysis views

  app.get('/api/time-travel', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const at = c.req.query('at')
    const checkpoints = timeCheckpoints(ws.bundle)
    if (!at) return c.json({ checkpoints })
    const parsed = Date.parse(at)
    if (Number.isNaN(parsed)) throw new HttpError(400, 'INVALID_TIME', 'at must be an ISO-8601 timestamp.')
    const n = nameIndex(ws.bundle)
    const view = authorityAt(ws.bundle, new Date(parsed).toISOString())
    return c.json({ ...view, checkpoints, names: Object.fromEntries(ws.bundle.principals.map((p) => [p.principal_id, n.p(p.principal_id)])) })
  })

  app.get('/api/diff', requireRole('viewer'), async (c) => {
    const u = currentUser(c)
    const left = c.req.query('left')
    const right = c.req.query('right')
    if (!left || !right) throw new HttpError(400, 'MISSING_PARAMS', 'left and right action ids are required.')
    const lws = c.req.query('left_dataset') ? await workspace.workspace(u.organization_id, c.req.query('left_dataset')!) : await activeWorkspace(c)
    const rws = c.req.query('right_dataset') ? await workspace.workspace(u.organization_id, c.req.query('right_dataset')!) : await activeWorkspace(c)
    if (!lws || !rws) throw new HttpError(404, 'NOT_FOUND', 'Dataset not found.')
    const lv = lws.run.actions.find((a) => a.action_id === left || a.event_id === left)
    const rv = rws.run.actions.find((a) => a.action_id === right || a.event_id === right)
    if (!lv || !rv) throw new HttpError(404, 'NOT_FOUND', 'Action not found.')
    return c.json({ left: chainRow(lws, lv), right: chainRow(rws, rv), entries: diffChains({ bundle: lws.bundle, verification: lv }, { bundle: rws.bundle, verification: rv }) })
  })

  app.get('/api/investigations/:event', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const inv = investigate(ws.bundle, ws.run, c.req.param('event'))
    if (!inv) throw new HttpError(404, 'NOT_FOUND', `No event "${c.req.param('event')}" in this dataset.`)
    const n = nameIndex(ws.bundle)
    return c.json({ ...inv, findings: inv.findings.map((f) => findingView(ws, f)), names: Object.fromEntries(ws.bundle.principals.map((p) => [p.principal_id, n.p(p.principal_id)])), tools: Object.fromEntries(ws.bundle.tools.map((t) => [t.tool_id, t.display_name])), resources: Object.fromEntries(ws.bundle.resources.map((r) => [r.resource_id, r.display_name])) })
  })

  app.get('/api/grc/controls', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    return c.json({ controls: evaluateControls(ws.run).map((x) => ({ ...x, finding_statuses: Object.fromEntries(x.finding_ids.map((id) => [id, statusOf(ws, id)])) })), definitions: CONTROLS, run: { id: ws.run_id, input_digest: ws.run.input_digest, ruleset_version: ws.run.ruleset_version } })
  })

  app.get('/api/grc/evidence-package', requireRole('auditor'), async (c) => {
    const ws = await activeWorkspace(c)
    const u = currentUser(c)
    await audit(c, 'export.evidence_package', ws.dataset.id)
    const pkg = {
      schema: 'regent.evidence-package/v1',
      generated_at: new Date().toISOString(),
      generated_by: u.email,
      dataset: ws.dataset,
      run: { id: ws.run_id, created_at: ws.run_created_at, input_digest: ws.run.input_digest, ruleset_version: ws.run.ruleset_version, engine_version: ws.run.engine_version },
      ruleset: await workspace.ruleset(u.organization_id),
      controls: evaluateControls(ws.run),
      findings: toFindingExports(ws.run, new Map([...ws.statuses].map(([k, v]) => [k, v.status]))),
      evidence: ws.bundle,
      note: 'Record digests are SHA-256 over canonical JSON of each normalized record. They detect change; they are not signatures.',
    }
    return attachment(c, `regent-evidence-${ws.dataset.id}.json`, 'application/json', canonicalPretty(pkg))
  })

  app.get('/api/search', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    return c.json({ results: search(ws, c.req.query('q') ?? '') })
  })

  // ------------------------------------------------------- reports & exports

  app.get('/api/reports', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    return c.json({
      dataset: ws.dataset,
      reports: [
        { id: 'security', title: 'Delegation Authority Security Report', format: 'pdf', href: '/api/reports/security.pdf' },
        { id: 'findings-json', title: 'Findings (regent.finding/v1)', format: 'json', href: '/api/exports/findings.json' },
        { id: 'findings-csv', title: 'Findings', format: 'csv', href: '/api/exports/findings.csv' },
        { id: 'events-json', title: 'Normalized evidence', format: 'json', href: '/api/exports/events.json' },
        { id: 'events-csv', title: 'Action verification results', format: 'csv', href: '/api/exports/events.csv' },
        { id: 'evidence-package', title: 'Auditor evidence package', format: 'json', href: '/api/grc/evidence-package' },
      ],
      investigation_template: '/api/reports/investigation/{event_id}.pdf',
    })
  })

  app.get('/api/reports/security.pdf', requireRole('auditor'), async (c) => {
    const ws = await activeWorkspace(c)
    const u = currentUser(c)
    const pdf = await securityReportPdf(ws, u.email, new Date().toISOString())
    await audit(c, 'report.security', ws.dataset.id)
    return attachment(c, `regent-security-report-${ws.dataset.id}.pdf`, 'application/pdf', pdf)
  })

  app.get('/api/reports/investigation/:event', requireRole('auditor'), async (c) => {
    const ws = await activeWorkspace(c)
    const u = currentUser(c)
    const event = c.req.param('event').replace(/\.pdf$/, '')
    const pdf = await investigationReportPdf(ws, event, u.email, new Date().toISOString())
    if (!pdf) throw new HttpError(404, 'NOT_FOUND', 'No such event.')
    await audit(c, 'report.investigation', event)
    return attachment(c, `regent-investigation-${safeName(event)}.pdf`, 'application/pdf', pdf)
  })

  app.get('/api/exports/:file', requireRole('viewer'), async (c) => {
    const ws = await activeWorkspace(c)
    const file = c.req.param('file')
    const statuses = new Map([...ws.statuses].map(([k, v]) => [k, v.status]))
    await audit(c, 'export', file, { dataset: ws.dataset.id })
    switch (file) {
      case 'findings.json':
        return attachment(c, 'regent-findings.json', 'application/json', JSON.stringify({ schema: 'regent.findings/v1', dataset_id: ws.dataset.id, run_id: ws.run_id, findings: toFindingExports(ws.run, statuses) }, null, 2))
      case 'findings.csv':
        return attachment(c, 'regent-findings.csv', 'text/csv; charset=utf-8', findingsCsv(ws.run, statuses))
      case 'events.json':
        return attachment(c, 'regent-normalized-evidence.json', 'application/json', JSON.stringify({ schema: 'regent.evidence/v1', dataset: ws.dataset, evidence: ws.bundle }, null, 2))
      case 'events.csv':
        return attachment(c, 'regent-actions.csv', 'text/csv; charset=utf-8', actionsCsv(ws.run))
      default:
        throw new HttpError(404, 'NOT_FOUND', 'Unknown export.')
    }
  })

  app.get('/api/audit-log', requireRole('admin'), async (c) => {
    const u = currentUser(c)
    const rows = await db.query('SELECT id, user_id, action, target, detail, request_id, created_at FROM audit_log WHERE organization_id = $1 ORDER BY id DESC LIMIT 200', [u.organization_id])
    return c.json({ entries: rows })
  })

  app.all('/api/*', () => {
    throw new HttpError(404, 'NOT_FOUND', 'No such endpoint.')
  })

  // ---------------------------------------------------------- static web app
  if (config.production) serveStatic(app, config.webDist)

  return app
}

function rank(h: string): number {
  return h === 'violated' ? 3 : h === 'incomplete' ? 2 : h === 'unknown' ? 1 : 0
}

function facets(ws: Workspace) {
  const n = nameIndex(ws.bundle)
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()
  return {
    actors: uniq(ws.bundle.actions.map((a) => a.actor_principal_id)).map((id) => ({ id, name: n.p(id) })),
    roots: uniq(ws.run.actions.map((a) => a.chain.root_principal_id)).map((id) => ({ id, name: n.p(id) })),
    resources: uniq(ws.bundle.actions.map((a) => a.resource_id)).map((id) => ({ id, name: n.r(id) })),
    tools: uniq(ws.bundle.actions.map((a) => a.tool_id)).map((id) => ({ id, name: n.t(id) })),
    policies: uniq(ws.bundle.actions.map((a) => a.policy_id)),
  }
}

function evidenceRecord(ws: Workspace, kind: string, id: string): unknown {
  switch (kind) {
    case 'action': return ws.bundle.actions.find((x) => x.action_id === id) ?? null
    case 'delegation': return ws.bundle.delegations.find((x) => x.delegation_id === id) ?? null
    case 'principal': return ws.bundle.principals.find((x) => x.principal_id === id) ?? null
    case 'execution_identity': return ws.bundle.execution_identities.find((x) => x.execution_identity_id === id) ?? null
    case 'credential': return ws.bundle.credentials.find((x) => x.credential_id === id) ?? null
    case 'tool': return ws.bundle.tools.find((x) => x.tool_id === id) ?? null
    case 'resource': return ws.bundle.resources.find((x) => x.resource_id === id) ?? null
    case 'policy': return ws.bundle.policies.find((x) => `${x.policy_id}@${x.policy_version}` === id) ?? null
    default: return null
  }
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
}

function canonicalPretty(v: unknown): string {
  return JSON.stringify(JSON.parse(canonicalJson(v)), null, 2)
}

function attachment(c: Context<Env>, filename: string, type: string, content: string | Buffer) {
  c.header('Content-Type', type)
  c.header('Content-Disposition', `attachment; filename="${safeName(filename)}"`)
  return c.body(typeof content === 'string' ? content : new Uint8Array(content))
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
}

/** Serve the built SPA. Paths are resolved inside dist only; anything else falls back to index.html. */
function serveStatic(app: Hono<Env>, dist: string) {
  const root = normalize(dist + sep)
  app.get('*', (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname)
    const target = normalize(join(root, rel))
    const inside = target.startsWith(root)
    const file = inside && existsSync(target) && statSync(target).isFile() ? target : join(root, 'index.html')
    if (!existsSync(file)) return c.text('Web build not found. Run npm run build.', 503)
    const ext = extname(file)
    c.header('Content-Type', MIME[ext] ?? 'application/octet-stream')
    c.header('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
    return c.body(new Uint8Array(readFileSync(file)))
  })
}


export type { Role }
