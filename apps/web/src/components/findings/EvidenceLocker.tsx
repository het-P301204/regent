import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { EvidenceRef, FindingView } from '../../lib/types'
import { CodeBlock, CopyButton } from '../../ui/data'
import { cx } from '../../ui/primitives'
import { SeverityBadge } from '../../ui/status'
import { IconCredential, IconDelegation, IconEvidence, IconExecution, IconHuman, IconPolicy, IconResource, IconTool, IconViolation } from '../../brand/icons'
import { shortDigest } from '../chains/ChainPath'

export type EvidenceItem = EvidenceRef & { record: unknown }

/**
 * Evidence Locker: the records a finding rests on, in the order an
 * investigator walks them (finding, event, delegation, identity, policy,
 * credential). Each card points at one normalized record and its digest; the
 * console shows them, it does not re-hash or re-judge anything.
 */

const KIND: Record<EvidenceRef['kind'], { label: string; icon: ComponentType<{ size?: number; className?: string }>; order: number }> = {
  action: { label: 'Event', icon: IconEvidence, order: 0 },
  delegation: { label: 'Delegation', icon: IconDelegation, order: 1 },
  principal: { label: 'Identity', icon: IconHuman, order: 2 },
  execution_identity: { label: 'Execution identity', icon: IconExecution, order: 3 },
  policy: { label: 'Policy', icon: IconPolicy, order: 4 },
  credential: { label: 'Credential', icon: IconCredential, order: 5 },
  tool: { label: 'Tool', icon: IconTool, order: 6 },
  resource: { label: 'Resource', icon: IconResource, order: 7 },
}

export function orderEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.map((e, i) => ({ e, i })).sort((a, b) => (KIND[a.e.kind]?.order ?? 99) - (KIND[b.e.kind]?.order ?? 99) || a.i - b.i).map((x) => x.e)
}

export function EvidenceLocker({ finding, evidence }: { finding: FindingView; evidence: EvidenceItem[] }) {
  const ordered = orderEvidence(evidence)
  return (
    <div className="min-w-0">
      <ol className="relative flex min-w-0 flex-col gap-2.5" aria-label="Evidence chain, from the finding to each record it rests on">
        <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-[rgb(var(--line-strong)/0.16)]" />
        <li className="relative grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 anim-fade-up">
          <Node>
            <IconViolation size={15} />
          </Node>
          <div className="min-w-0 rounded-md border border-copper/35 bg-copper/[0.05] px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">Finding</span>
              <SeverityBadge severity={finding.severity} />
              <span className="font-mono text-[11px] text-ink-3">{finding.rule_id}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="id">{finding.finding_id}</span>
              <CopyButton text={finding.finding_id} label="Copy finding ID" />
            </div>
          </div>
        </li>
        {ordered.map((e, i) => (
          <EvidenceCard key={`${e.kind}:${e.id}:${i}`} item={e} delay={(i + 1) * 45} />
        ))}
      </ol>
      {ordered.length === 0 ? <p className="mt-3 pl-11 text-[12.5px] text-ink-3">The engine attached no evidence references to this finding.</p> : null}
    </div>
  )
}

function Node({ children }: { children: ReactNode }) {
  return <span className="relative z-[1] mt-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--line-strong)/0.2)] bg-s2 text-ink-2">{children}</span>
}

function EvidenceCard({ item, delay }: { item: EvidenceItem; delay: number }) {
  const [open, setOpen] = useState(false)
  const k = KIND[item.kind] ?? { label: item.kind, icon: IconEvidence, order: 99 }
  const Icon = k.icon
  const panelId = `evidence-${item.kind}-${item.id}`.replace(/[^A-Za-z0-9_-]/g, '_')
  return (
    <li className="relative grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <Node>
        <Icon size={15} />
      </Node>
      <div className="min-w-0 rounded-md border hairline bg-s1 transition-colors hover:border-[rgb(var(--line-strong)/0.2)]">
        <div className="px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="eyebrow">{k.label}</span>
            {item.event_id && item.kind !== 'action' ? <span className="font-mono text-[10.5px] text-ink-3">for {item.event_id}</span> : null}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="id text-ink">{item.id}</span>
            <CopyButton text={item.id} label="Copy evidence ID" />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="text-[11px] text-ink-3">SHA-256</span>
            {item.digest ? (
              <>
                <span className="font-mono text-[11.5px] text-ink-2" title={item.digest}>
                  {shortDigest(item.digest)}
                </span>
                <CopyButton text={item.digest} label="Copy digest" />
              </>
            ) : (
              <span className="font-mono text-[11px] italic text-fog-ink">no digest recorded</span>
            )}
          </div>
          {item.note ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{item.note}</p> : null}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="mt-2 inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px] text-ink-2 transition-colors hover:bg-s3 hover:text-ink"
          >
            <ChevronDown size={12} aria-hidden className={cx('transition-transform duration-150', open && 'rotate-180')} />
            {open ? 'Hide source record' : 'View source record'}
          </button>
        </div>
        {open ? (
          <div id={panelId} className="border-t hairline px-3.5 py-2.5">
            {item.record === null || item.record === undefined ? (
              <p className="text-[12px] italic text-fog-ink">The referenced record is not in the active dataset. The reference is kept so the gap is visible.</p>
            ) : (
              <CodeBlock value={item.record} maxHeight={300} />
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}
