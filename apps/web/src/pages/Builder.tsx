import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react'
import type { Connection, Edge } from '@xyflow/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Eraser, Save, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { afterDatasetChange } from '../lib/queries'
import { useSession } from '../lib/session'
import { useReducedMotion } from '../lib/prefs'
import type { Finding } from '../lib/types'
import { Badge, Button, cx, LinkButton, PageHeader, Panel, Select, TextInput } from '../ui/primitives'
import { EmptyState, ErrorState, useToast } from '../ui/feedback'
import { VerificationSequence } from '../viz/VerificationSequence'
import { BuilderCtx, EdgeMarkers, edgeTypes, KIND_ICON, NODE_W, nodeTypes } from '../components/builder/canvas'
import { Inspector } from '../components/builder/Inspector'
import { BuilderResults } from '../components/builder/Results'
import { compile, connectionKind, defaultEdgeData, elementForPath, flagsFor, handlesFor, KIND_LABEL, locate, newId, newNode, TEMPLATES } from '../components/builder/model'
import type { BEdge, BEdgeData, BKind, BNode, BNodeData, Compiled } from '../components/builder/model'
import type { BuilderVerifyResponse } from '../components/lab/run'

const DND_TYPE = 'application/x-regent-kind'
const PALETTE: { kind: BKind; hint: string }[] = [
  { kind: 'human', hint: 'Root principal' },
  { kind: 'agent', hint: 'Receives delegation' },
  { kind: 'sub_agent', hint: 'Delegated by an agent' },
  { kind: 'tool', hint: 'What an action invokes' },
  { kind: 'credential', hint: 'Authenticates the tool' },
  { kind: 'resource', hint: 'Target of the action' },
]

export default function Builder() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  )
}

interface Verified {
  res: BuilderVerifyResponse
  compiled: Compiled
  json: string
}

