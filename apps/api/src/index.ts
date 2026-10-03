import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { openDb } from './db/driver.ts'
import { migrate } from './db/migrate.ts'
import { bootstrap } from './bootstrap.ts'
import { createApp } from './app.ts'
import { logger } from './security.ts'
import { WorkspaceService } from './services/workspace.ts'

/**
 * REGENT API server.
 *   node apps/api/src/index.ts                development (Vite serves the UI on :5173)
 *   node apps/api/src/index.ts --production   also serves the built UI from apps/web/dist
 */
const config = loadConfig()
const log = logger(config)
if (!config.databaseUrl && !config.memory) mkdirSync(config.dataDir, { recursive: true })
const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir, memory: config.memory })
const applied = await migrate(db)
if (applied.length) log('info', { operation: 'migrate', result: 'applied', migrations: applied })
const workspace = new WorkspaceService(db)
const { seeded } = await bootstrap(db, config, workspace)
log('info', { operation: 'bootstrap', result: seeded ? 'seeded demo organization' : 'existing data', database_engine: db.kind, demo_mode: config.demoMode })

const app = createApp({ db, config, workspace })
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log('info', { operation: 'listen', result: `http://${config.host}:${info.port}`, production: config.production })
})

const shutdown = async () => {
  server.close()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
