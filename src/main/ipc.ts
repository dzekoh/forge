import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Channels } from '@shared/api'
import type { AgentSettings } from '@shared/types'
import type { AgentRegistry } from './agents/registry'
import type { Repository } from './data/repository'
import { requireAbsolutePath, requireString, ValidationError } from './data/validate'
import type { RunManager } from './runs/runManager'
import type { Workspaces } from './workspace/workspaces'

interface Services {
  repo: Repository
  agents: AgentRegistry
  runs: RunManager
  workspaces: Workspaces
  /** URL the renderer is allowed to be loaded from; IPC from anything else is refused. */
  isTrustedSender: (url: string) => boolean
}

export function registerIpc({ repo, agents, runs, workspaces, isTrustedSender }: Services): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.senderFrame?.url ?? '')) throw new Error('Mittente IPC non autorizzato')
      return fn(...(args as A))
    })
  }

  handle(Channels.projectsList, () => repo.listProjects())
  handle(Channels.projectsCreate, (input) => repo.createProject(input as never))
  handle(Channels.projectsUpdate, (id: string, patch) => repo.updateProject(id, patch as never))
  handle(Channels.projectsRemove, (id: string) => runs.removeProject(id))
  handle(Channels.projectsPickFolder, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options = { properties: ['openDirectory' as const], title: 'Seleziona il repository' }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(Channels.projectsInspectRepo, (path: unknown) =>
    workspaces.inspect(requireAbsolutePath(path, 'Percorso', isAbsolute))
  )

  handle(Channels.tasksList, (projectId: string) => repo.listTasks(projectId))
  handle(Channels.tasksCreate, (input) => repo.createTask(input as never))
  handle(Channels.tasksUpdate, (id: string, patch) => repo.updateTask(id, patch as never))
  handle(Channels.tasksRemove, (id: string) => runs.removeTask(id))
  handle(Channels.tasksReview, (id: string, decision) => runs.review(id, decision as never))

  const settingsFor = (id: string, defaults: AgentSettings): AgentSettings => repo.getAgentSettings(id, defaults)
  const configurable = (id: unknown) => {
    const agent = agents.get(requireString(id, 'Agente', { max: 64 }))
    if (!agent.defaultSettings) throw new ValidationError(`${agent.info.name} non ha impostazioni`)
    return { agent, defaults: agent.defaultSettings }
  }

  handle(Channels.agentsList, () => agents.list(settingsFor))
  handle(Channels.agentsCheck, async (id: unknown) => {
    const { agent, defaults } = configurable(id)
    return agent.check
      ? agent.check(settingsFor(agent.info.id, defaults))
      : { available: true, version: null, error: null }
  })
  handle(Channels.agentsConfigure, async (id: unknown, patch: unknown) => {
    const { agent, defaults } = configurable(id)
    await repo.updateAgentSettings(agent.info.id, defaults, patch)
    return agents.list(settingsFor).find((a) => a.id === agent.info.id)!
  })

  handle(Channels.runsStart, (taskId: string) => runs.start(taskId))
  handle(Channels.runsCancel, (runId: string) => runs.cancel(runId))
  handle(Channels.runsGet, (runId: string) => runs.get(runId))
  handle(Channels.runsListForTask, (taskId: string) => repo.listRuns(taskId))
}
