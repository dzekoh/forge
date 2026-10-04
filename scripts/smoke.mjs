// End-to-end smoke test: launches the built app with a throwaway data folder and
// drives the full simulated workflow (project -> task -> run -> review -> approve).
// Usage: npm run test:e2e   (on Linux without a display: xvfb-run npm run test:e2e)
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'

const root = await mkdtemp(join(tmpdir(), 'forge-smoke-'))
const repoPath = join(root, 'demo-repo')
await mkdir(join(repoPath, '.git'), { recursive: true })
const shots = process.env.FORGE_SMOKE_SHOTS

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', ...(process.env.CI || process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  env: { ...process.env, FORGE_DATA_DIR: join(root, 'data') }
})

try {
  const page = await app.firstWindow()
  page.on('pageerror', (err) => console.error('[renderer]', err))

  // The isolated renderer must not see Node.
  const hasNode = await page.evaluate(() => typeof globalThis.require !== 'undefined' || typeof globalThis.process !== 'undefined')
  if (hasNode) throw new Error('Node APIs leaked into the renderer')

  await page.getByText('Nuovo progetto').first().waitFor()
  await page.getByPlaceholder('Es. my-app').fill('Demo')
  await page.getByPlaceholder('/percorso/assoluto/del/repo').fill(repoPath)
  await page.getByText('Repository Git rilevato').waitFor()
  if (shots) await page.screenshot({ path: join(shots, '1-nuovo-progetto.png') })
  await page.getByRole('button', { name: 'Crea progetto' }).click()

  await page.getByPlaceholder('Nuovo task…').fill('Aggiungi pagina di login')
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  await page.getByRole('button', { name: 'Esegui', exact: true }).click()
  await page.getByText('Revisione richiesta.').waitFor({ timeout: 20000 })
  await page.getByText('forge-sim/aggiungi-pagina-di-login.md', { exact: true }).waitFor()
  if (shots) await page.screenshot({ path: join(shots, '2-revisione.png') })
  await page.getByRole('button', { name: 'Approva' }).click()
  await page.locator('.task-item .status-done').waitFor()
  if (shots) await page.screenshot({ path: join(shots, '3-approvato.png') })

  // A failing scenario ends in the failed state.
  await page.getByPlaceholder('Nuovo task…').fill('Refactor #fail')
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  await page.getByRole('button', { name: 'Esegui', exact: true }).click()
  await page.getByText("L'esecuzione non è andata a buon fine.").waitFor({ timeout: 20000 })
  if (shots) await page.screenshot({ path: join(shots, '4-test-falliti.png') })

  console.log('smoke test: OK')
} finally {
  await app.close()
  await rm(root, { recursive: true, force: true })
}
