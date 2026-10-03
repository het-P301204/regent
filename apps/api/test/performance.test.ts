import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { bootstrap } from '../src/bootstrap.ts'
import { loadConfig } from '../src/config.ts'
import { openDb } from '../src/db/driver.ts'
import type { Db } from '../src/db/driver.ts'
import { migrate } from '../src/db/migrate.ts'
import { WorkspaceService } from '../src/services/workspace.ts'

/**
 * Regression test for a denial-of-service finding: one large dataset (15k
 * actions sharing the same findings) used to make every view quadratic and
 * stall the single event loop for ~30 s. Each view must now answer quickly.
 */
let db: Db
let app: ReturnType<typeof createApp>
let cookie = ''

beforeAll(async () => {
  const config = { ...loadConfig({ REGENT_LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv, []), memory: true }
  db = await openDb({ url: null, dataDir: '', memory: true })
  await migrate(db)
  const workspace = new WorkspaceService(db)
  await bootstrap(db, config, workspace)
  const records = Array.from({ length: 15_000 }, (_, i) => ({ event_id: `e${i}`, actor_principal_id: 'agent-x', timestamp: '2026-10-03T10:00:00Z', exercised_scope: ['a.b'] }))
  const ds = await workspace.createDataset('org_acme', 'usr_demo_analyst', { name: 'big', source: 'import', metadata: {}, records })
  await db.query('UPDATE users SET active_dataset_id = $1 WHERE id = $2', [ds.dataset.id, 'usr_demo_analyst'])
  app = createApp({ db, config, workspace })
  const res = await app.request('http://regent.test/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona: 'analyst' }) })
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function timed(path: string) {
  const t = performance.now()
  const res = await app.request(`http://regent.test${path}`, { headers: { cookie } })
  expect(res.status, path).toBe(200)
  await res.arrayBuffer()
  return performance.now() - t
}

describe('large dataset stays responsive', () => {
  it.each(['/api/overview', '/api/chains?limit=1', '/api/findings', '/api/identities', '/api/credentials', '/api/delegations'])('%s answers in under 3 s', async (path) => {
    await timed(path) // warm the per-run cache
    expect(await timed(path)).toBeLessThan(3000)
  })
  it('a finding shared by 15k actions opens quickly and reports the exact total', async () => {
    const orphan = await app.request('http://regent.test/api/findings?type=UNKNOWN_REFERENCE', { headers: { cookie } })
    const f = ((await orphan.json()) as { findings: { finding_id: string }[] }).findings[0]!
    const t = performance.now()
    const res = await app.request(`http://regent.test/api/findings/${f.finding_id}`, { headers: { cookie } })
    const body = (await res.json()) as { related_total: number; related_actions: unknown[] }
    expect(performance.now() - t).toBeLessThan(3000)
    expect(body.related_total).toBe(15_000)
    expect(body.related_actions.length).toBeLessThanOrEqual(200)
  })
})
