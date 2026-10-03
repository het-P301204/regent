import { DEMO_ORGANIZATION, demoRecords } from '@regent/core'
import type { Config } from './config.ts'
import type { Db } from './db/driver.ts'
import { hashPassword, purgeCredentials } from './auth.ts'
import type { WorkspaceService } from './services/workspace.ts'

export const DEMO_ORG_ID = 'org_acme'
/** Real accounts never share an organization with the password-less demo personas. */
export const PRIMARY_ORG_ID = 'org_primary'

/** Demo personas sign in without a password, and only when REGENT_DEMO_MODE is on. */
export const DEMO_PERSONAS = [
  { id: 'usr_demo_admin', email: 'admin@acme.example', display_name: 'Rowan Hale', role: 'admin', title: 'Security architect' },
  { id: 'usr_demo_analyst', email: 'analyst@acme.example', display_name: 'Sam Ortiz', role: 'analyst', title: 'Security engineer' },
  { id: 'usr_demo_auditor', email: 'auditor@acme.example', display_name: 'Jordan Lee', role: 'auditor', title: 'GRC auditor' },
  { id: 'usr_demo_viewer', email: 'viewer@acme.example', display_name: 'Casey Wu', role: 'viewer', title: 'AI platform engineer' },
] as const

export async function bootstrap(db: Db, config: Config, workspace: WorkspaceService): Promise<{ seeded: boolean }> {
  const [existing] = await db.query<{ id: string }>('SELECT id FROM organizations WHERE id = $1', [DEMO_ORG_ID])
  let seeded = false
  if (!existing) {
    await db.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [DEMO_ORG_ID, DEMO_ORGANIZATION.name, DEMO_ORGANIZATION.slug])
    seeded = true
  }
  for (const p of DEMO_PERSONAS) {
    await db.query(
      `INSERT INTO users (id, organization_id, email, display_name, role, is_demo_persona) VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO NOTHING`, [p.id, DEMO_ORG_ID, p.email, p.display_name, p.role])
  }
  if (config.adminEmail && config.adminPassword) {
    if (config.adminPassword.length < 12) throw new Error('REGENT_ADMIN_PASSWORD must be at least 12 characters.')
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Primary organization', 'primary') ON CONFLICT (id) DO NOTHING", [PRIMARY_ORG_ID])
    const hash = await hashPassword(config.adminPassword)
    await db.query(
      `INSERT INTO users (id, organization_id, email, display_name, role, password_hash) VALUES ('usr_admin', $1, $2, 'Administrator', 'admin', $3)
       ON CONFLICT (id) DO UPDATE SET email = $2, password_hash = $3, organization_id = $1`, [PRIMARY_ORG_ID, config.adminEmail.toLowerCase(), hash])
  }
  await purgeCredentials(db, config.demoMode)
  if (!(await workspace.demoDatasetId(DEMO_ORG_ID))) {
    await workspace.createDataset(DEMO_ORG_ID, null, {
      name: `${DEMO_ORGANIZATION.name} — demo environment`,
      source: 'demo',
      metadata: { description: 'Fictional organisation, synthetic agent activity on 03 Oct 2026. Every identity and credential is invented.', generator: '@regent/core demoRecords()' },
      records: demoRecords(),
    })
    seeded = true
  }
  return { seeded }
}
