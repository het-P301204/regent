import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useSession } from '../../lib/session'
import { stamp } from '../../lib/format'
import type { FindingStatus, FindingView } from '../../lib/types'
import { Button, Panel, Select } from '../../ui/primitives'
import { FindingStatusBadge } from '../../ui/status'
import { useToast } from '../../ui/feedback'

export const FINDING_STATUSES: { v: FindingStatus; hint: string }[] = [
  { v: 'OPEN', hint: 'Not yet triaged.' },
  { v: 'INVESTIGATING', hint: 'Someone is working on it.' },
  { v: 'ACCEPTED', hint: 'Risk accepted. Requires a note explaining why.' },
  { v: 'RESOLVED', hint: 'The underlying condition has been fixed.' },
  { v: 'SUPPRESSED', hint: 'Excluded from open counts. Requires a note explaining why.' },
]

const NEEDS_NOTE: FindingStatus[] = ['ACCEPTED', 'SUPPRESSED']

/**
 * Triage records what people decided about a finding. It never changes the
 * engine's verdict: a suppressed finding is still detected on the next run.
 */
export function TriagePanel({ finding }: { finding: FindingView }) {
  const { can } = useSession()
  const allowed = can('analyst')
  const qc = useQueryClient()
  const toast = useToast()
  const noteId = useId()
  const hintId = useId()
  const [status, setStatus] = useState<FindingStatus>(finding.status)
  const [note, setNote] = useState(finding.status_note ?? '')
  useEffect(() => {
    setStatus(finding.status)
    setNote(finding.status_note ?? '')
  }, [finding.finding_id, finding.status, finding.status_note])

  const m = useMutation({
    mutationFn: () => api.patch<{ ok: true }>(`/api/findings/${encodeURIComponent(finding.finding_id)}`, { status, note: note.trim() || null }),
    onSuccess: async () => {
      toast({ title: `Status set to ${status}`, body: finding.finding_id, tone: 'success' })
      await qc.invalidateQueries({ queryKey: ['ws'] })
    },
  })

  const needsNote = NEEDS_NOTE.includes(status)
  const noteMissing = needsNote && note.trim().length === 0
  const unchanged = status === finding.status && (note.trim() || null) === (finding.status_note ?? null)
  const hint = FINDING_STATUSES.find((s) => s.v === status)?.hint

  return (
    <Panel title="Triage" eyebrow="Finding status" id="triage">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-3">Current</span>
        <FindingStatusBadge status={finding.status} />
      </div>
      {finding.status_updated_at || finding.status_updated_by ? (
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          Set by <span className="text-ink-2 [overflow-wrap:anywhere]">{finding.status_updated_by ?? 'unknown'}</span> · <span className="font-mono">{stamp(finding.status_updated_at)}</span>
        </p>
      ) : null}
      {finding.status_note ? <blockquote className="mt-2 border-l-2 border-[rgb(var(--line-strong)/0.2)] pl-3 text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{finding.status_note}</blockquote> : null}

      {allowed ? (
        <form
          className="mt-4 flex flex-col gap-3 border-t hairline pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!noteMissing && !unchanged) m.mutate()
          }}
        >
          <Select label="New status" value={status} onChange={(e) => setStatus(e.target.value as FindingStatus)} aria-describedby={hintId}>
            {FINDING_STATUSES.map((s) => (
              <option key={s.v} value={s.v}>
                {s.v.charAt(0) + s.v.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          {hint ? (
            <p id={hintId} className="-mt-1.5 text-[11.5px] text-ink-3">
              {hint}
            </p>
          ) : null}
          <label htmlFor={noteId} className="flex flex-col gap-1">
            <span className="eyebrow">
              Note{needsNote ? <span className="text-amber-ink"> · required</span> : <span className="normal-case tracking-normal text-ink-4"> (optional)</span>}
            </span>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              required={needsNote}
              aria-invalid={noteMissing || undefined}
              placeholder={needsNote ? 'Why this risk is accepted or suppressed, and who decided' : 'Context for the next person reading this finding'}
              className="min-h-[72px] resize-y rounded border border-[rgb(var(--line-strong)/0.16)] bg-s2 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-[rgb(var(--line-strong)/0.28)] focus-visible:border-copper"
            />
          </label>
          {m.isError ? (
            <p role="alert" className="rounded border border-crimson/40 bg-crimson/10 px-2.5 py-2 text-[12px] text-crimson-ink">
              <span className="font-mono text-[10.5px] tracking-[0.06em]">{m.error instanceof ApiError ? m.error.code : 'ERROR'}</span> · {m.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" loading={m.isPending} disabled={noteMissing || unchanged}>
              Update status
            </Button>
            {noteMissing ? <span className="text-[11.5px] text-amber-ink">Add a note to {status === 'ACCEPTED' ? 'accept' : 'suppress'} this finding.</span> : null}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">Status records triage. It does not change the engine's verdict on the evidence.</p>
        </form>
      ) : (
        <p className="mt-4 border-t hairline pt-3 text-[12px] leading-relaxed text-ink-3">Changing a finding's status requires the analyst role. Your role can read the finding and its evidence.</p>
      )}
    </Panel>
  )
}
