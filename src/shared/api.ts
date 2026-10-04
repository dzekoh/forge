import type {
  AgentInfo,
  Id,
  NewProjectInput,
  NewTaskInput,
  Project,
  ProjectPatch,
  RepoInfo,
  ReviewDecision,
  Run,
  RunUpdate,
  Task,
  TaskPatch
} from './types'

/**
 * The only surface the renderer can use, exposed by the preload script as `window.forge`.
 * Every method maps 1:1 to an IPC channel in `Channels`.
 */
export interface ForgeApi {
  projects: {
    list(): Promise<Project[]>
    create(input: NewProjectInput): Promise<Project>
    update(id: Id, patch: ProjectPatch): Promise<Project>
    remove(id: Id): Promise<void>
    pickFolder(): Promise<string | null>
    inspectRepo(path: string): Promise<RepoInfo>
  }
  tasks: {
    list(projectId: Id): Promise<Task[]>
    create(input: NewTaskInput): Promise<Task>
    update(id: Id, patch: TaskPatch): Promise<Task>
    remove(id: Id): Promise<void>
    review(id: Id, decision: ReviewDecision): Promise<Task>
  }
  agents: {
    list(): Promise<AgentInfo[]>
  }
  runs: {
    start(taskId: Id): Promise<Run>
    cancel(runId: Id): Promise<void>
    get(runId: Id): Promise<Run | null>
    listForTask(taskId: Id): Promise<Run[]>
    /** Subscribe to live run updates. Returns an unsubscribe function. */
    onUpdate(listener: (update: RunUpdate) => void): () => void
  }
}

export const Channels = {
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',
  projectsPickFolder: 'projects:pickFolder',
  projectsInspectRepo: 'projects:inspectRepo',
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksRemove: 'tasks:remove',
  tasksReview: 'tasks:review',
  agentsList: 'agents:list',
  runsStart: 'runs:start',
  runsCancel: 'runs:cancel',
  runsGet: 'runs:get',
  runsListForTask: 'runs:listForTask',
  runsUpdate: 'runs:update'
} as const
