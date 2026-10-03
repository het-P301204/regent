import PDFDocument from 'pdfkit'
import { chainHealth, evaluateControls, formatScope, investigate, stripBidi } from '@regent/core'
import type { Finding, Severity } from '@regent/core'
import type { Workspace } from './workspace.ts'
import { nameIndex, statusOf } from './views.ts'

/**
 * Security reports rendered server-side with PDFKit's built-in fonts. Text is
 * taken from evidence that may be hostile, so it is stripped of control and
 * bidirectional characters and mapped into the fonts' character set.
 */

const INK = '#1c1b19'
const MUTED = '#6b655a'
const RULE = '#d8d1c2'
const ACCENT = '#a9573f'
const SEV: Record<Severity, string> = { critical: '#8f1d1d', high: '#a9573f', medium: '#9a6a12', low: '#5d6b55', info: '#6b655a' }

function clean(s: unknown): string {
  return stripBidi(String(s ?? ''))
    .replace(/⊆/g, ' within ')
    .replace(/⊄/g, ' not within ')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .split('')
    .map((ch) => (fontSafe(ch.codePointAt(0)!) ? ch : '?'))
    .join('')
}

/** Characters the built-in PDF fonts can draw: printable ASCII, Latin-1 and common punctuation. */
const PUNCTUATION = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026])
function fontSafe(c: number): boolean {
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || PUNCTUATION.has(c)
}

type Doc = PDFKit.PDFDocument

function setup(title: string, subtitle: string): Doc {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 56, right: 56 }, info: { Title: title, Author: 'REGENT', Subject: subtitle, Creator: 'REGENT report generator' }, bufferPages: true })
  return doc
}

function cover(doc: Doc, title: string, subtitle: string, meta: [string, string][]) {
  const w = doc.page.width
  doc.rect(0, 0, w, 210).fill('#151514')
  // Seal mark: concentric arcs with a delegation path.
  doc.save().lineWidth(1.4).strokeColor('#c47a44')
  doc.circle(80, 70, 18).stroke()
  doc.moveTo(80, 52).lineTo(80, 88).stroke()
  doc.circle(80, 58, 3).fill('#c47a44')
  doc.circle(80, 82, 3).fill('#e9e4d8')
  doc.restore()
  doc.fillColor('#e9e4d8').font('Helvetica-Bold').fontSize(11).text('REGENT', 108, 58, { characterSpacing: 3 })
  doc.fillColor('#b7aa91').font('Helvetica').fontSize(8).text('Authority, traced.', 108, 74)
  doc.fillColor('#e9e4d8').font('Helvetica-Bold').fontSize(24).text(clean(title), 56, 118, { width: w - 112 })
  doc.fillColor('#b7aa91').font('Helvetica').fontSize(10.5).text(clean(subtitle), 56, 156, { width: w - 112 })
  doc.y = 236
  doc.fillColor(INK)
  for (const [k, v] of meta) {
    const y = doc.y
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k.toUpperCase(), 56, y, { width: 130, characterSpacing: 0.6 })
    doc.font('Courier').fontSize(8.5).fillColor(INK).text(clean(v), 190, y, { width: w - 246 })
    doc.moveDown(0.35)
  }
  doc.moveDown(1)
}

function h1(doc: Doc, text: string) {
  if (doc.y > doc.page.height - 160) doc.addPage()
  doc.moveDown(0.8)
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(clean(text), 56)
  const y = doc.y + 3
  doc.moveTo(56, y).lineTo(doc.page.width - 56, y).lineWidth(0.6).strokeColor(RULE).stroke()
  doc.moveDown(0.7)
}

function para(doc: Doc, text: string, opts: { color?: string; size?: number; font?: string } = {}) {
  doc.font(opts.font ?? 'Helvetica').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? INK).text(clean(text), 56, undefined, { width: doc.page.width - 112, lineGap: 2 })
  doc.moveDown(0.4)
}

function kv(doc: Doc, rows: [string, string][]) {
  for (const [k, v] of rows) {
    if (doc.y > doc.page.height - 90) doc.addPage()
    const y = doc.y
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(clean(k), 56, y, { width: 150 })
    const h1y = doc.y
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(clean(v), 210, y, { width: doc.page.width - 266 })
    doc.y = Math.max(doc.y, h1y) + 2
  }
  doc.moveDown(0.4)
}

