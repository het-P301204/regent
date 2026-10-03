import { randomUUID } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Config } from './config.ts'
import type { Db } from './db/driver.ts'
import { resolveApiToken, resolveSession, ROLE_RANK } from './auth.ts'
import type { Principal, Role } from './auth.ts'

export type Env = { Variables: { requestId: string; user: Principal | null; started: number; operation: string } }

export const SESSION_COOKIE = 'regent_session'
export const CSRF_COOKIE = 'regent_csrf'
export const CSRF_HEADER = 'x-regent-csrf'

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Structured JSON logging. Never logs bodies, cookies, tokens or credentials. */
export function logger(config: Config) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const
  return (level: 'debug' | 'info' | 'warn' | 'error', fields: Record<string, unknown>) => {
    if (levels[level] < levels[config.logLevel]) return
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service: 'regent-api', ...fields })
    if (level === 'error') console.error(line)
    else console.log(line)
  }
}

export function requestContext(log: ReturnType<typeof logger>): MiddlewareHandler<Env> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id')
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    c.set('requestId', requestId)
    c.set('started', performance.now())
    c.set('user', null)
    c.set('operation', `${c.req.method} ${c.req.routePath ?? c.req.path}`)
    await next()
    c.header('x-request-id', requestId)
    const user = c.get('user')
    log(c.res.status >= 500 ? 'error' : 'info', {
      request_id: requestId,
      user_id: user?.user_id ?? null,
      organization_id: user?.organization_id ?? null,
      operation: `${c.req.method} ${c.req.routePath}`,
      duration_ms: Math.round(performance.now() - c.get('started')),
      result: c.res.status,
    })
  }
}

export function secureHeaders(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next()
    c.header('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '))
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    if (config.production) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
  }
}

/**
 * Strict CORS: only configured origins get CORS headers, and only for
 * credentialed same-site use. Unknown origins get no CORS headers at all, so
 * the browser blocks the read.
 */
export function cors(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origin = c.req.header('origin')
    const allowed = origin && config.allowedOrigins.includes(origin)
    if (c.req.method === 'OPTIONS') {
      if (!allowed) return c.body(null, 204)
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
      c.header('Access-Control-Allow-Headers', `content-type, ${CSRF_HEADER}, x-request-id, authorization`)
      c.header('Access-Control-Max-Age', '600')
      c.header('Vary', 'Origin')
      return c.body(null, 204)
    }
    await next()
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }
  }
}

/** Fixed-window rate limiter keyed by client address and bucket. In-memory: one API instance. */
export function rateLimit(bucket: string, limit: number, windowMs: number): MiddlewareHandler<Env> {
  const hits = new Map<string, { count: number; reset: number }>()
  return async (c, next) => {
    const now = Date.now()
    const key = `${bucket}:${clientAddress(c)}`
    let h = hits.get(key)
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs }
      hits.set(key, h)
    }
    h.count++
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(Math.max(0, limit - h.count)))
    if (h.count > limit) {
      c.header('Retry-After', String(Math.ceil((h.reset - now) / 1000)))
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.')
    }
    await next()
  }
}

function clientAddress(c: Context<Env>): string {
  // Only trust X-Forwarded-For when explicitly deployed behind a proxy that sets it.
  if (process.env['REGENT_TRUST_PROXY'] === 'true') {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (fwd) return fwd
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? 'local'
}

/** Resolve the caller from a session cookie or a bearer API token. */
export function authenticate(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = c.req.header('authorization')
    let user: Principal | null = null
    if (auth?.startsWith('Bearer ')) {
      user = await resolveApiToken(db, auth.slice(7).trim())
      if (!user) throw new HttpError(401, 'INVALID_TOKEN', 'The API token is invalid or revoked.')
    } else {
      const token = getCookie(c, SESSION_COOKIE)
      if (token) user = await resolveSession(db, token)
    }
    c.set('user', user)
    await next()
  }
}

/**
 * CSRF for cookie-authenticated mutations: the request must echo the session's
 * CSRF token in a header (double submit), and a present Origin must be allowed
 * or same-origin. Bearer-token requests carry no ambient credentials and skip it.
 */
export function csrf(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    const method = c.req.method
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
    const user = c.get('user')
    const origin = c.req.header('origin')
    if (origin) {
      const self = new URL(c.req.url).origin
      if (origin !== self && !config.allowedOrigins.includes(origin)) throw new HttpError(403, 'ORIGIN_REJECTED', 'Cross-origin request rejected.')
    }
    if (user?.via === 'session') {
      const header = c.req.header(CSRF_HEADER)
      if (!header || header !== user.csrf_token) throw new HttpError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.')
    }
    await next()
  }
}

export function requireRole(min: Role): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    if (ROLE_RANK[user.role] < ROLE_RANK[min]) throw new HttpError(403, 'FORBIDDEN', `This action requires the ${min} role.`)
    await next()
  }
}

export function currentUser(c: Context<Env>): Principal {
  const u = c.get('user')
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  return u
}
