import type { ComponentType, ReactNode } from 'react'
import type { DimensionCheck, Investigation } from '../../lib/types'
import { DecisionBadge, ResultBadge } from '../../ui/status'
import { ScopeChips } from '../../ui/scope'
import { cx } from '../../ui/primitives'
import { IconAgent, IconDelegation, IconHuman, IconPolicy, IconResource, IconTool, IconVerification } from '../../brand/icons'

/**
 * Who ↓ Authorized ↓ Delegated ↓ Executed ↓ Resource ↓ Result.
 * Each stage reads one part of the investigation and shows the engine's own
 * check results for it. Nothing here combines checks into a new verdict.
 */

export type Lookup = (id: string | null | undefined) => string | null

interface Stage {
  key: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  body: ReactNode
  checks: DimensionCheck[]
}

export function AuthoritySequence({ inv, principal, tool, resource }: { inv: Investigation; principal: Lookup; tool: Lookup; resource: Lookup }) {
  const v = inv.verification
  const pick = (...dims: DimensionCheck['dimension'][]) => dims.map((d) => v.checks.find((c) => c.dimension === d)).filter((c): c is DimensionCheck => !!c)
  const delegatees = inv.path.filter((p) => p.role !== 'root')

  const stages: Stage[] = [
    {
      key: 'who',
      label: 'Who',
      icon: IconHuman,
      checks: pick('attribution'),
      body: inv.root_principal_id ? (
        <Named name={principal(inv.root_principal_id)} id={inv.root_principal_id} sub="Root principal" />
      ) : (
        <Missing text="No root principal established" sub="The engine could not trace this action to a human principal." />
      ),
    },
    {
      key: 'authorized',
      label: 'Authorized',
      icon: IconPolicy,
      checks: pick('policy', 'approval'),
      body: (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-3">Derived decision</span>
            <DecisionBadge decision={v.derived_decision} recorded={v.recorded_decision} />
          </div>
          {v.derived_decision_reasons[0] ? <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{v.derived_decision_reasons[0]}</p> : null}
          {v.decision_agreement === 'DISAGREE' ? <p className="mt-1 text-[11.5px] text-amber-ink"><span aria-hidden>! </span>The recorded decision differs from the one the evidence supports.</p> : null}
        </div>
      ),
    },
    {
      key: 'delegated',
      label: 'Delegated',
      icon: IconDelegation,
      checks: pick('chain_completeness', 'authority'),
      body: (
        <div className="min-w-0">
          {delegatees.length === 0 ? (
            <span className="text-[12.5px] text-ink-2">No delegation: the root principal acted directly.</span>
          ) : (
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Delegatees in order">
              {delegatees.map((p, i) => (
                <li key={`${p.principal_id}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 ? <span aria-hidden className="text-[10px] text-ink-4">›</span> : null}
                  <IconAgent size={12} className="shrink-0 text-ink-3" />
                  {p.principal_id ? (
                    <span className="min-w-0 text-[12.5px] text-ink [overflow-wrap:anywhere]" title={p.principal_id}>
                      {principal(p.principal_id)}
                    </span>
                  ) : (
                    <span className="text-[12.5px] italic text-fog-ink">unrecorded principal</span>
                  )}
                  {p.role === 'actor' ? <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">actor</span> : null}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-1 font-mono text-[11px] text-ink-3">
            {v.chain.hops.length} {v.chain.hops.length === 1 ? 'hop' : 'hops'} · chain {v.chain.complete ? 'complete' : <span className="text-amber-ink">incomplete</span>} · resolved {v.chain.resolution}
          </p>
        </div>
      ),
    },
    {
      key: 'executed',
      label: 'Executed',
      icon: IconTool,
      checks: pick('identity', 'credential_binding', 'temporal'),
      body: (
        <div className="min-w-0">
          {inv.tool_id ? <Named name={tool(inv.tool_id)} id={inv.tool_id} sub="Tool" /> : <Missing text="Tool not recorded" />}
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11.5px]">
            <dt className="text-ink-3">Execution identity</dt>
            <dd className="id text-[11.5px]">{inv.execution_identity_id ?? <span className="italic text-fog-ink">not recorded</span>}</dd>
            <dt className="text-ink-3">Credential</dt>
            <dd className="id text-[11.5px]">{inv.credential_id ?? <span className="italic text-fog-ink">not recorded</span>}</dd>
          </dl>
        </div>
      ),
    },
    {
      key: 'resource',
      label: 'Resource',
      icon: IconResource,
      checks: pick('scope'),
      body: (
        <div className="min-w-0">
          {inv.resource_id ? <Named name={resource(inv.resource_id)} id={inv.resource_id} sub="Resource" /> : <Missing text="Resource not recorded" />}
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[11.5px] text-ink-3">Exercised scope</span>
            <ScopeChips scope={v.exercised_scope} />
          </div>
        </div>
      ),
    },
    {
      key: 'result',
      label: 'Result',
      icon: IconVerification,
      checks: [],
      body: (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {inv.result ? <span className="font-mono text-[12.5px] text-ink">{inv.result}</span> : <span className="text-[12.5px] italic text-fog-ink">No downstream result recorded</span>}
            <span className="text-[11.5px] text-ink-3">· {v.executed ? 'the action took effect' : 'the action did not take effect'}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[11.5px] text-ink-3">Overall verification result</span>
            <ResultBadge result={v.overall} />
          </div>
        </div>
      ),
    },
  ]

  return (
    <ol className="relative flex flex-col" aria-label="Authority sequence from human principal to result">
      {stages.map((s, i) => {
        const Icon = s.icon
        const last = i === stages.length - 1
        return (
          <li key={s.key} className="relative grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 anim-fade-up" style={{ animationDelay: `${i * 55}ms` }}>
            <div className="relative flex flex-col items-center">
              <span className="relative z-[1] inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--line-strong)/0.2)] bg-s2 text-ink-2">
                <Icon size={15} />
              </span>
              {!last ? (
                <span aria-hidden className="flex w-px flex-1 flex-col items-center bg-[rgb(var(--line-strong)/0.16)]">
                  <span className="mt-auto -mb-1 text-[9px] leading-none text-ink-4">▾</span>
                </span>
              ) : null}
            </div>
            <div className={cx('min-w-0 pt-1', last ? 'pb-0' : 'pb-5')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="eyebrow text-ink-2">{s.label}</h3>
                {s.checks.map((c) => (
                  <span key={c.dimension} className="inline-flex items-center gap-1.5" title={c.detail}>
                    <span className="text-[11px] text-ink-3">{c.label}</span>
                    <ResultBadge result={c.result} />
                  </span>
                ))}
              </div>
              <div className="mt-1.5 min-w-0">{s.body}</div>
              {s.checks
                .filter((c) => c.result !== 'PASS' && c.result !== 'SKIPPED' && c.detail)
                .map((c) => (
                  <p key={c.dimension} className={cx('mt-1.5 border-l-2 pl-2.5 text-[11.5px] leading-relaxed', c.result === 'FAIL' ? 'border-crimson/60 text-ink-2' : c.result === 'WARN' ? 'border-amber/55 text-ink-2' : 'border-fog/55 text-ink-2')}>
                    <span className="font-mono text-[10.5px] text-ink-3">{c.label}: </span>
                    {c.detail}
                  </p>
                ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Named({ name, id, sub }: { name: string | null; id: string; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13.5px] text-ink [overflow-wrap:anywhere]">{name ?? id}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
        <span>{sub}</span>
        <span className="id text-[11px] text-ink-3">{id}</span>
      </div>
    </div>
  )
}

function Missing({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[13px] italic text-fog-ink">
        <span aria-hidden className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-dashed border-current text-[8px] not-italic">
          ?
        </span>
        {text}
      </div>
      {sub ? <p className="mt-0.5 text-[11.5px] text-ink-3">{sub}</p> : null}
    </div>
  )
}
