import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

/**
 * One interface over two PostgreSQL engines:
 *   - PGlite: real PostgreSQL compiled to WASM, in-process. Used for local
 *     development and tests, so nothing needs Docker to run.
 *   - node-postgres: a real PostgreSQL server, used in Docker Compose and production.
 * All SQL is written once and parameterized ($1, $2, ...). No string-built queries.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
  readonly kind: 'pglite' | 'postgres'
}

export async function openDb(opts: { url: string | null; dataDir: string; memory: boolean; poolMax?: number }): Promise<Db> {
  if (opts.url) return openPostgres(opts.url, opts.poolMax ?? Number(process.env['REGENT_DB_POOL_MAX'] ?? 10))
  const lite = opts.memory ? new PGlite() : new PGlite(opts.dataDir)
  await lite.waitReady
  return wrapLite(lite)
}

function wrapLite(lite: PGlite | Parameters<Parameters<PGlite['transaction']>[0]>[0]): Db {
  const db: Db = {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await lite.query<T>(sql, params)
      return r.rows
    },
    async exec(sql: string) {
      await lite.exec(sql)
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!('transaction' in lite)) return fn(db)
      return (lite as PGlite).transaction(async (tx) => fn(wrapLite(tx)))
    },
    async close() {
      if ('close' in lite) await (lite as PGlite).close()
    },
  }
  return db
}

async function openPostgres(url: string, max: number): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max, statement_timeout: 30_000 })
  await pool.query('select 1')
  const conn = (client: pg.PoolClient): Db => ({
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[]
    },
    async exec(sql: string) {
      await client.query(sql)
    },
    // Already inside a transaction: nested calls run on the same connection.
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return fn(conn(client))
    },
    async close() {},
  })
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[]
    },
    async exec(sql: string) {
      await pool.query(sql)
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn(conn(client))
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}
