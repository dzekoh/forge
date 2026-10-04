import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Channels } from '@shared/api'
import type { AgentRegistry } from './agents/registry'
import type { Repository } from './data/repository'
import { requireAbsolutePath } from './data/validate'
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

  handle(Channels.agentsList, () => agents.list())

  handle(Channels.runsStart, (taskId: string) => runs.start(taskId))
  handle(Channels.runsCancel, (runId: string) => runs.cancel(runId))
  handle(Channels.runsGet, (runId: string) => runs.get(runId))
  handle(Channels.runsListForTask, (taskId: string) => repo.listRuns(taskId))
}