function table(doc: Doc, headers: string[], widths: number[], rows: string[][]) {
  const x0 = 56
  const draw = (cells: string[], bold: boolean) => {
    if (doc.y > doc.page.height - 90) doc.addPage()
    const y = doc.y
    let maxY = y
    let x = x0
    cells.forEach((c, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 7.5 : 8).fillColor(bold ? MUTED : INK).text(clean(c), x, y, { width: widths[i]! - 6 })
      maxY = Math.max(maxY, doc.y)
      x += widths[i]!
    })
    doc.y = maxY + 3
    doc.moveTo(x0, doc.y - 1).lineTo(x0 + widths.reduce((a, b) => a + b, 0), doc.y - 1).lineWidth(0.4).strokeColor(RULE).stroke()
    doc.y += 2
  }
  draw(headers, true)
  for (const r of rows) draw(r, false)
  doc.moveDown(0.5)
}

function findingBlock(doc: Doc, f: Finding, status: string, n: ReturnType<typeof nameIndex>) {
  if (doc.y > doc.page.height - 200) doc.addPage()
  const y = doc.y
  doc.rect(56, y, 3, 12).fill(SEV[f.severity])
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`${f.title}`, 66, y, { continued: true }).font('Helvetica').fillColor(MUTED).text(`   ${f.severity.toUpperCase()} · ${status} · ${f.rule_id}`)
  doc.font('Courier').fontSize(8).fillColor(MUTED).text(f.finding_id, 66)
  doc.moveDown(0.3)
  para(doc, f.summary)
  para(doc, f.root_cause, { color: '#3a372f', size: 8.8 })
  if (f.authority_delta) {
    kv(doc, [
      ['Granted', formatScope(f.authority_delta.granted)],
      ['Effective', formatScope(f.authority_delta.effective)],
      ['Exercised', formatScope(f.authority_delta.exercised)],
      ['Unauthorized expansion', formatScope(f.authority_delta.excess)],
    ])
  }
  if (f.broken_edge) kv(doc, [['Broken edge', `${f.broken_edge.from ? n.p(f.broken_edge.from) : '(start)'} -> ${f.broken_edge.to ? n.p(f.broken_edge.to) : '?'}${f.broken_edge.delegation_id ? ` (${f.broken_edge.delegation_id})` : ''}`]])
  kv(doc, [['Remediation', f.remediation], ['Evidence', f.evidence.map((e) => `${e.kind}:${e.id}`).join(', ')]])
  doc.moveDown(0.4)
}

function footer(doc: Doc, label: string) {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const y = doc.page.height - 40
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`REGENT · ${clean(label)} · page ${i + 1} of ${range.count}`, 56, y, { width: doc.page.width - 112, align: 'right', lineBreak: false })
  }
}

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

