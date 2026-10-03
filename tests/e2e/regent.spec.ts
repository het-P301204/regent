import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The Definition of Done as a user journey, against the production build.
 * Selectors are roles and visible text, the way a person finds things.
 */

async function signIn(page: Page, persona: 'analyst' | 'admin' | 'auditor' | 'viewer' = 'analyst') {
  // Suppress the first-run onboarding so it does not cover the page under test.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('regent.onboarded', '1')
    } catch {
      /* ignore */
    }
  })
  const res = await page.request.post('/api/auth/demo', { data: { persona } })
  expect(res.ok()).toBeTruthy()
  await page.request.post('/api/datasets/reset-demo', { headers: { 'x-regent-csrf': ((await res.json()) as { csrf_token: string }).csrf_token } })
}

test('landing page explains the product and links to the demo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know who authorized')
  await expect(page.getByText('Trace delegation.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Explore the demo/ }).first()).toBeVisible()
  await expect(page.getByRole('img', { name: /Authority flow/ }).first()).toBeVisible()
})

test('unauthenticated console redirects to sign-in, and a demo persona signs in', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/signin/)
  await page.addInitScript(() => localStorage.setItem('regent.onboarded', '1'))
  await page.getByRole('button', { name: /analyst/i }).first().click()
  await expect(page).toHaveURL(/\/app/)
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible()
})

test('command center shows populated metrics from the demo environment', async ({ page }) => {
  await signIn(page)
  await page.goto('/app')
  await expect(page.getByText('Authority integrity').first()).toBeVisible()
  await expect(page.getByText('Authority violations')).toBeVisible()
  await expect(page.getByText('Recent findings')).toBeVisible()
})

test('trace an action to its human principal and locate the broken edge', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/chains/evt-0042')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ReconciliationAgent')
  await expect(page.getByText(/Authorized by Maya Chen/)).toBeVisible()
  await expect(page.getByText('Why is this a finding?')).toBeVisible()
  await expect(page.getByText('← UNGRANTED').first()).toBeVisible()
  await expect(page.getByText('FIRST BROKEN EDGE').locator('visible=true').first()).toBeVisible()
  await expect(page.getByRole('img', { name: 'Authority flow' }).first()).toBeVisible()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
})

test('replay an action and jump to the violation', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/chains/evt-0042?tab=replay')
  await page.getByRole('button', { name: /Jump to violation/ }).click()
  await expect(page.getByText('VIOLATION', { exact: true })).toBeVisible()
})

test('findings list opens a finding with its authority delta and evidence', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/findings')
  await page.locator('a[href*="/app/findings/REG-AMP-"]').first().click()
  await expect(page).toHaveURL(/\/app\/findings\/REG-AMP-/)
  await expect(page.getByText(/ledger\.write/).first()).toBeVisible()
  await expect(page.getByText(/not signatures/i).first()).toBeVisible()
})

test('scenario lab loads a scenario that produces exactly its expected findings', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/scenarios')
  // Scenario 4 is the fourth card in the numbered curriculum.
  await expect(page.getByText('Authority amplification').first()).toBeVisible()
  await page.getByRole('button', { name: /Load scenario/ }).nth(3).click()
  await expect(page.getByText(/matches expected/i).first()).toBeVisible()
})

test('import validates pasted JSON before analysis', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/import')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await page.getByRole('button', { name: /^Validate/ }).first().click()
  await expect(page.getByText(/accepted/i).first()).toBeVisible()
})

test('command palette searches across agents', async ({ page }) => {
  await signIn(page)
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('recon')
  await expect(page.getByRole('option', { name: /ReconciliationAgent/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('g')
  await page.keyboard.press('f')
  await expect(page).toHaveURL(/\/app\/findings/)
})

test('exports and the security report are downloadable', async ({ page }) => {
  await signIn(page, 'auditor')
  const csv = await page.request.get('/api/exports/findings.csv')
  expect(csv.ok()).toBeTruthy()
  expect(await csv.text()).toMatch(/^finding_id,type,rule_id/)
  const pdf = await page.request.get('/api/reports/security.pdf')
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
})

test('chain detail stays usable on a phone @mobile', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/chains/evt-0042')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('list', { name: /Delegation chain, root to resource/ }).first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('chain builder verifies a built chain and the engine flags amplification', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/builder')
  await page.getByLabel(/template/i).first().selectOption({ label: 'Sub-agent amplifies' })
  await page.getByRole('button', { name: /VERIFY CHAIN/i }).click()
  await expect(page.getByText('Authority amplification').first()).toBeVisible()
  await expect(page.getByText(/Verification of the built chain/)).toBeVisible()
})

test('time travel shows who held authority at an instant', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/time-travel?at=2026-10-03T10:30:00.000Z')
  await expect(page.getByText('OperationsAgent').first()).toBeVisible()
})

test('chain diff compares two chains', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/diff?left=evt-0015&right=evt-0042')
  await expect(page.getByText(/ledger\.write/).first()).toBeVisible()
})

test('GRC controls are derived from the run and the evidence package is offered', async ({ page }) => {
  await signIn(page, 'auditor')
  await page.goto('/app/grc')
  await expect(page.getByText('Agent action attribution').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /evidence package/i }).first()).toBeEnabled()
})

test('a viewer cannot run verification', async ({ page }) => {
  await signIn(page, 'viewer')
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Run verification/ })).toHaveCount(0)
})

test('theme toggles to warm paper and persists', async ({ page }) => {
  await signIn(page)
  await page.goto('/app')
  await page.getByRole('button', { name: /Switch to light theme/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
