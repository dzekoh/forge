// End-to-end smoke test: launches the built app with a throwaway data folder and
// drives the full simulated workflow against a real throwaway git repository:
// project -> task -> run in a worktree -> tests -> review -> approve and merge.
// Usage: npm run test:e2e   (on Linux without a display: xvfb-run npm run test:e2e)
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'

const root = await mkdtemp(join(tmpdir(), 'forge-smoke-'))
const repoPath = join(root, 'demo-repo')
const git = (...args) => execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' })
await mkdir(repoPath, { recursive: true })
git('init', '-q', '-b', 'main')
git('config', 'user.name', 'Smoke')
git('config', 'user.email', 'smoke@example.com')
await writeFile(join(repoPath, 'README.md'), '# demo\n')
git('add', '.')
git('commit', '-q', '-m', 'init')
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
  await page.getByPlaceholder('Es. npm ci && npm test').fill('test -f forge-sim/aggiungi-pagina-di-login.md')
  if (shots) await page.screenshot({ path: join(shots, '1-nuovo-progetto.png') })
  await page.getByRole('button', { name: 'Crea progetto' }).click()

  await page.getByPlaceholder('Nuovo task…').fill('Aggiungi pagina di login')
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  await page.getByRole('button', { name: 'Esegui', exact: true }).click()
  await page.getByText('Revisione richiesta.').waitFor({ timeout: 20000 })
  await page.getByText('forge-sim/aggiungi-pagina-di-login.md', { exact: true }).waitFor()
  if (shots) await page.screenshot({ path: join(shots, '2-revisione.png') })
  await page.getByText('Test superati').waitFor()
  await page.getByRole('button', { name: 'Approva e unisci' }).click()
  await page.locator('.task-item .status-done').waitFor()
  await page.getByText('Approvato: Unito in main').waitFor()
  if (shots) await page.screenshot({ path: join(shots, '3-approvato.png') })
  const merged = await readFile(join(repoPath, 'forge-sim/aggiungi-pagina-di-login.md'), 'utf8')
  if (!merged.includes('Aggiungi pagina di login')) throw new Error('Approved change not merged into the repo')

  // A failing test command ends in the failed state, and nothing reaches the checkout.
  await page.getByRole('button', { name: 'Modifica', exact: true }).click()
  await page.getByPlaceholder('Es. npm ci && npm test').fill('echo "1 test fallito" && exit 1')
  await page.getByRole('button', { name: 'Salva' }).click()
  await page.getByPlaceholder('Nuovo task…').fill('Refactor')
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  await page.getByRole('button', { name: 'Esegui', exact: true }).click()
  await page.getByText(/L'esecuzione non è andata a buon fine/).waitFor({ timeout: 20000 })
  if (shots) await page.screenshot({ path: join(shots, '4-test-falliti.png') })
  await page.getByRole('button', { name: 'Scarta e rimetti in coda' }).click()
  await page.getByText('Rifiutato: Modifiche scartate').waitFor()
  const branches = git('branch', '--format=%(refname:short)').trim()
  if (branches !== 'main') throw new Error(`Unexpected branches left: ${branches}`)
  if (git('status', '--porcelain').trim()) throw new Error('Repository checkout is dirty')

  console.log('smoke test: OK')
} finally {
  await app.close()
  await rm(root, { recursive: true, force: true })
}