export async function securityReportPdf(ws: Workspace, generatedBy: string, generatedAt: string): Promise<Buffer> {
  const n = nameIndex(ws.bundle)
  const s = ws.run.summary
  const doc = setup('Delegation Authority Security Report', ws.dataset.name)
  cover(doc, 'Delegation Authority Security Report', `${ws.dataset.name}. Who authorized each agent action, through which delegation chain, and whether authority stayed within what was granted.`, [
    ['Dataset', `${ws.dataset.name} (${ws.dataset.source})`],
    ['Dataset id', ws.dataset.id],
    ['Verification run', ws.run_id],
    ['Input digest', ws.run.input_digest],
    ['Rule set', ws.run.ruleset_version],
    ['Engine', ws.run.engine_version],
    ['Generated', `${generatedAt} by ${generatedBy}`],
  ])

  h1(doc, '1. Executive summary')
  const crit = s.findings_by_severity.critical
  const high = s.findings_by_severity.high
  para(doc, `REGENT analyzed ${s.total_actions} agent actions. ${s.attributable_actions} are fully attributable to a root principal; ${s.unattributable_actions} cannot be traced to anyone. ${s.authority_violations} actions exercised authority outside what their delegation chain conveyed, of which ${s.amplification_events} involve authority amplification across a delegation boundary.`)
  para(doc, `${ws.run.findings.length} findings: ${crit} critical, ${high} high, ${s.findings_by_severity.medium} medium, ${s.findings_by_severity.low} low. Authority integrity: ${s.authority_integrity.passing} of ${s.authority_integrity.evaluated} evaluable actions passed (${s.authority_integrity.unknown} could not be evaluated and are not counted as passing).`)
  para(doc, 'Every verdict in this report is produced by deterministic rules over the recorded evidence. Re-running the same evidence with the same rule set produces the same findings and the same input digest.', { color: MUTED, size: 8.5 })

  h1(doc, '2. Environment')
  kv(doc, [
    ['Principals', String(ws.bundle.principals.length)],
    ['Delegations', String(ws.bundle.delegations.length)],
    ['Execution identities', String(ws.bundle.execution_identities.length)],
    ['Credentials (metadata only)', String(ws.bundle.credentials.length)],
    ['Tools / resources', `${ws.bundle.tools.length} / ${ws.bundle.resources.length}`],
    ['Authorization policies', ws.bundle.policies.map((p) => `${p.policy_id} v${p.policy_version}`).join(', ') || 'none recorded'],
    ['Records read / accepted / rejected', `${ws.dataset.records_read} / ${ws.dataset.records_accepted} / ${ws.dataset.records_rejected}`],
  ])

  h1(doc, '3. Analyzed chains')
  table(doc, ['Event', 'Root -> actor', 'Decision', 'Health', 'Findings'], [90, 190, 75, 70, 58],
    ws.run.actions.map((a) => [a.event_id, `${a.chain.root_principal_id ? n.p(a.chain.root_principal_id) : 'UNATTRIBUTABLE'} -> ${a.chain.actor_principal_id ? n.p(a.chain.actor_principal_id) : '?'}`, `${a.derived_decision}${a.recorded_decision && a.recorded_decision !== a.derived_decision ? ` (rec. ${a.recorded_decision})` : ''}`, chainHealth(a), String(a.finding_ids.length)]))

  const groups: [string, (f: Finding) => boolean][] = [
    ['4. Authority findings', (f) => ['AUTHORITY_AMPLIFICATION', 'SCOPE_VIOLATION'].includes(f.type)],
    ['5. Attribution findings', (f) => ['UNATTRIBUTABLE_ACTION', 'BROKEN_DELEGATION_CHAIN', 'ORPHANED_PRINCIPAL', 'MISSING_DELEGATED_SCOPE'].includes(f.type)],
    ['6. Identity findings', (f) => ['EXECUTION_IDENTITY_MISMATCH', 'CREDENTIAL_BINDING_MISMATCH', 'REVOKED_IDENTITY', 'REVOKED_CREDENTIAL', 'UNKNOWN_REFERENCE', 'STALE_DELEGATION', 'ACTION_TIME_AUTHORIZATION_FAILURE'].includes(f.type)],
    ['7. Policy findings', (f) => ['MISSING_POLICY_VERSION', 'MISSING_REQUESTED_SCOPE', 'MISSING_APPROVAL'].includes(f.type)],
  ]
  for (const [title, pred] of groups) {
    h1(doc, title)
    const list = ws.run.findings.filter(pred)
    if (list.length === 0) para(doc, 'No findings in this category.', { color: MUTED })
    for (const f of list) findingBlock(doc, f, statusOf(ws, f.finding_id), n)
  }

  h1(doc, '8. Controls')
  table(doc, ['Control', 'Result', 'Rationale'], [150, 110, 223], evaluateControls(ws.run).map((c) => [`${c.control_id} ${c.title}`, c.result.replace('_', ' '), c.rationale]))

  h1(doc, '9. Remediation')
  const rem = new Map<string, string>()
  for (const f of ws.run.findings) rem.set(f.rule_id, f.remediation)
  for (const [rule, text] of [...rem.entries()].sort()) para(doc, `${rule}: ${text}`)

  h1(doc, 'Appendix A. Evidence and method')
  para(doc, `Findings reference normalized evidence records by id and SHA-256 content digest. A digest shows whether a record has changed since it was ingested; it is not a signature and does not prove who created the record. Input digest for this run: ${ws.run.input_digest}.`, { size: 8.5 })
  para(doc, 'Invariants: Exercised within Effective; Effective(delegatee) within Effective(delegator); every action resolves to a root principal; execution identity and credential bind to the actor; every delegation, identity and credential valid at action time; decision records its policy version.', { size: 8.5 })
  footer(doc, 'Delegation Authority Security Report')
  return toBuffer(doc)
}

