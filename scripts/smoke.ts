/**
 * Post-deployment smoke test. Exercises the live API the way a person would:
 * health, demo sign-in, overview, chains, findings, a scenario, a PDF report.
 *
 *   node scripts/smoke.ts http://127.0.0.1:8787
 *   node scripts/smoke.ts https://regent.example.com
 *
 * Exits non-zero on the first failed check. Requires REGENT_DEMO_MODE=true on
 * the target, or REGENT_SMOKE_TOKEN set to an API token (Bearer) for it.
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const token = process.env['REGENT_SMOKE_TOKEN']
let cookie = ''
let csrf = ''
let failed = false

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['authorization'] = `Bearer ${token}`
  else {
    if (cookie) headers['cookie'] = cookie
    if (method !== 'GET' && csrf) headers['x-regent-csrf'] = csrf
    headers['origin'] = base
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  return res
}

async function check(name: string, fn: () => Promise<string>) {
  const t = performance.now()
  try {
    const detail = await fn()
    console.log(`  ok    ${name.padEnd(34)} ${Math.round(performance.now() - t)}ms  ${detail}`)
  } catch (e) {
    failed = true
    console.log(`  FAIL  ${name.padEnd(34)} ${(e as Error).message}`)
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

console.log(`REGENT smoke test → ${base}`)
await check('health', async () => {
  const r = await call('GET', '/api/health')
  const j = (await r.json()) as { status: string; database_engine: string }
  assert(r.ok && j.status === 'ok', `health ${r.status}`)
  assert(r.headers.get('content-security-policy'), 'missing CSP header')
  return `database ${j.database_engine}`
})
if (!token) {
  await check('demo sign-in (analyst)', async () => {
    const r = await call('POST', '/api/auth/demo', { persona: 'analyst' })
    assert(r.ok, `status ${r.status} — is REGENT_DEMO_MODE on?`)
    csrf = ((await r.json()) as { csrf_token: string }).csrf_token
    return 'session issued'
  })
}
await check('reset to demo dataset', async () => {
  const r = await call('POST', '/api/datasets/reset-demo')
  assert(r.ok, `status ${r.status}`)
  return 'active'
})
await check('overview', async () => {
  const r = await call('GET', '/api/overview')
  const j = (await r.json()) as { metrics: { total_actions: number; authority_violations: number } }
  assert(r.ok && j.metrics.total_actions > 0, 'no actions')
  return `${j.metrics.total_actions} actions, ${j.metrics.authority_violations} violations`
})
await check('chains + chain detail', async () => {
  const r = await call('GET', '/api/chains?health=violated&limit=1')
  const j = (await r.json()) as { rows: { action_id: string }[] }
  assert(j.rows[0], 'no violated chain')
  const d = await call('GET', `/api/chains/${encodeURIComponent(j.rows[0].action_id)}`)
  assert(d.ok, `detail ${d.status}`)
  return j.rows[0].action_id
})
await check('findings', async () => {
  const r = await call('GET', '/api/findings')
  const j = (await r.json()) as { total: number }
  assert(r.ok && j.total > 0, 'no findings')
  return `${j.total} findings`
})
await check('scenario: authority amplification', async () => {
  const r = await call('POST', '/api/scenarios', { slug: 'authority-amplification' })
  const j = (await r.json()) as { matches_expected: boolean }
  assert(r.ok && j.matches_expected, 'scenario did not produce its expected findings')
  await call('POST', '/api/datasets/reset-demo')
  return 'expected findings produced'
})
await check('security report PDF', async () => {
  if (!token) {
    const r0 = await call('POST', '/api/auth/demo', { persona: 'auditor' })
    csrf = ((await r0.json()) as { csrf_token: string }).csrf_token
  }
  const r = await call('GET', '/api/reports/security.pdf')
  const buf = Buffer.from(await r.arrayBuffer())
  assert(r.ok && buf.subarray(0, 5).toString() === '%PDF-', 'not a PDF')
  return `${Math.round(buf.length / 1024)} KB`
})
await check('console served', async () => {
  const r = await fetch(`${base}/app`)
  const html = await r.text()
  assert(r.ok && html.includes('REGENT'), `status ${r.status}`)
  return 'index.html'
})
console.log(failed ? '\nsmoke test FAILED' : '\nsmoke test passed')
process.exit(failed ? 1 : 0)
