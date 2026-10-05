// Makes sure the Electron binary is present before starting the app.
// npm downloads it in electron's postinstall script, which does not run when
// install scripts are disabled (ignore-scripts) or the download failed; in
// that case electron-vite only says "Electron uninstall". Here we fetch it.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
let electronDir
try {
  electronDir = dirname(require.resolve('electron/package.json'))
} catch {
  console.error('[forge] Il pacchetto "electron" non è installato: esegui "npm install".')
  process.exit(1)
}

const pathFile = join(electronDir, 'path.txt')
const installed = () =>
  existsSync(pathFile) && existsSync(join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim()))

if (!installed()) {
  console.log('[forge] Binario di Electron mancante: lo scarico ora…')
  const res = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
  if (res.status !== 0 || !installed()) {
    console.error(
      '[forge] Download di Electron non riuscito. Controlla la connessione/proxy, poi riprova con\n' +
        '        "rm -rf node_modules/electron && npm install electron".'
    )
    process.exit(1)
  }
  console.log('[forge] Electron pronto.')
}
