import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels, type ForgeApi } from '@shared/api'
import type { RunUpdate } from '@shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

// Narrow, typed API: the renderer gets these functions and nothing else from Electron or Node.
const api: ForgeApi = {
  projects: {
    list: () => invoke(Channels.projectsList),
    create: (input) => invoke(Channels.projectsCreate, input),
    update: (id, patch) => invoke(Channels.projectsUpdate, id, patch),
    remove: (id) => invoke(Channels.projectsRemove, id),
    pickFolder: () => invoke(Channels.projectsPickFolder),
    inspectRepo: (path) => invoke(Channels.projectsInspectRepo, path)
  },
  tasks: {
    list: (projectId) => invoke(Channels.tasksList, projectId),
    create: (input) => invoke(Channels.tasksCreate, input),
    update: (id, patch) => invoke(Channels.tasksUpdate, id, patch),
    remove: (id) => invoke(Channels.tasksRemove, id),
    review: (id, decision) => invoke(Channels.tasksReview, id, decision)
  },
  agents: {
    list: () => invoke(Channels.agentsList),
    check: (id) => invoke(Channels.agentsCheck, id),
    configure: (id, patch) => invoke(Channels.agentsConfigure, id, patch)
  },
  runs: {
    start: (taskId) => invoke(Channels.runsStart, taskId),
    cancel: (runId) => invoke(Channels.runsCancel, runId),
    get: (runId) => invoke(Channels.runsGet, runId),
    listForTask: (taskId) => invoke(Channels.runsListForTask, taskId),
    onUpdate: (listener) => {
      const handler = (_event: IpcRendererEvent, update: RunUpdate): void => listener(update)
      ipcRenderer.on(Channels.runsUpdate, handler)
      return () => ipcRenderer.removeListener(Channels.runsUpdate, handler)
    }
  }
}

contextBridge.exposeInMainWorld('forge', api)
