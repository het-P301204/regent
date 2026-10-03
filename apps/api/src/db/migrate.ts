import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from './driver.ts'

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'database', 'migrations')

/**
 * Applies database/migrations/NNNN_name.sql in order, each in a transaction.
 * A checksum is recorded per migration; an edited, already-applied migration
 * stops startup rather than silently diverging.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const applied = new Map((await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).map((r) => [r.version, r.checksum]))
  const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
  const ran: string[] = []
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const prior = applied.get(file)
    if (prior) {
      if (prior !== checksum) throw new Error(`Migration ${file} was modified after it was applied (checksum mismatch). Add a new migration instead.`)
      continue
    }
    await db.transaction(async (tx) => {
      await tx.exec(sql)
      await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum])
    })
    ran.push(file)
  }
  return ran
}
