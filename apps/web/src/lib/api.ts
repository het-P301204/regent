/**
 * The only way the console talks to REGENT. Same-origin, cookie session, and
 * the CSRF token echoed on every mutation. Errors arrive as ApiError with the
 * server's code and request id, never as raw stack traces.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly details: unknown
  constructor(status: number, code: string, message: string, requestId: string | null, details: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

let csrfToken: string | null = null
export function setCsrf(token: string | null) {
  csrfToken = token
}

function readCookie(name: string): string | null {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') {
    const t = csrfToken ?? readCookie('regent_csrf')
    if (t) headers['x-regent-csrf'] = t
  }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'SERVER_UNAVAILABLE', 'REGENT is not reachable. Check that the API server is running.', null, null)
  }
  const requestId = res.headers.get('x-request-id')
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    if (type.includes('json')) {
      const j = (await res.json()) as { error?: { code: string; message: string; details?: unknown } }
      throw new ApiError(res.status, j.error?.code ?? 'ERROR', j.error?.message ?? res.statusText, requestId, j.error?.details ?? null)
    }
    if (res.status === 502 || res.status === 504) throw new ApiError(res.status, 'SERVER_UNAVAILABLE', 'REGENT is not reachable. Check that the API server is running.', requestId, null)
    throw new ApiError(res.status, res.status === 503 ? 'DATABASE_UNAVAILABLE' : 'ERROR', res.status === 503 ? 'The database is unavailable.' : `Request failed (${res.status}).`, requestId, null)
  }
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/** Trigger a browser download of an API export (cookie-authenticated GET). */
export function download(path: string) {
  const a = document.createElement('a')
  a.href = path
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
