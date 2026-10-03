import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Db } from './db/driver.ts'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

export type Role = 'viewer' | 'auditor' | 'analyst' | 'admin'
export const ROLE_RANK: Record<Role, number> = { viewer: 0, auditor: 1, analyst: 2, admin: 3 }

export interface Principal {
  user_id: string
  organization_id: string
  email: string
  display_name: string
  role: Role
  is_demo_persona: boolean
  active_dataset_id: string | null
  via: 'session' | 'token'
  csrf_token: string | null
}

const N = 16384
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string]
  const expected = Buffer.from(keyB64, 'base64')
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export async function createSession(db: Db, userId: string, org: string, hours: number): Promise<{ token: string; csrf: string; expires: Date }> {
  const token = newToken()
  const csrf = newToken(24)
  const expires = new Date(Date.now() + hours * 3600_000)
  await db.query('INSERT INTO sessions (token_hash, user_id, organization_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5)', [tokenHash(token), userId, org, csrf, expires.toISOString()])
  return { token, csrf, expires }
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)])
}

type UserRow = { id: string; organization_id: string; email: string; display_name: string; role: Role; is_demo_persona: boolean; active_dataset_id: string | null }

export async function resolveSession(db: Db, token: string): Promise<Principal | null> {
  const rows = await db.query<UserRow & { csrf_token: string }>(
    `SELECT u.id, u.organization_id, u.email, u.display_name, u.role, u.is_demo_persona, u.active_dataset_id, s.csrf_token
       FROM sessions s JOIN users u ON u.id = s.user_id AND u.organization_id = s.organization_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)])
  const u = rows[0]
  if (!u) return null
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash(token)])
  return { user_id: u.id, organization_id: u.organization_id, email: u.email, display_name: u.display_name, role: u.role, is_demo_persona: u.is_demo_persona, active_dataset_id: u.active_dataset_id, via: 'session', csrf_token: u.csrf_token }
}

export async function resolveApiToken(db: Db, token: string): Promise<Principal | null> {
  const rows = await db.query<UserRow>(
    `SELECT u.id, u.organization_id, u.email, u.display_name, u.role, u.is_demo_persona, u.active_dataset_id
       FROM api_tokens t JOIN users u ON u.id = t.user_id AND u.organization_id = t.organization_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`, [tokenHash(token)])
  const u = rows[0]
  if (!u) return null
  await db.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1', [tokenHash(token)])
  return { user_id: u.id, organization_id: u.organization_id, email: u.email, display_name: u.display_name, role: u.role, is_demo_persona: u.is_demo_persona, active_dataset_id: u.active_dataset_id, via: 'token', csrf_token: null }
}

export async function createApiToken(db: Db, user: Principal, name: string): Promise<{ token: string; prefix: string }> {
  const token = `rgt_${newToken()}`
  const prefix = token.slice(0, 10)
  await db.query('INSERT INTO api_tokens (token_hash, token_prefix, user_id, organization_id, name) VALUES ($1, $2, $3, $4, $5)', [tokenHash(token), prefix, user.user_id, user.organization_id, name])
  return { token, prefix }
}
