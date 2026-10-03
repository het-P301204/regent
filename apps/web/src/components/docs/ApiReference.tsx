import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { TextInput, cx } from '../../ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../ui/feedback'

interface OpenApiOperation {
  summary?: string
  description?: string
  tags?: string[]
  'x-regent-min-role'?: string
  parameters?: { name: string; in: string; required?: boolean; description?: string }[]
  requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> }
}
interface OpenApiDoc {
  info?: { title?: string; version?: string }
  tags?: { name: string }[]
  paths?: Record<string, Record<string, OpenApiOperation>>
}

interface Endpoint {
  method: string
  path: string
  op: OpenApiOperation
  tag: string
}

/** Methods are not states, so they get no state colour: reads are quieter than writes, nothing more. */
const METHOD_TONE: Record<string, string> = {
  get: 'text-ink-3 border-[rgb(var(--line-strong)/0.16)]',
  post: 'text-ink border-[rgb(var(--line-strong)/0.32)]',
  put: 'text-ink border-[rgb(var(--line-strong)/0.32)]',
  patch: 'text-ink border-[rgb(var(--line-strong)/0.32)]',
  delete: 'text-ink border-[rgb(var(--line-strong)/0.32)] bg-s3',
}

const ROLE_LABEL: Record<string, string> = { none: 'public', viewer: 'viewer', auditor: 'auditor', analyst: 'analyst', admin: 'admin' }

/** Renders the live OpenAPI document served by the API. Public: needs no session. */
export function ApiReference() {
  const q = useQuery({ queryKey: ['openapi'], queryFn: () => api.get<OpenApiDoc>('/api/openapi.json'), staleTime: 5 * 60_000 })
  const [filter, setFilter] = useState('')

  const groups = useMemo(() => {
    const doc = q.data
    if (!doc?.paths) return []
    const endpoints: Endpoint[] = []
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        endpoints.push({ method, path, op, tag: op.tags?.[0] ?? 'other' })
      }
    }
    const needle = filter.trim().toLowerCase()
    const shown = needle ? endpoints.filter((e) => `${e.method} ${e.path} ${e.op.summary ?? ''} ${e.tag}`.toLowerCase().includes(needle)) : endpoints
    const order = (doc.tags ?? []).map((t) => t.name)
    const tags = [...new Set([...order, ...shown.map((e) => e.tag)])]
    return tags.map((tag) => ({ tag, endpoints: shown.filter((e) => e.tag === tag) })).filter((g) => g.endpoints.length > 0)
  }, [q.data, filter])

  if (q.isLoading) return <LoadingState label="Loading API description" className="min-h-[180px]" />
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />
  if (!q.data?.paths || Object.keys(q.data.paths).length === 0) {
    return <EmptyState title="The API description is empty" body="The server returned an OpenAPI document with no paths. Check that the API is the same version as this console." />
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <TextInput label="Filter endpoints" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="chains, POST, grc …" className="sm:w-72" />
        <p className="font-mono text-[11px] text-ink-3">
          {q.data.info?.title ?? 'REGENT API'} {q.data.info?.version ? `v${q.data.info.version}` : ''} ·{' '}
          <a href="/api/openapi.json" className="text-copper-ink underline-offset-2 hover:underline">
            /api/openapi.json
          </a>
        </p>
      </div>
      {groups.length === 0 ? (
        <EmptyState title="No endpoints match" body={`Nothing matches "${filter}".`} action={<button type="button" onClick={() => setFilter('')} className="text-[12.5px] text-copper-ink underline underline-offset-2">Clear the filter</button>} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.tag} aria-labelledby={`api-tag-${g.tag}`}>
              <h4 id={`api-tag-${g.tag}`} className="eyebrow mb-2">
                {g.tag}
              </h4>
              <div className="overflow-x-auto rounded border hairline">
                <table className="w-full min-w-[560px] border-collapse text-left text-[12.5px]">
                  <caption className="sr-only">{g.tag} endpoints: method, path, summary and minimum role</caption>
                  <thead>
                    <tr className="border-b hairline-strong bg-s1">
                      <th scope="col" className="eyebrow w-[72px] px-3 py-2 font-normal">Method</th>
                      <th scope="col" className="eyebrow px-3 py-2 font-normal">Path</th>
                      <th scope="col" className="eyebrow px-3 py-2 font-normal">Summary</th>
                      <th scope="col" className="eyebrow w-[84px] px-3 py-2 font-normal">Min role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.endpoints.map((e) => {
                      const role = e.op['x-regent-min-role'] ?? 'viewer'
                      const params = e.op.parameters ?? []
                      const body = e.op.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop()
                      return (
                        <tr key={`${e.method} ${e.path}`} className="border-b hairline align-top last:border-b-0">
                          <td className="px-3 py-2">
                            <span className={cx('inline-flex h-[18px] items-center rounded-[3px] border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]', METHOD_TONE[e.method] ?? METHOD_TONE['get'])}>{e.method}</span>
                          </td>
                          <th scope="row" className="px-3 py-2 text-left font-normal">
                            <code className="font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{e.path}</code>
                          </th>
                          <td className="px-3 py-2 text-ink-2">
                            {e.op.summary}
                            {e.op.description ? <span className="mt-0.5 block text-[11.5px] text-ink-3">{e.op.description}</span> : null}
                            {params.length > 0 || body ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer select-none text-[11.5px] text-copper-ink">Parameters{body ? ' and body' : ''}</summary>
                                <ul className="mt-1 flex flex-col gap-0.5">
                                  {params.map((p) => (
                                    <li key={`${p.in}:${p.name}`} className="text-[11.5px] text-ink-3">
                                      <code className="font-mono text-ink-2">{p.name}</code> <span className="font-mono">({p.in}{p.required ? ', required' : ''})</span> {p.description}
                                    </li>
                                  ))}
                                  {body ? (
                                    <li className="text-[11.5px] text-ink-3">
                                      JSON body: <code className="font-mono text-ink-2">{body}</code>
                                    </li>
                                  ) : null}
                                </ul>
                              </details>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-ink-2">{ROLE_LABEL[role] ?? role}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
