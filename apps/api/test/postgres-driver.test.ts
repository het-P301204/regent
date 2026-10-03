import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { demoRecords, analyze } from '@regent/core'
import { openDb } from '../src/db/driver.ts'
import type { Db } from '../src/db/driver.ts'
import { migrate } from '../src/db/migrate.ts'
import { WorkspaceService } from '../src/services/workspace.ts'

/**
 * Exercises the PRODUCTION driver path (node-postgres over the PostgreSQL wire
 * protocol) without a PostgreSQL install: PGlite is served on a local socket
 * and `pg` connects to it exactly as it would to a real server.
 */
let lite: PGlite
let server: PGLiteSocketServer
let db: Db
const PORT = 55432

beforeAll(async () => {
  lite = await PGlite.create()
  server = new PGLiteSocketServer({ db: lite, port: PORT, host: '127.0.0.1' })
  await server.start()
  db = await openDb({ url: `postgres://postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`, dataDir: '', memory: false, poolMax: 1 })
}, 60_000)

afterAll(async () => {
  await db?.close()
  await server?.stop()
  await lite?.close()
})

describe('node-postgres driver over the wire protocol', () => {
  it('reports the postgres engine and applies migrations', async () => {
    expect(db.kind).toBe('postgres')
    const ran = await migrate(db)
    expect(ran).toContain('0001_init.sql')
    expect(await migrate(db)).toEqual([])
  })

  it('round-trips the demo dataset to the same input digest as the engine', async () => {
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ('org_pg', 'PG test', 'pg-test')")
    const ws = new WorkspaceService(db)
    const res = await ws.createDataset('org_pg', null, { name: 'demo', source: 'demo', metadata: {}, records: demoRecords() })
    expect(res.run.input_digest).toBe(analyze(demoRecords()).run.input_digest)
    const loaded = await ws.workspace('org_pg', res.dataset.id)
    expect(loaded?.run.findings.length).toBe(res.run.findings.length)
  })

  it('rolls back a failed transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO organizations (id, name, slug) VALUES ('org_tx', 'tx', 'tx')")
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.query("SELECT id FROM organizations WHERE id = 'org_tx'")).toEqual([])
  })
})
