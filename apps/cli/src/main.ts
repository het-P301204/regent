import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  analyze,
  buildReplay,
  chainHealth,
  ChainSpecSchema,
  chainSpecToRecords,
  explainAction,
  findingsCsv,
  formatScope,
  normalizeText,
  SCENARIOS,
  scenarioBySlug,
  SEVERITY_ORDER,
  toFindingExports,
  verify,
} from '@regent/core'
import type { ActionVerification, CheckResult, EvidenceBundle, Finding, Severity, VerificationRun } from '@regent/core'

/**
 * regent — offline command line for the REGENT engine. Same engine, same
 * results as the API: `regent analyze` on a file prints the input digest the
 * API would record for that file.
 */

const NO_COLOR = !!process.env['NO_COLOR'] || !process.stdout.isTTY
const paint = (code: string) => (s: string) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`)
const c = {
  ivory: paint('38;5;230'),
  muted: paint('38;5;245'),
  amber: paint('38;5;173'),
  red: paint('38;5;167'),
  green: paint('38;5;108'),
  yellow: paint('38;5;179'),
  bold: paint('1'),
  dim: paint('2'),
}
const RESULT: Record<CheckResult, (s: string) => string> = { PASS: c.green, WARN: c.yellow, FAIL: c.red, UNKNOWN: c.muted, SKIPPED: c.muted }
const SEV: Record<Severity, (s: string) => string> = { critical: c.red, high: c.amber, medium: c.yellow, low: c.muted, info: c.muted }
const STATE_DIR = resolve('.regent')
const LAST = resolve(STATE_DIR, 'last.json')

type Saved = { source: string; bundle: EvidenceBundle; run: VerificationRun }

function out(line = '') {
  process.stdout.write(`${line}\n`)
}

function header(title: string) {
  out(c.bold(c.ivory('REGENT')) + c.muted('  Authority, traced.'))
  out()
  out(c.ivory(title))
  out(c.muted('─'.repeat(Math.max(29, title.length))))
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`${c.red('error')} ${msg}\n`)
  process.exit(code)
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) flags[k!] = v
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--') && ['input', 'fail-on', 'severity'].includes(k!)) flags[k!] = argv[++i]!
      else flags[k!] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

function readInput(path: string): string {
  const p = resolve(path)
  if (!existsSync(p)) fail(`file not found: ${path}`)
  const text = readFileSync(p, 'utf8')
  if (text.length > 50 * 1024 * 1024) fail('input larger than 50 MB')
  return text
}

function save(s: Saved) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(LAST, JSON.stringify(s))
}

function load(flags: Record<string, string | boolean>): Saved {
  if (typeof flags['input'] === 'string') {
    const text = readInput(flags['input'])
    const { normalized, run } = analyze(text)
    return { source: flags['input'], bundle: normalized.bundle, run }
  }
  if (!existsSync(LAST)) fail('no previous analysis. Run `regent analyze <file>` first, or pass --input <file>.')
  return JSON.parse(readFileSync(LAST, 'utf8')) as Saved
}

const names = (b: EvidenceBundle) => {
  const m = new Map(b.principals.map((p) => [p.principal_id, p.display_name]))
  const t = new Map(b.tools.map((x) => [x.tool_id, x.display_name]))
  return { p: (id: string | null) => (id ? (m.get(id) ?? id) : '—'), t: (id: string | null) => (id ? (t.get(id) ?? id) : '—') }
}

function printChain(b: EvidenceBundle, run: VerificationRun, v: ActionVerification) {
  const n = names(b)
  const a = b.actions.find((x) => x.action_id === v.action_id)!
  const rows: [string, string][] = []
  if (v.chain.root_principal_id) rows.push(['Human', n.p(v.chain.root_principal_id)])
  else rows.push(['Root', c.red('not established')])
  v.chain.hops.forEach((h, i) => rows.push([i === 0 ? 'Agent' : 'Sub-Agent', `${n.p(h.delegatee_principal_id)}  ${c.muted(`{${formatScope(h.granted_scope)}}`)}${h.amplified.length ? c.red(`  +${formatScope(h.amplified)} not held by delegator`) : ''}`]))
  if (v.chain.hops.length === 0 && a.actor_principal_id && a.actor_principal_id !== v.chain.root_principal_id) rows.push(['Actor', n.p(a.actor_principal_id)])
  rows.push(['Tool', n.t(a.tool_id)])
  rows.push(['Execution', a.execution_identity_id ?? '—'])
  rows.push(['Credential', a.credential_id ?? '—'])
  out()
  out(c.muted(`${v.event_id}  ${v.timestamp ?? 'untimed'}`))
  for (const [k, val] of rows) out(`${c.muted(k.padEnd(12))}${c.ivory(val)}`)
  out()
  for (const ch of v.checks) out(`${ch.label.toUpperCase().padEnd(24)}${RESULT[ch.result](ch.result)}`)
  out(`${'DECISION'.padEnd(24)}${v.derived_decision === 'ALLOW' ? c.green(v.derived_decision) : v.derived_decision === 'DENY' ? c.red(v.derived_decision) : c.yellow(v.derived_decision)}${v.recorded_decision && v.recorded_decision !== v.derived_decision ? c.muted(`  (recorded ${v.recorded_decision})`) : ''}`)
  const amp = run.findings.find((f) => v.finding_ids.includes(f.finding_id) && f.type === 'AUTHORITY_AMPLIFICATION' && f.action_id === v.action_id) ?? run.findings.find((f) => v.finding_ids.includes(f.finding_id) && f.type === 'AUTHORITY_AMPLIFICATION')
  if (amp?.authority_delta) {
    out()
    out(c.red('Authority amplification detected'))
    out()
    out(c.muted('Delegated (effective):'))
    out(`  ${formatScope(amp.authority_delta.effective ?? amp.authority_delta.granted)}`)
    out(c.muted('Exercised:'))
    out(`  ${formatScope(amp.authority_delta.exercised ?? amp.authority_delta.granted)}`)
    out(c.muted('Unauthorized expansion:'))
    out(`  ${c.red(formatScope(amp.authority_delta.excess))}`)
  }
}

function printFindings(list: Finding[]) {
  if (list.length === 0) {
    out(c.green('No findings.'))
    return
  }
  for (const f of list) {
    out(`${SEV[f.severity](f.severity.toUpperCase().padEnd(9))}${c.ivory(f.title)}  ${c.muted(f.finding_id)}`)
    out(`         ${f.summary}`)
  }
}

function summaryLines(run: VerificationRun) {
  const s = run.summary
  out(`${c.muted('Actions'.padEnd(22))}${s.total_actions}`)
  out(`${c.muted('Attributable'.padEnd(22))}${s.attributable_actions}${s.unattributable_actions ? c.red(`   ${s.unattributable_actions} unattributable`) : ''}`)
  out(`${c.muted('Authority violations'.padEnd(22))}${s.authority_violations ? c.red(String(s.authority_violations)) : c.green('0')}`)
  out(`${c.muted('Authority integrity'.padEnd(22))}${s.authority_integrity.passing}/${s.authority_integrity.evaluated} evaluable passed${s.authority_integrity.unknown ? c.muted(`, ${s.authority_integrity.unknown} not evaluable`) : ''}`)
  out(`${c.muted('Chain health'.padEnd(22))}${c.green(`${s.chain_health.verified} verified`)}  ${c.yellow(`${s.chain_health.incomplete} incomplete`)}  ${c.red(`${s.chain_health.violated} violated`)}  ${c.muted(`${s.chain_health.unknown} unknown`)}`)
  out(`${c.muted('Input digest'.padEnd(22))}${c.dim(run.input_digest)}`)
  out(`${c.muted('Rule set'.padEnd(22))}${run.ruleset_version}`)
}

function exitFor(run: VerificationRun, flags: Record<string, string | boolean>) {
  const threshold = flags['fail-on']
  if (typeof threshold !== 'string') return 0
  if (!(threshold in SEVERITY_ORDER)) fail(`--fail-on must be one of ${Object.keys(SEVERITY_ORDER).join(', ')}`)
  return run.findings.some((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[threshold as Severity]) ? 1 : 0
}

const HELP = `${c.bold('regent')} — reconstruct and verify delegated authority behind agent actions

