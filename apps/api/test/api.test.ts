import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyze, demoRecords, SCENARIOS } from '@regent/core'
import { createApp } from '../src/app.ts'
import { bootstrap } from '../src/bootstrap.ts'
import { loadConfig } from '../src/config.ts'
import { openDb } from '../src/db/driver.ts'
import type { Db } from '../src/db/driver.ts'
import { migrate } from '../src/db/migrate.ts'
import { DOCUMENTED_PATHS, openApiDocument } from '../src/openapi.ts'
import { WorkspaceService } from '../src/services/workspace.ts'
import { hashPassword } from '../src/auth.ts'

let db: Db
let app: ReturnType<typeof createApp>
const BASE = 'http://regent.test'

class Client {
  cookies = new Map<string, string>()
  csrf: string | null = null
  bearer: string | null = null
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extra }
    if (this.cookies.size) headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (this.csrf && method !== 'GET' && !('x-regent-csrf' in extra)) headers['x-regent-csrf'] = this.csrf
    if (this.bearer) headers['authorization'] = `Bearer ${this.bearer}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await app.request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';')
      const [k, v] = pair!.split('=')
      if (v === '' || /Max-Age=0/i.test(sc)) this.cookies.delete(k!)
      else this.cookies.set(k!, v!)
    }
    return res
  }
  async json(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
    const res = await this.req(method, path, body, extra)
    return { status: res.status, body: (await res.json()) as any }
  }
  async demo(persona: 'admin' | 'analyst' | 'auditor' | 'viewer') {
    const r = await this.json('POST', '/api/auth/demo', { persona })
    this.csrf = r.body.csrf_token
    return this
  }
}

beforeAll(async () => {
  const config = { ...loadConfig({ REGENT_DB: 'memory', REGENT_LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv, []), memory: true }
  db = await openDb({ url: null, dataDir: '', memory: true })
  await migrate(db)
  const workspace = new WorkspaceService(db)
  await bootstrap(db, config, workspace)
  // A second tenant, to prove isolation.
  await db.query("INSERT INTO organizations (id, name, slug) VALUES ('org_other', 'Other Corp', 'other')")
  await db.query("INSERT INTO users (id, organization_id, email, display_name, role, password_hash) VALUES ('usr_other', 'org_other', 'mallory@other.example', 'Mallory', 'admin', $1)", [await hashPassword('correct horse battery staple')])
  app = createApp({ db, config, workspace })
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('system', () => {
  it('reports health without authentication', async () => {
    const r = await new Client().json('GET', '/api/health')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ok', database: 'ok', database_engine: 'pglite' })
  })
  it('sets security headers', async () => {
    const res = await new Client().req('GET', '/api/health')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
  it('routes every documented OpenAPI path', async () => {
    const c = await new Client().demo('admin')
    const doc = openApiDocument()
    for (const path of DOCUMENTED_PATHS) {
      const method = Object.keys(doc.paths[path]!)[0]!.toUpperCase()
      const concrete = path.replace('{id}', 'x').replace('{event}', 'x').replace('{file}', 'findings.json')
      const res = await c.req(method, concrete, method === 'GET' || method === 'DELETE' ? undefined : {})
      const body = res.headers.get('content-type')?.includes('json') ? await res.json() as any : null
      expect(body?.error?.message, path).not.toBe('No such endpoint.')
    }
  })
  it('returns structured errors without stack traces', async () => {
    const c = await new Client().demo('analyst')
    const r = await c.json('POST', '/api/events', '{"name": ', {})
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('INVALID_JSON')
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts:\d+/)
  })
})

describe('authentication and authorization', () => {
  it('rejects unauthenticated access to data', async () => {
    expect((await new Client().json('GET', '/api/overview')).status).toBe(401)
  })
  it('signs in with a password and rejects a wrong one with the same message', async () => {
    const c = new Client()
    const bad = await c.json('POST', '/api/auth/login', { email: 'mallory@other.example', password: 'wrong' })
    const missing = await c.json('POST', '/api/auth/login', { email: 'nobody@other.example', password: 'wrong' })
    expect(bad.status).toBe(401)
    expect(missing.body.error.message).toBe(bad.body.error.message)
    const ok = await c.json('POST', '/api/auth/login', { email: 'mallory@other.example', password: 'correct horse battery staple' })
    expect(ok.status).toBe(200)
    expect(c.cookies.get('regent_session')).toBeTruthy()
  })
  it('requires the CSRF header on cookie-authenticated mutations', async () => {
    const c = await new Client().demo('analyst')
    const r = await c.json('POST', '/api/analyze', undefined, { 'x-regent-csrf': 'wrong' })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('CSRF_TOKEN_INVALID')
  })
  it('rejects mutations from a foreign origin', async () => {
    const c = await new Client().demo('analyst')
    const r = await c.json('POST', '/api/analyze', undefined, { origin: 'https://evil.example' })
    expect(r.body.error.code).toBe('ORIGIN_REJECTED')
  })
  it('enforces roles', async () => {
    const viewer = await new Client().demo('viewer')
    expect((await viewer.json('POST', '/api/events', { name: 'x', content: '[]' })).status).toBe(403)
    expect((await viewer.req('GET', '/api/reports/security.pdf')).status).toBe(403)
    expect((await viewer.json('PUT', '/api/rules/AUTH-001', { enabled: false })).status).toBe(403)
  })
  it('accepts bearer tokens without CSRF', async () => {
    const c = await new Client().demo('analyst')
    const t = await c.json('POST', '/api/tokens', { name: 'ci' })
    expect(t.status).toBe(201)
    const bot = new Client()
    bot.bearer = t.body.token
    expect((await bot.json('GET', '/api/findings')).status).toBe(200)
    expect((await bot.json('POST', '/api/analyze')).status).toBe(200)
    const bad = new Client()
    bad.bearer = 'rgt_not-a-token'
    expect((await bad.json('GET', '/api/findings')).status).toBe(401)
  })
})

describe('tenant isolation', () => {
  it("cannot read or activate another organization's dataset", async () => {
    const acme = await new Client().demo('analyst')
    const acmeDataset = (await acme.json('GET', '/api/datasets')).body.active_dataset_id as string
    const other = new Client()
    const login = await other.json('POST', '/api/auth/login', { email: 'mallory@other.example', password: 'correct horse battery staple' })
    other.csrf = login.body.csrf_token
    expect((await other.json('POST', `/api/datasets/${acmeDataset}/activate`)).status).toBe(404)
    expect((await other.json('GET', `/api/overview?dataset=${acmeDataset}`)).status).toBe(404)
    expect((await other.json('GET', '/api/datasets')).body.datasets).toEqual([])
  })
})

describe('ingestion and verification', () => {
  it('stores evidence relationally and re-verifies it to the same digest as the engine', async () => {
    const c = await new Client().demo('analyst')
    const text = JSON.stringify(demoRecords())
    const r = await c.json('POST', '/api/events', { name: 'Demo re-import', filename: 'demo.json', content: text })
    expect(r.status).toBe(201)
    const direct = analyze(text).run
    const runs = await c.json('GET', '/api/runs')
    expect(runs.body.runs[0].input_digest).toBe(direct.input_digest)
    const findings = await c.json('GET', '/api/findings')
    expect(findings.body.findings.map((f: any) => f.finding_id)).toEqual(direct.findings.map((f) => f.finding_id))
  })
  it('validates before storing and reports rejected records', async () => {
    const c = await new Client().demo('analyst')
    const text = readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'adversarial', 'malformed-events.json'), 'utf8')
    const v = await c.json('POST', '/api/events/validate', { name: 'bad', content: text })
    expect(v.status).toBe(200)
    expect(v.body.stats.records_rejected).toBeGreaterThan(0)
    const nothing = await c.json('POST', '/api/events', { name: 'nothing', content: '[{"record_type":"shell"}]' })
    expect(nothing.status).toBe(422)
  })
  it('keeps imported data separate from the demo and can reset to it', async () => {
    const c = await new Client().demo('analyst')
    const imp = await c.json('POST', '/api/events', { name: 'Tiny', content: JSON.stringify(SCENARIOS[0]!.records) })
    const ov = await c.json('GET', '/api/overview')
    expect(ov.body.dataset.id).toBe(imp.body.dataset.id)
    expect(ov.body.dataset.source).toBe('import')
    expect(ov.body.metrics.total_actions).toBe(1)
    await c.json('POST', '/api/datasets/reset-demo')
    const back = await c.json('GET', '/api/overview')
    expect(back.body.dataset.source).toBe('demo')
  })
  it('rejects oversized imports', async () => {
    const c = await new Client().demo('analyst')
    const r = await c.json('POST', '/api/events', { name: 'big', content: 'x'.repeat(6 * 1024 * 1024) })
    expect(r.status).toBe(413)
  })
  it('loads every scenario and produces exactly its expected findings', async () => {
    const c = await new Client().demo('viewer')
    for (const s of SCENARIOS) {
      const r = await c.json('POST', '/api/scenarios', { slug: s.slug })
      expect(r.status, s.slug).toBe(201)
      expect(r.body.matches_expected, s.slug).toBe(true)
    }
  })
})

describe('chains, findings and triage', () => {
  it('serves chain detail with explanation and replay', async () => {
    const c = await new Client().demo('viewer')
    await c.json('POST', '/api/datasets/reset-demo')
    const d = await c.json('GET', '/api/chains/evt-0042')
    expect(d.status).toBe(200)
    expect(d.body.verification.derived_decision).toBe('DENY')
    expect(d.body.explanation.question).toBe('Why is this a finding?')
    expect(d.body.replay.violation_index).not.toBeNull()
  })
  it('filters chains', async () => {
    const c = await new Client().demo('viewer')
    const all = await c.json('GET', '/api/chains')
    const violated = await c.json('GET', '/api/chains?health=violated')
    expect(violated.body.total).toBeLessThan(all.body.total)
    expect(violated.body.rows.every((r: any) => r.health === 'violated')).toBe(true)
  })
  it('requires a note to suppress, and triage survives a re-run', async () => {
    const c = await new Client().demo('analyst')
    await c.json('POST', '/api/datasets/reset-demo')
    const f = (await c.json('GET', '/api/findings')).body.findings[0]
    expect((await c.json('PATCH', `/api/findings/${f.finding_id}`, { status: 'SUPPRESSED' })).status).toBe(400)
    expect((await c.json('PATCH', `/api/findings/${f.finding_id}`, { status: 'INVESTIGATING', note: 'looking' })).status).toBe(200)
    await c.json('POST', '/api/analyze')
    const again = await c.json('GET', `/api/findings/${f.finding_id}`)
    expect(again.body.finding.status).toBe('INVESTIGATING')
  })
  it('disabling a rule removes its findings on the next run and reports the check as skipped', async () => {
    const admin = await new Client().demo('admin')
    await admin.json('POST', '/api/datasets/reset-demo')
    expect((await admin.json('PUT', '/api/rules/AUTH-008', { enabled: false })).status).toBe(200)
    await admin.json('POST', '/api/analyze')
    const f = await admin.json('GET', '/api/findings?type=MISSING_APPROVAL')
    expect(f.body.total).toBe(0)
    const chain = await admin.json('GET', '/api/chains')
    expect(chain.body.rows.every((r: any) => r.checks.approval === 'SKIPPED')).toBe(true)
    await admin.json('POST', '/api/rules/reset')
    await admin.json('POST', '/api/analyze')
    expect((await admin.json('GET', '/api/findings?type=MISSING_APPROVAL')).body.total).toBeGreaterThan(0)
  })
})

describe('builder, analysis views and exports', () => {
  it('verifies a built chain and finds amplification', async () => {
    const c = await new Client().demo('viewer')
    const r = await c.json('POST', '/api/builder/verify', {
      principals: [{ id: 'h', type: 'human', name: 'Ada', scope: ['doc.read'] }, { id: 'a', type: 'agent', name: 'Agent' }],
      delegations: [{ from: 'h', to: 'a', granted: ['doc.read'] }],
      actions: [{ actor: 'a', tool: 'DocTool', resource: 'Docs', requested: ['doc.read'], exercised: ['doc.read', 'doc.delete'] }],
    })
    expect(r.status).toBe(200)
    expect(r.body.run.findings.map((f: any) => f.type)).toContain('AUTHORITY_AMPLIFICATION')
  })
  it('rejects a malformed ChainSpec', async () => {
    const c = await new Client().demo('viewer')
    const r = await c.json('POST', '/api/builder/verify', { principals: [{ id: '../x', type: 'root', name: '' }], delegations: [], actions: [] })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('VALIDATION_FAILED')
  })
  it('serves time travel, diff, investigation, controls and search', async () => {
    const c = await new Client().demo('auditor')
    await c.json('POST', '/api/datasets/reset-demo')
    expect((await c.json('GET', '/api/time-travel?at=2026-10-03T14:30:00Z')).body.holders.length).toBeGreaterThan(0)
    expect((await c.json('GET', '/api/diff?left=evt-0015&right=evt-0042')).body.entries.length).toBeGreaterThan(0)
    expect((await c.json('GET', '/api/investigations/evt-0042')).body.root_principal_id).toBe('human-maya')
    expect((await c.json('GET', '/api/grc/controls')).body.controls).toHaveLength(7)
    const s = await c.json('GET', '/api/search?q=recon')
    expect(s.body.results.some((r: any) => r.label === 'ReconciliationAgent')).toBe(true)
  })
  it('exports JSON, CSV and PDF', async () => {
    const c = await new Client().demo('auditor')
    const json = await c.req('GET', '/api/exports/findings.json')
    expect(((await json.json()) as any).findings[0].schema).toBe('regent.finding/v1')
    const csv = await c.req('GET', '/api/exports/findings.csv')
    expect(await csv.text()).toMatch(/^finding_id,type,rule_id/)
    const pdf = await c.req('GET', '/api/reports/security.pdf')
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    const inv = await c.req('GET', '/api/reports/investigation/evt-0042.pdf')
    expect(inv.status).toBe(200)
    const pkg = await c.req('GET', '/api/grc/evidence-package')
    expect(((await pkg.json()) as any).schema).toBe('regent.evidence-package/v1')
  })
  it("records REGENT's own audit log", async () => {
    const admin = await new Client().demo('admin')
    const log = await admin.json('GET', '/api/audit-log')
    expect(log.body.entries.some((e: any) => e.action === 'export')).toBe(true)
  })
})

// Last: it exhausts the shared sign-in bucket for this process.
describe('rate limiting', () => {
  it('rate limits sign-in', async () => {
    const c = new Client()
    let limited = false
    for (let i = 0; i < 15; i++) if ((await c.json('POST', '/api/auth/login', { email: 'x@y.example', password: 'z' })).status === 429) limited = true
    expect(limited).toBe(true)
  })
})
