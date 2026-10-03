import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { day } from '../../lib/format'
import type { PrincipalType } from '../../lib/types'
import { cx } from '../../ui/primitives'
import { LifecycleBadge } from '../../ui/status'
import { ScopeChips } from '../../ui/scope'
import { ApprovalBadge, INTEGRITY, PrincipalGlyph } from './common'
import type { RegistryDelegation } from './types'

/**
 * A delegation rendered as a formal instrument: a double-ruled contract with
 * the parties, the granted scope and its terms, sealed in the footer with the
 * API's contract integrity verdict. Amplified permissions come from the API.
 */
export function DelegationCard({ d, delegatorType, delegateeType, style }: { d: RegistryDelegation; delegatorType?: PrincipalType | null; delegateeType?: PrincipalType | null; style?: CSSProperties }) {
  const seal = INTEGRITY[d.contract_integrity]
  const headingId = `dlg-${d.delegation_id}`
  return (
    <article
      aria-labelledby={headingId}
      style={style}
      className={cx(
        'group relative flex min-w-0 flex-col rounded-[3px] border-[3px] border-double bg-s1 transition-[border-color,background-color,transform] duration-200 ease-out anim-fade-up hover:-translate-y-px hover:bg-s2 focus-within:bg-s2',
        d.contract_integrity === 'VIOLATION' ? 'border-crimson/45' : 'border-[rgb(var(--line-strong)/0.2)] hover:border-copper/45',
      )}
    >
      {/* Header: the instrument number */}
      <header className="flex items-start justify-between gap-3 border-b hairline px-4 pb-2.5 pt-3">
        <div className="min-w-0">
          <div className="eyebrow">Delegation</div>
          <h3 id={headingId} className="mt-0.5 font-mono text-[12.5px] font-medium uppercase tracking-[0.04em] text-ink [overflow-wrap:anywhere]">
            {/* Stretched link: the whole card opens the contract. */}
            <Link to={`/app/delegations/${encodeURIComponent(d.delegation_id)}`} className="outline-none after:absolute after:inset-0 after:rounded-[3px] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[rgb(var(--copper-ink))]">
              {d.delegation_id}
            </Link>
          </h3>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{day(d.created_at)}</span>
      </header>

      {/* Parties */}
      <div className="px-4 pt-3">
        <Party label="Delegator" name={d.delegator_name} id={d.delegator_principal_id} type={delegatorType} />
        <div className="my-1 ml-[7px] flex items-center gap-2 text-ink-3" aria-hidden>
          <span className="h-4 w-px bg-[rgb(var(--line-strong)/0.25)]" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em]">delegates to</span>
        </div>
        <Party label="Delegatee" name={d.delegatee_name} id={d.delegatee_principal_id} type={delegateeType} />
      </div>

      {/* Terms */}
      <dl className="mt-3 space-y-2.5 px-4 pb-3 text-[12px]">
        <div>
          <dt className="eyebrow mb-1">Granted scope</dt>
          <dd>
            <ScopeChips scope={d.granted_scope} highlight={d.amplified} />
            {d.amplified.length > 0 ? <p className="mt-1 text-[11px] text-crimson-ink">+ marks authority the delegator did not hold</p> : null}
          </dd>
        </div>
        {d.restrictions.length > 0 ? (
          <div>
            <dt className="eyebrow mb-1">Restrictions</dt>
            <dd className="flex flex-wrap gap-1">
              {d.restrictions.map((r) => (
                <span key={r} className="scope-chip border-dashed border-[rgb(var(--line-strong)/0.24)] text-ink-2">
                  {r}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div className="min-w-0">
            <dt className="eyebrow mb-0.5">Expires</dt>
            <dd className="font-mono text-[11.5px] text-ink-2">{d.expires_at ? day(d.expires_at) : 'no expiry recorded'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="eyebrow mb-0.5">Policy</dt>
            <dd className="font-mono text-[11.5px] text-ink-2 [overflow-wrap:anywhere]">{d.policy_id ? `${d.policy_id} v${d.policy_version ?? '?'}` : <span className="italic text-amber-ink">not recorded</span>}</dd>
          </div>
          <div className="min-w-0">
            <dt className="eyebrow mb-1">Approval</dt>
            <dd>
              <ApprovalBadge state={d.approval_state} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="eyebrow mb-1">Recorded status</dt>
            <dd>
              <LifecycleBadge state={d.recorded_status} />
            </dd>
          </div>
        </div>
      </dl>

      {/* Seal */}
      <footer className={cx('mt-auto flex items-center justify-between gap-3 border-t px-4 py-2.5', seal.border, seal.bg)}>
        <span className={cx('inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]', seal.text)}>
          <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-double text-[10px]', seal.border)} aria-hidden>
            {seal.glyph}
          </span>
          {d.contract_integrity === 'VIOLATION' ? 'Contract violation' : `Contract integrity ${d.contract_integrity}`}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
          {d.used_by.length} {d.used_by.length === 1 ? 'action' : 'actions'}
        </span>
      </footer>
    </article>
  )
}

function Party({ label, name, id, type }: { label: string; name: string | null; id: string | null; type?: PrincipalType | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="text-ink-2">
        <PrincipalGlyph type={id ? type : null} size={16} />
      </span>
      <div className="min-w-0">
        <span className="sr-only">{label}: </span>
        <span className="block text-[13px] leading-tight text-ink [overflow-wrap:anywhere]">{id ? (name ?? id) : <span className="italic text-fog-ink">not recorded</span>}</span>
        {id && name && name !== id ? <span className="id block text-[10.5px] text-ink-3">{id}</span> : null}
      </div>
    </div>
  )
}
