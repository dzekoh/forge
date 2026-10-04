// Domain model shared by main, preload and renderer.
// Plain serializable data only: everything here crosses the IPC boundary.

export type Id = string
export type IsoDate = string

export interface Project {
  id: Id
  name: string
  /** Absolute path of the local repository. Forge never writes here in the MVP. */
  repoPath: string
  description: string
  createdAt: IsoDate
  updatedAt: IsoDate
}

export type TaskStatus = 'todo' | 'running' | 'review' | 'done' | 'failed'

export interface Task {
  id: Id
  projectId: Id
  title: string
  description: string
  status: TaskStatus
  /** Agent provider used to run the task (e.g. "simulated"). */
  agentId: string
  lastRunId: Id | null
  createdAt: IsoDate
  updatedAt: IsoDate
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export type RunEventKind = 'step' | 'log' | 'error'

export interface RunEvent {
  at: IsoDate
  kind: RunEventKind
  message: string
}

export interface FileChange {
  path: string
  /** Unified diff for this file. */
  diff: string
}

export interface TestReport {
  command: string
  passed: number
  failed: number
  output: string
}

export interface RunResult {
  summary: string
  changes: FileChange[]
  tests: TestReport | null
}

export interface Run {
  id: Id
  taskId: Id
  agentId: string
  status: RunStatus
  startedAt: IsoDate
  finishedAt: IsoDate | null
  events: RunEvent[]
  result: RunResult | null
  error: string | null
}

export interface AgentInfo {
  id: string
  name: string
  kind: 'simulated' | 'cli' | 'api'
  description: string
}

export interface RepoInfo {
  exists: boolean
  isGitRepo: boolean
}

// Inputs accepted by the API. Validated again in the main process.
export interface NewProjectInput {
  name: string
  repoPath: string
  description?: string
}

export interface ProjectPatch {
  name?: string
  repoPath?: string
  description?: string
}

export interface NewTaskInput {
  projectId: Id
  title: string
  description?: string
  agentId?: string
}

export interface TaskPatch {
  title?: string
  description?: string
  agentId?: string
}

export type ReviewDecision = 'approve' | 'reject'

/** Pushed from main to renderer while a run progresses. */
export type RunUpdate =
  | { type: 'event'; runId: Id; taskId: Id; event: RunEvent }
  | { type: 'finished'; run: Run; task: Task }