function BuilderInner() {
  const rf = useReactFlow<BNode, BEdge>()
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useSession()
  const reduced = useReducedMotion()
  const initial = useMemo(() => TEMPLATES[0]!.build(), [])
  const [nodes, setNodes, onNodesChange] = useNodesState<BNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<BEdge>(initial.edges)
  const [name, setName] = useState(TEMPLATES[0]!.name)
  const [template, setTemplate] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verified, setVerified] = useState<Verified | null>(null)
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const compiled = useMemo(() => compile(nodes, edges, name), [nodes, edges, name])
  const specJson = useMemo(() => JSON.stringify(compiled.spec), [compiled])
  const stale = verified !== null && verified.json !== specJson
  const flags = useMemo(() => (verified && !stale ? flagsFor(verified.res.run, verified.compiled.map) : null), [verified, stale])

  const verify = useMutation({
    mutationFn: (c: Compiled) => api.post<BuilderVerifyResponse>('/api/builder/verify', c.spec),
    onSuccess: (res, c) => {
      setVerified({ res, compiled: c, json: JSON.stringify(c.spec) })
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }))
    },
  })
  const save = useMutation({
    mutationFn: (c: Compiled) => api.post<{ dataset: { id: string; name: string }; run_id: string }>('/api/builder/save', c.spec),
    onSuccess: async (res) => {
      await afterDatasetChange(qc)
      setSaved({ id: res.dataset.id, name: res.dataset.name })
      toast({ tone: 'success', title: 'Saved as a dataset', body: `"${res.dataset.name}" is now the active dataset and has been verified.` })
    },
    onError: (e) => toast({ tone: 'error', title: 'Could not save the chain', body: e instanceof Error ? e.message : undefined }),
  })

  const runVerify = useCallback(() => {
    if (compiled.spec.principals.length === 0) return
    verify.mutate(compiled)
  }, [compiled, verify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runVerify()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runVerify])

  // ---------------------------------------------------------------- editing

  const select = useCallback(
    (id: string | null, focus = false) => {
      setNodes((ns) => ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })))
      setEdges((es) => es.map((e) => (!!e.selected === (e.id === id) ? e : { ...e, selected: e.id === id })))
      setSelectedId(id)
      if (focus && id) {
        const e = edges.find((x) => x.id === id)
        const ids = e ? [{ id: e.source }, { id: e.target }] : [{ id }]
        requestAnimationFrame(() => rf.fitView({ nodes: ids, padding: 0.6, maxZoom: 1.15, duration: reduced ? 0 : 450 }))
      }
    },
    [setNodes, setEdges, edges, rf, reduced],
  )

  const addNode = useCallback(
    (kind: BKind, at?: { x: number; y: number }) => {
      let position = at
      if (!position) {
        const r = wrapRef.current?.getBoundingClientRect()
        const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 }
        const k = nodes.length % 6
        position = { x: c.x - NODE_W / 2 + k * 22, y: c.y - 36 + k * 22 }
      }
      const n = { ...newNode(kind, position, nodes), selected: true }
      setNodes((ns) => [...ns.map((x) => (x.selected ? { ...x, selected: false } : x)), n])
      setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)))
      setSelectedId(n.id)
    },
    [nodes, rf, setNodes, setEdges],
  )

  const connect = useCallback(
    (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null) => {
      const s = nodes.find((n) => n.id === source)
      const t = nodes.find((n) => n.id === target)
      if (!s || !t || s.id === t.id) return
      const kind = connectionKind(s.data.kind, t.data.kind)
      if (!kind || edges.some((e) => e.source === source && e.target === target)) return
      const handles = sourceHandle && targetHandle ? { sourceHandle, targetHandle } : handlesFor(s, t)
      const e: BEdge = { id: newId('e'), source, target, type: 'b', ...handles, data: defaultEdgeData(kind, s, t, nodes, edges), selected: true }
      setEdges((es) => [...es.map((x) => (x.selected ? { ...x, selected: false } : x)), e])
      setNodes((ns) => ns.map((x) => (x.selected ? { ...x, selected: false } : x)))
      setSelectedId(e.id)
    },
    [nodes, edges, setEdges, setNodes],
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const s = nodes.find((n) => n.id === c.source)
      const t = nodes.find((n) => n.id === c.target)
      return !!s && !!t && s.id !== t.id && connectionKind(s.data.kind, t.data.kind) !== null && !edges.some((e) => e.source === c.source && e.target === c.target)
    },
    [nodes, edges],
  )

  const onNode = useCallback(
    (id: string, patch: Partial<BNodeData>) => {
      const next = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      setNodes(next)
      if (patch.kind) {
        setEdges((es) =>
          es.filter((e) => {
            const s = next.find((n) => n.id === e.source)
            const t = next.find((n) => n.id === e.target)
            return !!s && !!t && connectionKind(s.data.kind, t.data.kind) === e.data?.kind
          }),
        )
      }
    },
    [nodes, setNodes, setEdges],
  )

  const onEdge = useCallback((id: string, patch: Partial<BEdgeData>) => setEdges((es) => es.map((e) => (e.id === id && e.data ? { ...e, data: { ...e.data, ...patch } as BEdgeData } : e))), [setEdges])

  const remove = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => es.filter((e) => e.id !== id && e.source !== id && e.target !== id).map((e) => (e.data?.kind === 'action' && e.data.execBoundTo === id ? { ...e, data: { ...e.data, execBoundTo: 'actor' } } : e)))
      setSelectedId(null)
    },
    [setNodes, setEdges],
  )

  const loadTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    const built = t.build()
    setNodes(built.nodes)
    setEdges(built.edges)
    setName(t.name)
    setSelectedId(null)
    setVerified(null)
    setSaved(null)
    verify.reset()
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1.05, duration: reduced ? 0 : 400 }))
  }

  const clear = () => {
    setNodes([])
    setEdges([])
    setName('Untitled chain')
    setSelectedId(null)
    setVerified(null)
    setSaved(null)
    verify.reset()
  }

  const exportSpec = () => {
    const blob = new Blob([JSON.stringify(compiled.spec, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(compiled.spec.name ?? 'chain').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chain'}.chainspec.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onLocate = (f: Finding) => {
    if (!verified) return
    const l = locate(f, verified.res.run, verified.compiled.map)
    const id = l.edges[0] ?? l.nodes[0]
    if (!id) return
    select(id, true)
    wrapRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const kind = e.dataTransfer.getData(DND_TYPE) as BKind
    if (!kind || !(kind in KIND_LABEL)) return
    e.preventDefault()
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode(kind, { x: p.x - NODE_W / 2, y: p.y - 30 })
  }

  // ---------------------------------------------------------------- render

  const validation = verify.error instanceof ApiError && verify.error.code === 'VALIDATION_FAILED' && Array.isArray(verify.error.details) ? (verify.error.details as { path: string; message: string }[]) : null
  const ctx = useMemo(() => ({ flags, reduced, select: (id: string) => select(id) }), [flags, reduced, select])
  const flaggedCount = flags ? flags.nodes.size + flags.edges.size : 0
  const canSave = can('analyst')

  return (
    <div>
      <PageHeader
        eyebrow="Build · Chain builder"
        title="Chain builder"
        description="Draw a delegation chain and let the engine verify it. The canvas compiles to a ChainSpec; every verdict below comes from the same engine path as imported evidence. Built chains are synthetic and use a fixed clock: delegations from 09:00, revocations at 09:25, actions from 09:30."
        actions={<Badge tone="fog">Synthetic</Badge>}
      />

      <div className="panel mb-3 flex flex-col gap-3 p-3 md:flex-row md:items-end">
        <TextInput label="Chain name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="md:w-[260px]" />
        <Select
          label="Start from a template"
          value={template}
          onChange={(e) => {
            setTemplate('')
            loadTemplate(e.target.value)
          }}
          className="md:w-[250px]"
        >
          <option value="">Choose a template…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <Button variant="ghost" icon={<Eraser size={14} aria-hidden />} onClick={clear} disabled={nodes.length === 0}>
            Clear
          </Button>
          <Button icon={<Download size={14} aria-hidden />} onClick={exportSpec} disabled={compiled.spec.principals.length === 0}>
            Export ChainSpec
          </Button>
          <Button icon={<Save size={14} aria-hidden />} onClick={() => save.mutate(compiled)} loading={save.isPending} disabled={!canSave || compiled.spec.principals.length === 0} title={canSave ? 'Create a dataset from this chain and make it active' : 'Requires the analyst role'}>
            Save as dataset
          </Button>
          <Button variant="primary" icon={<ShieldCheck size={15} aria-hidden />} onClick={runVerify} loading={verify.isPending} disabled={compiled.spec.principals.length === 0} shortcut="Ctrl ↵" className="h-9 px-4 tracking-[0.08em]">
            VERIFY CHAIN
          </Button>
        </div>
      </div>

      <div className="mb-3 flex min-h-[22px] flex-wrap items-center justify-between gap-2">
        <VerificationSequence running={verify.isPending} done={verify.isSuccess && !stale} failed={verify.isError} />
        <div className="text-[11.5px] text-ink-3" aria-live="polite">
          {verify.isSuccess && !stale ? (flaggedCount > 0 ? `${flaggedCount} canvas element${flaggedCount === 1 ? '' : 's'} flagged by the engine` : 'No canvas element flagged') : stale ? 'Canvas changed since the last verification' : `${compiled.spec.principals.length} principals · ${compiled.spec.delegations.length} delegations · ${compiled.spec.actions.length} actions`}
        </div>
      </div>
      {saved ? (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded border border-sage/40 bg-sage/[0.07] px-3 py-2 text-[12.5px] text-sage-ink">
          ✓ Saved "{saved.name}" as the active dataset.
          <LinkButton to="/app/chains" size="sm" variant="ghost">
            Open in Chains
          </LinkButton>
          <LinkButton to="/app/findings" size="sm" variant="ghost">
            View findings
          </LinkButton>
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
        <Panel title="Palette" eyebrow="Drag or add" id="palette" bodyClassName="p-2">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Element palette">
            {PALETTE.map(({ kind, hint }) => {
              const Icon = KIND_ICON[kind]
              return (
                <li
                  key={kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, kind)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className="group flex min-w-[150px] cursor-grab items-center gap-2 rounded border border-[rgb(var(--line-strong)/0.14)] bg-s2 px-2 py-1.5 transition-colors hover:border-copper/45 active:cursor-grabbing lg:min-w-0"
                >
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded', kind === 'human' || kind === 'agent' || kind === 'sub_agent' ? 'bg-copper/12 text-copper-ink' : 'bg-s3 text-ink-2')}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{KIND_LABEL[kind]}</span>
                    <span className="block truncate text-[10.5px] text-ink-3">{hint}</span>
                  </span>
                  <button type="button" onClick={() => addNode(kind)} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-s3 hover:text-ink focus-visible:text-ink" aria-label={`Add ${KIND_LABEL[kind].toLowerCase()} to the canvas`}>
                    Add
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 hidden px-1 text-[10.5px] leading-snug text-ink-3 lg:block">Drag onto the canvas, or press Add to place at the centre.</p>
        </Panel>

        <div className="min-w-0">
          <div
            ref={wrapRef}
            className="rf-regent dotgrid relative h-[460px] w-full overflow-hidden rounded-md border hairline bg-canvas lg:h-[600px]"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DND_TYPE)) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={onDrop}
          >
            <EdgeMarkers />
            <BuilderCtx.Provider value={ctx}>
              <ReactFlow<BNode, BEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={(c) => connect(c.source, c.target, c.sourceHandle, c.targetHandle)}
                isValidConnection={isValidConnection}
                onSelectionChange={({ nodes: ns, edges: es }) => setSelectedId(ns[0]?.id ?? es[0]?.id ?? null)}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                deleteKeyCode={['Delete', 'Backspace']}
                connectionLineStyle={{ stroke: 'rgb(var(--copper-ink))', strokeWidth: 1.8 }}
                snapToGrid
                snapGrid={[9, 9]}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
                minZoom={0.3}
                maxZoom={1.8}

                aria-label="Chain builder canvas"
              >
                <Background gap={18} size={0} color="transparent" />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </BuilderCtx.Provider>
            {nodes.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <EmptyState
                  className="panel-raised max-w-md py-8"
                  title="The canvas is empty"
                  body="Start from a template, or add a human principal and build outward: principal → agent → tool → resource."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {TEMPLATES.slice(0, 3).map((t) => (
                        <Button key={t.id} size="sm" onClick={() => loadTemplate(t.id)}>
                          {t.title}
                        </Button>
                      ))}
                      <Button size="sm" variant="primary" onClick={() => addNode('human')}>
                        Add a human principal
                      </Button>
                    </div>
                  }
                />
              </div>
            ) : null}
          </div>
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-relaxed text-ink-3">
              Connections: principal → agent or sub-agent is a <span className="text-ink-2">delegation</span>; principal → tool is an <span className="text-ink-2">action</span>; tool → credential → resource is the execution path. Delete removes the selection; arrow keys move a focused node.
            </p>
            {validation ? (
              <div role="alert" className="rounded border border-amber/45 bg-amber/[0.06] p-3">
                <div className="eyebrow mb-1 text-amber-ink">Rejected by the API · VALIDATION_FAILED</div>
                <ul className="space-y-1">
                  {validation.map((v, i) => {
                    const el = elementForPath(v.path, compiled.spec, compiled.map)
                    return (
                      <li key={i} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                        <span className="font-mono text-[11px] text-ink-3">{v.path || 'spec'}</span>
                        <span className="text-ink-2">{v.message}</span>
                        {el ? (
                          <button type="button" className="text-[11.5px] text-copper-ink hover:underline" onClick={() => select(el, true)}>
                            Select element
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
            {compiled.notes.length > 0 ? (
              <ul className="space-y-1" aria-label="Canvas notes">
                {compiled.notes.map((n, i) => (
                  <li key={i} className={cx('flex items-baseline gap-2 text-[12px]', n.level === 'warn' ? 'text-amber-ink' : 'text-ink-3')}>
                    <span aria-hidden>{n.level === 'warn' ? '!' : '·'}</span>
                    <span>{n.text}</span>
                    {n.target ? (
                      <button type="button" className="shrink-0 text-[11.5px] text-copper-ink hover:underline" onClick={() => select(n.target!, true)}>
                        Select
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <Panel title="Inspector" eyebrow={selectedId ? 'Selected element' : 'Canvas'} id="inspector" className="lg:max-h-[760px] lg:overflow-y-auto">
          <Inspector nodes={nodes} edges={edges} selectedId={selectedId} onNode={onNode} onEdge={onEdge} onRemove={remove} onSelect={(id) => select(id, !!id)} onConnect={(s, t) => connect(s, t)} />
        </Panel>
      </div>

      <div ref={resultsRef} className="scroll-mt-4">
        {verify.isError && !validation ? <ErrorState error={verify.error} retry={runVerify} /> : null}
        {verified ? (
          <BuilderResults res={verified.res} compiled={verified.compiled} stale={stale} onLocate={onLocate} />
        ) : !verify.isPending && !verify.isError ? (
          <div className="mt-6 rounded-md border border-dashed hairline-strong px-4 py-6 text-center text-[12.5px] text-ink-3">
            Press <span className="text-ink-2">VERIFY CHAIN</span> to send this ChainSpec to the engine. Findings, per-action checks, the authority flow and the explanation appear here.
          </div>
        ) : null}
      </div>
    </div>
  )
}
