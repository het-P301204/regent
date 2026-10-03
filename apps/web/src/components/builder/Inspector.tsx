import { useState } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import { Button, cx, Select, TextInput } from '../../ui/primitives'
import { ScopeEditor } from '../lab/ScopeEditor'
import type { ActionData, Approval, BEdge, BEdgeData, BNode, BNodeData, DelegationData } from './model'
import { APPROVALS, connectionKind, ID_RE, isPrincipal, KIND_LABEL, nodeTitle } from './model'
import { KIND_ICON } from './canvas'

/**
 * The inspector edits exactly the fields the ChainSpec carries. It is also the
 * keyboard route through the builder: every element can be selected from the
 * outline, and every connection can be made with two selects.
 */

const COMMON_PERMS = ['customer.read', 'customer.write', 'invoice.read', 'invoice.approve', 'report.export']

function Check({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] accent-[rgb(var(--copper))]" />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {help ? <span className="block text-[11px] leading-snug text-ink-3">{help}</span> : null}
      </span>
    </label>
  )
}

function ApprovalSelect({ value, onChange, label }: { value: Approval; onChange: (v: Approval) => void; label: string }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value as Approval)}>
      {APPROVALS.map((a) => (
        <option key={a} value={a}>
          {a.replace(/_/g, ' ').toLowerCase()}
        </option>
      ))}
    </Select>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t hairline pt-3">
      <h3 className="eyebrow mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function ConnectForm({ nodes, edges, fixedSource, onConnect }: { nodes: BNode[]; edges: BEdge[]; fixedSource?: string; onConnect: (s: string, t: string) => void }) {
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const source = nodes.find((n) => n.id === (fixedSource ?? src))
  const targets = source ? nodes.filter((n) => n.id !== source.id && connectionKind(source.data.kind, n.data.kind) && !edges.some((e) => e.source === source.id && e.target === n.id)) : []
  const target = targets.find((n) => n.id === dst)
  const label = (n: BNode) => `${KIND_LABEL[n.data.kind]}: ${nodeTitle(n)}`
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (source && target) {
          onConnect(source.id, target.id)
          setDst('')
        }
      }}
      aria-label={fixedSource ? `Connect ${source ? nodeTitle(source) : ''} to another element` : 'Connect two elements'}
    >
      {fixedSource ? null : (
        <Select label="From" value={src} onChange={(e) => (setSrc(e.target.value), setDst(''))}>
          <option value="">Choose an element…</option>
          {nodes
            .filter((n) => n.data.kind !== 'resource')
            .map((n) => (
              <option key={n.id} value={n.id}>
                {label(n)}
              </option>
            ))}
        </Select>
      )}
      <Select label={fixedSource ? 'Connect to' : 'To'} value={dst} onChange={(e) => setDst(e.target.value)} disabled={!source || targets.length === 0}>
        <option value="">{!source ? 'Choose a source first' : targets.length === 0 ? 'No valid targets on the canvas' : 'Choose a target…'}</option>
        {targets.map((n) => (
          <option key={n.id} value={n.id}>
            {label(n)}
          </option>
        ))}
      </Select>
      {source && target ? (
        <p className="text-[11px] text-ink-3">
          Creates a {connectionKind(source.data.kind, target.data.kind) === 'delegation' ? 'delegation' : connectionKind(source.data.kind, target.data.kind) === 'action' ? 'tool invocation (an action)' : 'execution-path link'}.
        </p>
      ) : source && targets.length === 0 ? (
        <p className="text-[11px] text-ink-3">{isPrincipal(source.data.kind) ? 'Add an agent, sub-agent or tool to connect this principal to.' : source.data.kind === 'tool' ? 'Add a credential or resource for this tool to use.' : 'Add a resource for this credential to reach.'}</p>
      ) : null}
      <Button type="submit" size="sm" icon={<Link2 size={13} aria-hidden />} disabled={!source || !target}>
        Connect
      </Button>
    </form>
  )
}