${c.ivory('Usage')}
  regent analyze <events.json|.jsonl> [--json] [--fail-on <severity>]
  regent verify <chain.json>            ChainSpec or evidence file; prints each chain
  regent findings [--severity <s>] [--input <file>]
  regent replay <event-id> [--input <file>]
  regent explain <event-id> [--input <file>]
  regent scenario <slug|number|list>
  regent export <out.json|out.csv> [--input <file>]
  regent chains [--input <file>]       one line per chain with its health

Commands without --input use the last analysis saved in .regent/last.json.
Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage or input error.`

export function main(argv: string[]) {
  const [cmd, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  switch (cmd) {
    case 'analyze': {
      const file = positional[0] ?? fail('usage: regent analyze <events.json>')
      const text = readInput(file)
      const { normalized, run } = analyze(text)
      save({ source: file, bundle: normalized.bundle, run })
      if (flags['json']) {
        out(JSON.stringify({ stats: normalized.stats, issues: normalized.issues, summary: run.summary, input_digest: run.input_digest, findings: toFindingExports(run) }, null, 2))
        return exitFor(run, flags)
      }
      header('Delegation Chain Verification')
      out(`${c.muted('Source'.padEnd(22))}${file}`)
      out(`${c.muted('Records'.padEnd(22))}${normalized.stats.records_accepted} accepted${normalized.stats.records_rejected ? c.red(`, ${normalized.stats.records_rejected} rejected`) : ''}`)
      summaryLines(run)
      const errors = normalized.issues.filter((i) => i.severity === 'error')
      if (errors.length) {
        out()
        out(c.red(`Ingestion errors (${errors.length})`))
        for (const e of errors.slice(0, 10)) out(`  ${c.muted(e.code)} ${e.message}`)
      }
      out()
      out(c.ivory(`Findings (${run.findings.length})`))
      printFindings(run.findings)
      return exitFor(run, flags)
    }
    case 'verify': {
      const file = positional[0] ?? fail('usage: regent verify <chain.json>')
      const text = readInput(file)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
      const spec = ChainSpecSchema.safeParse(parsed)
      const { bundle, run } = spec.success
        ? (() => {
            const n = normalizeText(JSON.stringify(chainSpecToRecords(spec.data)))
            return { bundle: n.bundle, run: verify(n.bundle) }
          })()
        : (() => {
            const r = analyze(text)
            return { bundle: r.normalized.bundle, run: r.run }
          })()
      save({ source: file, bundle, run })
      header('Delegation Chain Verification')
      for (const v of run.actions) printChain(bundle, run, v)
      out()
      out(c.ivory(`Findings (${run.findings.length})`))
      printFindings(run.findings)
      return exitFor(run, flags)
    }
    case 'findings': {
      const s = load(flags)
      let list = s.run.findings
      if (typeof flags['severity'] === 'string') list = list.filter((f) => f.severity === flags['severity'])
      if (flags['json']) {
        out(JSON.stringify(toFindingExports({ ...s.run, findings: list }), null, 2))
        return 0
      }
      header(`Findings — ${s.source}`)
      printFindings(list)
      return 0
    }
    case 'replay': {
      const id = positional[0] ?? fail('usage: regent replay <event-id>')
      const s = load(flags)
      const r = buildReplay(s.bundle, s.run, id) ?? fail(`no event "${id}" in ${s.source}`)
      header(`Action Replay — ${r.event_id}`)
      r.steps.forEach((step, i) => {
        const offset = step.offset_ms === null ? '  --:--' : fmtOffset(step.offset_ms)
        const marker = i === r.violation_index ? c.red(' ◆') : '  '
        out(`${c.muted(offset)}${marker} ${RESULT[step.status](step.status.padEnd(7))} ${c.ivory(step.title)}`)
        out(`${' '.repeat(18)}${c.muted(step.detail)}`)
      })
      for (const step of r.untimed) out(`${c.muted('  untimed')}   ${RESULT[step.status](step.status.padEnd(7))} ${step.title}`)
      if (r.violation_index !== null) {
        out()
        out(c.red(`First violation at step ${r.violation_index + 1}: ${r.steps[r.violation_index]!.title}`))
      }
      return 0
    }
    case 'explain': {
      const id = positional[0] ?? fail('usage: regent explain <event-id>')
      const s = load(flags)
      const e = explainAction(s.bundle, s.run, id) ?? fail(`no event "${id}"`)
      header(e.question)
      out(c.ivory(e.headline))
      out()
      for (const step of e.steps) out(`${step.tone === 'fail' ? c.red('✕') : step.tone === 'pass' ? c.green('✓') : step.tone === 'warn' ? c.yellow('!') : c.muted('·')} ${step.text}`)
      out()
      out(e.conclusion)
      return 0
    }
    case 'scenario': {
      const slug = positional[0] ?? 'list'
      if (slug === 'list') {
        header('Scenario Lab')
        for (const s of SCENARIOS) out(`${c.muted(String(s.number).padStart(2))}  ${c.ivory(s.slug.padEnd(28))}${s.title}`)
        return 0
      }
      const s = scenarioBySlug(slug) ?? fail(`unknown scenario "${slug}". Try \`regent scenario list\`.`)
      const { normalized, run } = analyze(s.records)
      save({ source: `scenario:${s.slug}`, bundle: normalized.bundle, run })
      header(`Scenario ${s.number}: ${s.title}`)
      out(c.muted(s.summary))
      for (const v of run.actions) printChain(normalized.bundle, run, v)
      out()
      out(c.ivory(`Findings (${run.findings.length})`))
      printFindings(run.findings)
      out()
      out(c.muted(`Teaches: ${s.teaches}`))
      return 0
    }
    case 'export': {
      const file = positional[0] ?? fail('usage: regent export <out.json|out.csv>')
      const s = load(flags)
      const content = file.endsWith('.csv') ? findingsCsv(s.run) : JSON.stringify({ schema: 'regent.findings/v1', source: s.source, input_digest: s.run.input_digest, ruleset_version: s.run.ruleset_version, findings: toFindingExports(s.run) }, null, 2)
      mkdirSync(dirname(resolve(file)), { recursive: true })
      writeFileSync(resolve(file), content)
      out(`${c.green('wrote')} ${file} ${c.muted(`(${s.run.findings.length} findings)`)}`)
      return 0
    }
    case 'chains': {
      const s = load(flags)
      header(`Chains — ${s.source}`)
      const n = names(s.bundle)
      for (const v of s.run.actions) {
        const h = chainHealth(v)
        const col = h === 'verified' ? c.green : h === 'violated' ? c.red : h === 'incomplete' ? c.yellow : c.muted
        out(`${col(h.padEnd(11))}${c.muted(v.event_id.padEnd(16))}${n.p(v.chain.root_principal_id)} → ${n.p(v.chain.actor_principal_id)}`)
      }
      return 0
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      out(HELP)
      return 0
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`)
  }
}

function fmtOffset(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h > 0 ? `${String(h).padStart(2, '0')}:` : '   '}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`.padStart(8)
}

const isMain = process.argv[1]?.endsWith('main.ts') ?? false
if (isMain) process.exitCode = main(process.argv.slice(2)) ?? 0
