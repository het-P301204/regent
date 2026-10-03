import { resolve } from 'node:path'

/**
 * Configuration comes only from the environment. There are no secrets in the
 * repository: REGENT needs no signing key (sessions are random tokens stored as
 * hashes), and the only credential is DATABASE_URL in production.
 */
export interface Config {
  production: boolean
  port: number
  host: string
  /** postgres://... in production; unset means an embedded PGlite database in dataDir. */
  databaseUrl: string | null
  dataDir: string
  /** In-memory database (tests). */
  memory: boolean
  demoMode: boolean
  cookieSecure: boolean
  allowedOrigins: string[]
  maxImportBytes: number
  sessionHours: number
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent'
  webDist: string
  /** Optional bootstrap admin. Never defaulted. */
  adminEmail: string | null
  adminPassword: string | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Config {
  const production = argv.includes('--production') || env['NODE_ENV'] === 'production'
  const port = Number(env['PORT'] ?? 8787)
  const origins = (env['REGENT_ALLOWED_ORIGINS'] ?? (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    production,
    port,
    host: env['HOST'] ?? (production ? '0.0.0.0' : '127.0.0.1'),
    databaseUrl: env['DATABASE_URL'] || null,
    dataDir: resolve(env['REGENT_DATA_DIR'] ?? '.data/pglite'),
    memory: env['REGENT_DB'] === 'memory',
    demoMode: (env['REGENT_DEMO_MODE'] ?? 'true') !== 'false',
    cookieSecure: env['REGENT_COOKIE_SECURE'] ? env['REGENT_COOKIE_SECURE'] === 'true' : production,
    allowedOrigins: origins,
    maxImportBytes: Number(env['REGENT_MAX_IMPORT_BYTES'] ?? 5 * 1024 * 1024),
    sessionHours: Number(env['REGENT_SESSION_HOURS'] ?? 8),
    logLevel: (env['REGENT_LOG_LEVEL'] as Config['logLevel']) ?? 'info',
    webDist: resolve(env['REGENT_WEB_DIST'] ?? 'apps/web/dist'),
    adminEmail: env['REGENT_ADMIN_EMAIL'] || null,
    adminPassword: env['REGENT_ADMIN_PASSWORD'] || null,
  }
}
