import { loadConfig } from '../config.ts'
import { openDb } from './driver.ts'
import { migrate } from './migrate.ts'

const config = loadConfig()
const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir, memory: false })
const ran = await migrate(db)
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'database is up to date')
await db.close()
