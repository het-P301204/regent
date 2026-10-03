import { SCENARIOS, analyze } from '../packages/core/src/index.ts'
for (const s of SCENARIOS) {
  const { run, normalized } = analyze(s.records)
  const got = [...new Set(run.findings.map(f => f.type))].sort()
  const ok = JSON.stringify(got) === JSON.stringify([...s.expected].sort())
  console.log(ok ? 'OK ' : 'XX ', s.number, s.slug, got.join(','), normalized.issues.filter(i=>i.severity==='error').length)
  if (!ok || process.argv[2] === s.slug) {
    for (const f of run.findings) console.log('   ', f.finding_id, f.severity, f.summary)
    for (const a of run.actions) console.log('   ', a.event_id, a.derived_decision, a.overall, a.checks.map(c => c.dimension+':'+c.result).join(' '))
  }
}