export function Inspector({ nodes, edges, selectedId, onNode, onEdge, onRemove, onSelect, onConnect }: { nodes: BNode[]; edges: BEdge[]; selectedId: string | null; onNode: (id: string, patch: Partial<BNodeData>) => void; onEdge: (id: string, patch: Partial<BEdgeData>) => void; onRemove: (id: string) => void; onSelect: (id: string | null) => void; onConnect: (s: string, t: string) => void }) {
  const node = nodes.find((n) => n.id === selectedId)
  const edge = edges.find((e) => e.id === selectedId)
  const name = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    return n ? nodeTitle(n) : '?'
  }

  if (node) {
    const d = node.data
    const Icon = KIND_ICON[d.kind]
    const principal = isPrincipal(d.kind)
    const refOk = ID_RE.test(d.ref.trim())
    return (
      <div className="space-y-4">
        <Head icon={<Icon size={15} />} eyebrow={KIND_LABEL[d.kind]} title={nodeTitle(node)} onClose={() => onSelect(null)} />
        {d.kind !== 'credential' ? <TextInput label={principal ? 'Display name' : `${KIND_LABEL[d.kind]} name`} value={d.name} maxLength={80} onChange={(e) => onNode(node.id, { name: e.target.value })} /> : null}
        {principal || d.kind === 'credential' ? (
          <div>
            <TextInput label={principal ? 'Principal id' : 'Credential id'} value={d.ref} maxLength={96} spellCheck={false} onChange={(e) => onNode(node.id, { ref: e.target.value })} aria-invalid={!refOk} />
            <p className={cx('mt-1 text-[11px]', refOk ? 'text-ink-3' : 'text-amber-ink')}>{refOk ? 'Letters, digits and . _ : @ - only.' : 'This id will be rejected: use letters, digits and . _ : @ - only.'}</p>
          </div>
        ) : null}
        {principal ? (
          <Select label="Principal type" value={d.kind} onChange={(e) => onNode(node.id, { kind: e.target.value as BNodeData['kind'] })}>
            <option value="human">Human principal</option>
            <option value="agent">Agent</option>
            <option value="sub_agent">Sub-agent</option>
          </Select>
        ) : null}
        {d.kind === 'human' ? <ScopeEditor label="Authority held" value={d.scope} onChange={(v) => onNode(node.id, { scope: v ?? [] })} suggestions={COMMON_PERMS} help="The ceiling of everything this root principal can delegate." /> : null}
        {d.kind === 'agent' || d.kind === 'sub_agent' ? <p className="text-[12px] leading-relaxed text-ink-3">An agent holds only what is delegated to it. Edit its authority on the incoming delegation.</p> : null}
        {principal ? <Check label="Revoked before the action" help="Synthetic time: revoked at 09:25; actions run from 09:30." checked={d.revoked} onChange={(v) => onNode(node.id, { revoked: v })} /> : null}
        {d.kind === 'credential' ? (
          <>
            <Select label="Credential binding" value={d.binding} onChange={(e) => onNode(node.id, { binding: e.target.value as BNodeData['binding'] })}>
              <option value="execution">Bound to the action's execution identity</option>
              <option value="other">Bound to a different execution identity</option>
              <option value="none">Binding not recorded</option>
            </Select>
            {d.binding === 'other' ? <TextInput label="Bound execution identity id" value={d.bindingOther} placeholder="wl-research-01" spellCheck={false} onChange={(e) => onNode(node.id, { bindingOther: e.target.value })} /> : null}
            <Check label="Credential revoked" help="Revoked at 09:25, before the action authenticates with it." checked={d.revoked} onChange={(v) => onNode(node.id, { revoked: v })} />
          </>
        ) : null}
        {d.kind !== 'resource' ? (
          <Section title="Connect">
            <ConnectForm nodes={nodes} edges={edges} fixedSource={node.id} onConnect={onConnect} />
          </Section>
        ) : null}
        <Connections nodeId={node.id} edges={edges} name={name} onSelect={onSelect} />
        <RemoveButton label={`Remove ${KIND_LABEL[d.kind].toLowerCase()}`} onClick={() => onRemove(node.id)} />
      </div>
    )
  }

  if (edge && edge.data) {
    const from = name(edge.source)
    const to = name(edge.target)
    if (edge.data.kind === 'delegation') {
      const d = edge.data as DelegationData
      const set = (p: Partial<DelegationData>) => onEdge(edge.id, p)
      return (
        <div className="space-y-4">
          <Head eyebrow="Delegation" title={`${from} → ${to}`} onClose={() => onSelect(null)} />
          <ScopeEditor label="Granted scope" value={d.granted} nullable onChange={(v) => set({ granted: v })} suggestions={COMMON_PERMS} help="What the delegator passes on. The engine intersects it with what the delegator held." />
          <Section title="Validity">
            <Check label="Expired before the action" help="Expires at 09:20; actions run from 09:30." checked={d.expired} onChange={(v) => set({ expired: v })} />
            <Check label="Revoked before the action" help="Revoked at 09:25." checked={d.revoked} onChange={(v) => set({ revoked: v })} />
            <ApprovalSelect label="Approval state" value={d.approval} onChange={(v) => set({ approval: v })} />
          </Section>
          <Section title="Evidence recorded">
            <Check label="Policy version recorded" help="Unchecked records the policy with no version." checked={d.policyRecorded} onChange={(v) => set({ policyRecorded: v })} />
            <Check label="Cite parent delegation" help="Unchecked omits the parent reference, so the engine must find it by registry lookup." checked={d.citeParent} onChange={(v) => set({ citeParent: v })} />
          </Section>
          <RemoveButton label="Remove delegation" onClick={() => onRemove(edge.id)} />
        </div>
      )
    }
    if (edge.data.kind === 'action') {
      const d = edge.data as ActionData
      const set = (p: Partial<ActionData>) => onEdge(edge.id, p)
      const actor = nodes.find((n) => n.id === edge.source)
      const others = nodes.filter((n) => isPrincipal(n.data.kind) && n.id !== edge.source)
      const toolNode = nodes.find((n) => n.id === edge.target)
      const credEdge = edges.find((e) => e.source === edge.target && nodes.find((n) => n.id === e.target)?.data.kind === 'credential')
      const cred = credEdge ? nodes.find((n) => n.id === credEdge.target) : undefined
      return (
        <div className="space-y-4">
          <Head eyebrow="Action" title={`${from} → ${to}`} onClose={() => onSelect(null)} />
          <TextInput label="Operation" value={d.operation} maxLength={40} placeholder="read" onChange={(e) => set({ operation: e.target.value })} />
          <ScopeEditor label="Requested scope" value={d.requested} nullable onChange={(v) => set({ requested: v })} suggestions={COMMON_PERMS} />
          <ScopeEditor label="Exercised scope" value={d.exercised} nullable onChange={(v) => set({ exercised: v })} suggestions={COMMON_PERMS} help="What the action actually used. The engine compares it with the actor's effective scope." />
          <Section title="Execution identity">
            <TextInput label="Execution identity id" value={d.execId} placeholder="generated if blank" spellCheck={false} maxLength={96} onChange={(e) => set({ execId: e.target.value })} />
            <Select label="Issued to" value={d.execBoundTo} onChange={(e) => set({ execBoundTo: e.target.value })}>
              <option value="actor">The actor ({actor ? nodeTitle(actor) : 'actor'})</option>
              {others.map((n) => (
                <option key={n.id} value={n.id}>
                  Another principal: {nodeTitle(n)}
                </option>
              ))}
              <option value="none">Not recorded</option>
            </Select>
            <ScopeEditor label="Standing scope" value={d.standing} onChange={(v) => set({ standing: v ?? [] })} suggestions={COMMON_PERMS} help="The workload's own permissions, kept separate from delegated authority." />
            <Check label="Execution identity revoked" checked={d.execRevoked} onChange={(v) => set({ execRevoked: v })} />
          </Section>
          <Section title="Credential">
            {cred ? (
              <>
                <p className="text-[12px] text-ink-2">
                  {toolNode ? nodeTitle(toolNode) : 'The tool'} authenticates with <span className="id">{cred.data.ref}</span>.
                </p>
                <Check label="Credential revoked" help="Revoked at 09:25, before the action authenticates with it." checked={cred.data.revoked} onChange={(v) => onNode(cred.id, { revoked: v })} />
                <Button size="sm" variant="ghost" onClick={() => onSelect(cred.id)}>
                  Edit credential binding
                </Button>
              </>
            ) : (
              <p className="text-[12px] leading-relaxed text-ink-3">No credential node: a credential bound to the execution identity is generated. Add a credential between the tool and the resource to edit its binding.</p>
            )}
          </Section>
          <Section title="Decision">
            <ApprovalSelect label="Approval state" value={d.approval} onChange={(v) => set({ approval: v })} />
            <ScopeEditor label="Requires approval" value={d.requiresApproval} onChange={(v) => set({ requiresApproval: v ?? [] })} help="Permissions the runtime policy says need approval before use." />
            <Check label="Decision cached at provisioning" help="The recorded decision was evaluated at 09:01, before any revocation, and reused at action time." checked={d.cached} onChange={(v) => set({ cached: v })} />
            <Check label="Policy version recorded" checked={d.policyRecorded} onChange={(v) => set({ policyRecorded: v })} />
            <Check label="Cite the actor's delegation" help="Unchecked: the action names no delegation and the engine must look one up." checked={d.citeDelegation} onChange={(v) => set({ citeDelegation: v })} />
          </Section>
          <RemoveButton label="Remove action" onClick={() => onRemove(edge.id)} />
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <Head eyebrow={edge.data.rel} title={`${from} → ${to}`} onClose={() => onSelect(null)} />
        <p className="text-[12px] leading-relaxed text-ink-3">An execution-path link. It carries no authority of its own; it tells the builder which credential and resource the tool's actions use.</p>
        <RemoveButton label="Remove link" onClick={() => onRemove(edge.id)} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-medium text-ink">Nothing selected</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">Select an element on the canvas or below to edit it. Drag between handles to connect, or use the form.</p>
      </div>
      <Section title="Connect two elements">
        <ConnectForm nodes={nodes} edges={edges} onConnect={onConnect} />
      </Section>
      <Section title="Outline">
        {nodes.length === 0 ? (
          <p className="text-[12px] text-ink-3">The canvas is empty.</p>
        ) : (
          <ul className="space-y-0.5" aria-label="Canvas elements">
            {nodes.map((n) => {
              const Icon = KIND_ICON[n.data.kind]
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => onSelect(n.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] text-ink-2 hover:bg-s2 hover:text-ink">
                    <Icon size={13} />
                    <span className="truncate">{nodeTitle(n)}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3">{KIND_LABEL[n.data.kind]}</span>
                  </button>
                </li>
              )
            })}
            {edges.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(e.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-ink-3 hover:bg-s2 hover:text-ink">
                  <span className="font-mono text-[10px]" aria-hidden>
                    ↳
                  </span>
                  <span className="truncate">
                    {name(e.source)} → {name(e.target)}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px]">{e.data?.kind === 'link' ? e.data.rel.toLowerCase() : e.data?.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Head({ eyebrow, title, icon, onClose }: { eyebrow: string; title: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 text-copper-ink">{icon}</span> : null}
        <div className="min-w-0">
          <div className="eyebrow">{eyebrow}</div>
          <h3 className="text-[13.5px] font-medium text-ink [overflow-wrap:anywhere]">{title}</h3>
        </div>
      </div>
      <button type="button" onClick={onClose} className="shrink-0 text-[11.5px] text-ink-3 hover:text-ink">
        Done
      </button>
    </div>
  )
}

function Connections({ nodeId, edges, name, onSelect }: { nodeId: string; edges: BEdge[]; name: (id: string) => string; onSelect: (id: string) => void }) {
  const mine = edges.filter((e) => e.source === nodeId || e.target === nodeId)
  if (mine.length === 0) return null
  return (
    <section className="border-t hairline pt-3">
      <h3 className="eyebrow mb-1.5">Connections</h3>
      <ul className="space-y-0.5">
        {mine.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect(e.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-ink-2 hover:bg-s2 hover:text-ink">
              <span className="truncate">
                {name(e.source)} → {name(e.target)}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3">{e.data?.kind === 'link' ? e.data.rel.toLowerCase() : e.data?.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="border-t hairline pt-3">
      <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}
