import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const BIN = join(ROOT, 'apps', 'cli', 'bin', 'regent.js')

function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

describe('regent CLI', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'regent-cli-'))

  it('analyzes the documented example and saves state for later commands', () => {
    const r = run(['analyze', join(ROOT, 'examples', 'events.json')], cwd)
    expect(r.code).toBe(0)
    expect(r.out).toContain('Delegation Chain Verification')
    expect(r.out).toContain('Input digest')
    const f = run(['findings'], cwd)
    expect(f.out).toContain('Unattributable action')
  })

  it('verifies a ChainSpec and reports amplification', () => {
    const r = run(['verify', join(ROOT, 'examples', 'chain.json')], cwd)
    expect(r.out).toContain('Authority amplification detected')
    expect(r.out).toContain('Unauthorized expansion:')
    expect(r.out).toMatch(/customer\.write/)
  })

  it('replays an event and marks the first violation', () => {
    run(['scenario', 'action-time-authorization'], cwd)
    const r = run(['replay', 'evt-s11-read'], cwd)
    expect(r.code).toBe(0)
    expect(r.out).toContain('First violation at step')
  })

  it('exits 1 when findings meet --fail-on, for CI gating', () => {
    expect(run(['analyze', join(ROOT, 'scenarios', '04-authority-amplification.json'), '--fail-on', 'critical'], cwd).code).toBe(1)
    expect(run(['analyze', join(ROOT, 'scenarios', '01-valid-single-agent.json'), '--fail-on', 'low'], cwd).code).toBe(0)
  })

  it('exports machine-readable findings', () => {
    run(['analyze', join(ROOT, 'scenarios', 'acme-demo.json')], cwd)
    const r = run(['export', 'out/report.json'], cwd)
    expect(r.code).toBe(0)
    const j = JSON.parse(readFileSync(join(cwd, 'out', 'report.json'), 'utf8'))
    expect(j.findings[0].schema).toBe('regent.finding/v1')
  })

  it('fails cleanly on bad input', () => {
    const r = run(['analyze', 'does-not-exist.json'], cwd)
    expect(r.code).toBe(2)
    expect(r.err).toContain('file not found')
    expect(execFileSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' })).toContain('Usage')
  })
})
