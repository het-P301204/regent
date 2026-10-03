/**
 * Writes scenarios/NN-slug.json and scenarios/acme-demo.json from @regent/core,
 * so the datasets can be inspected, edited and fed to the CLI or the import page.
 *   node scripts/export-scenarios.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoRecords, SCENARIOS } from '../packages/core/src/index.ts'

const dir = join(import.meta.dirname, '..', 'scenarios')
mkdirSync(dir, { recursive: true })
for (const s of SCENARIOS) {
  const { records, ...meta } = s
  writeFileSync(join(dir, `${String(s.number).padStart(2, '0')}-${s.slug}.json`), `${JSON.stringify({ ...meta, records }, null, 2)}\n`)
}
writeFileSync(join(dir, 'acme-demo.json'), `${JSON.stringify({ description: 'Acme AI Operations demo environment (synthetic).', records: demoRecords() }, null, 2)}\n`)
console.log(`wrote ${SCENARIOS.length + 1} files to ${dir}`)
