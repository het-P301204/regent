import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * npm run dev — the API (node --watch) and the Vite dev server side by side,
 * without a shell or a process-manager dependency. Ctrl+C stops both.
 * Open http://localhost:5173 (Vite proxies /api to the API on :8787).
 */
const root = path.resolve(import.meta.dirname, '..')
const node = process.execPath
// Resolve vite wherever npm hoisted it.
const vite = path.join(path.dirname(createRequire(path.join(root, 'apps', 'web', 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js')

const procs = [
  { name: 'api', child: spawn(node, ['--watch-path=apps/api/src', '--watch-path=packages/core/src', 'apps/api/src/index.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }) },
  { name: 'web', child: spawn(node, [vite], { cwd: path.join(root, 'apps', 'web'), stdio: ['ignore', 'pipe', 'pipe'] }) },
]

for (const { name, child } of procs) {
  const prefix = name === 'api' ? '\x1b[38;5;173m[api]\x1b[0m ' : '\x1b[38;5;108m[web]\x1b[0m '
  const write = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) stream.write(prefix + line + '\n')
  }
  child.stdout?.on('data', write(process.stdout))
  child.stderr?.on('data', write(process.stderr))
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`)
    for (const p of procs) if (p.child !== child) p.child.kill()
    process.exit(code ?? 0)
  })
}

const stop = () => {
  for (const p of procs) p.child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