export async function investigationReportPdf(ws: Workspace, eventId: string, generatedBy: string, generatedAt: string): Promise<Buffer | null> {
  const inv = investigate(ws.bundle, ws.run, eventId)
  if (!inv) return null
  const n = nameIndex(ws.bundle)
  const incidentId = `INV-${inv.event_id}`
  const doc = setup(`Investigation ${incidentId}`, ws.dataset.name)
  cover(doc, `Investigation report ${incidentId}`, `Authority reconstruction for event ${inv.event_id}.`, [
    ['Incident id', incidentId],
    ['Event', inv.event_id],
    ['Dataset', ws.dataset.name],
    ['Verification run', ws.run_id],
    ['Input digest', ws.run.input_digest],
    ['Generated', `${generatedAt} by ${generatedBy}`],
  ])
  h1(doc, 'Executive summary')
  para(doc, inv.explanation.headline)
  para(doc, inv.explanation.conclusion)
  h1(doc, 'Affected chain')
  kv(doc, [
    ['Human principal', inv.root_principal_id ? n.p(inv.root_principal_id) : 'Not established (unattributable)'],
    ['Agents', inv.path.filter((p) => p.role !== 'root').map((p) => (p.principal_id ? n.p(p.principal_id) : '?')).join(' -> ')],
    ['Tool', inv.tool_id ? n.t(inv.tool_id) : 'not recorded'],
    ['Execution identity', inv.execution_identity_id ?? 'not recorded'],
    ['Credential', inv.credential_id ?? 'not recorded'],
    ['Resource', inv.resource_id ? n.r(inv.resource_id) : 'not recorded'],
    ['Downstream result', inv.result ?? 'not recorded'],
  ])
  h1(doc, 'Authority analysis')
  table(doc, ['Hop', 'Delegator -> delegatee', 'Granted', 'Effective', 'Result'], [32, 160, 110, 110, 71],
    inv.verification.chain.hops.map((h) => [String(h.hop_index + 1), `${h.delegator_principal_id ? n.p(h.delegator_principal_id) : '?'} -> ${h.delegatee_principal_id ? n.p(h.delegatee_principal_id) : '?'}`, formatScope(h.granted_scope), formatScope(h.effective_scope), h.result]))
  kv(doc, [['Effective scope at action', formatScope(inv.verification.effective_scope)], ['Requested', formatScope(inv.verification.requested_scope)], ['Exercised', formatScope(inv.verification.exercised_scope)], ['REGENT decision', `${inv.verification.derived_decision} (recorded: ${inv.verification.recorded_decision ?? 'none'})`]])
  h1(doc, 'Attribution and policy analysis')
  table(doc, ['Check', 'Result', 'Detail'], [110, 55, 318], inv.verification.checks.map((c) => [c.label, c.result, c.detail]))
  h1(doc, 'Timeline')
  table(doc, ['Time', 'Step', 'Status'], [120, 300, 63], [...inv.replay.steps, ...inv.replay.untimed].map((s) => [s.at ? s.at.replace('T', ' ').replace('.000Z', 'Z') : 'untimed', `${s.title}. ${s.detail}`, s.status]))
  h1(doc, 'Findings')
  if (inv.findings.length === 0) para(doc, 'No findings for this event.', { color: MUTED })
  for (const f of inv.findings) findingBlock(doc, f, statusOf(ws, f.finding_id), n)
  h1(doc, 'Related actions')
  if (inv.related.length === 0) para(doc, 'No related actions.', { color: MUTED })
  else table(doc, ['Event', 'Relation', 'Health'], [110, 280, 93], inv.related.map((r) => [r.event_id, r.relation.join(', '), r.health]))
  h1(doc, 'Recommendations')
  const recs = [...new Set(inv.findings.map((f) => f.remediation))]
  if (recs.length === 0) para(doc, 'No remediation required by the evidence.', { color: MUTED })
  for (const r of recs) para(doc, `• ${r}`)
  h1(doc, 'Appendix. Evidence references')
  table(doc, ['Kind', 'Id', 'Digest'], [90, 150, 243], inv.findings.flatMap((f) => f.evidence).filter((e, i, a) => a.findIndex((x) => x.kind === e.kind && x.id === e.id) === i).map((e) => [e.kind, e.id, e.digest ?? '']))
  footer(doc, `Investigation ${incidentId}`)
  doc.fillColor(ACCENT)
  return toBuffer(doc)
}
