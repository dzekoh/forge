import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { Channels } from '@shared/api'
import type { RunUpdate } from '@shared/types'
import { ClaudeCodeAgent } from './agents/cli/claudeCodeAgent'
import { CodexAgent } from './agents/cli/codexAgent'
import { AgentRegistry } from './agents/registry'
import { SimulatedAgent } from './agents/simulatedAgent'
import { Repository } from './data/repository'
import { registerIpc } from './ipc'
import { RunManager } from './runs/runManager'
import { Workspaces } from './workspace/workspaces'

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererFileUrl = pathToFileURL(rendererFile).href

/** Data lives in the OS user-data folder unless FORGE_DATA_DIR overrides it (tests, portable use). */
const dataDir = process.env['FORGE_DATA_DIR'] || app.getPath('userData')

function isTrustedUrl(url: string): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl)
  return url.split('#')[0] === rendererFileUrl
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Forge',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // The renderer never navigates or opens windows; external links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(rendererFile)
  return win
}

function broadcast(update: RunUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Channels.runsUpdate, update)
  }
}

async function main(): Promise<void> {
  await app.whenReady()

  // No permission (camera, notifications, ...) is ever needed by the UI.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  const agents = new AgentRegistry()
    .register(new SimulatedAgent())
    .register(new ClaudeCodeAgent())
    .register(new CodexAgent())
  const repo = await Repository.open(join(dataDir, 'forge-data.json'), {
    isKnownAgent: (id) => agents.has(id),
    defaultAgentId: 'simulated'
  })
  const workspaces = new Workspaces(join(dataDir, 'worktrees'))
  const runs = new RunManager(repo, agents, workspaces, broadcast)
  await runs.recoverInterrupted()
  registerIpc({ repo, agents, runs, workspaces, isTrustedSender: isTrustedUrl })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void runs.cancelAll().finally(() => app.quit())
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

main().catch((err) => {
  console.error('[forge] avvio fallito:', err)
  app.exit(1)
})
