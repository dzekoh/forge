// Domain model shared by main, preload and renderer.
// Plain serializable data only: everything here crosses the IPC boundary.

export type Id = string
export type IsoDate = string

export interface Project {
  id: Id
  name: string
  /** Absolute path of the local Git repository. Agents never write here directly: they work in a worktree. */
  repoPath: string
  description: string
  /** Shell command run in the run's worktree to test the changes (e.g. "npm ci && npm test"). Empty = no tests. */
  testCommand: string
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
  ok: boolean
  /** Null when the process was killed (timeout or cancel). */
  exitCode: number | null
  durationMs: number
  /** Tail of stdout + stderr. */
  output: string
}

/** Isolated checkout where a run's agent works: a git worktree on its own branch. */
export interface RunWorkspace {
  path: string
  branch: string
  baseCommit: string
  /** False once the worktree has been removed (after review or cleanup). */
  active: boolean
}

export interface RunReview {
  decision: ReviewDecision
  at: IsoDate
  /** True when the branch was merged into the repository's current branch. */
  merged: boolean
  /** Branch left in the repository for the user to merge by hand, if any. */
  keptBranch: string | null
  message: string
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
  workspace: RunWorkspace | null
  result: RunResult | null
  review: RunReview | null
  error: string | null
}

/** User settings for a command-line agent. Credentials are never stored by Forge: the CLI uses its own login. */
export interface AgentSettings {
  /** Executable name or absolute path (no arguments), e.g. "claude" or "/usr/local/bin/codex". */
  command: string
  /** Model passed to the CLI; empty = the CLI's default. */
  model: string
}

export interface AgentInfo {
  id: string
  name: string
  kind: 'simulated' | 'cli' | 'api'
  description: string
  /** Current settings for configurable agents, null for the others. */
  settings: AgentSettings | null
}

export interface AgentCheck {
  available: boolean
  version: string | null
  error: string | null
}

export interface RepoInfo {
  exists: boolean
  isGitRepo: boolean
  /** Git repo with at least one commit: required to create worktrees. */
  hasCommits: boolean
}

// Inputs accepted by the API. Validated again in the main process.
export interface NewProjectInput {
  name: string
  repoPath: string
  description?: string
  testCommand?: string
}

export interface ProjectPatch {
  name?: string
  repoPath?: string
  description?: string
  testCommand?: string
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
