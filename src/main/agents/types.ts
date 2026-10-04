import type { AgentInfo, Project, RunEventKind, RunResult, Task } from '@shared/types'

export interface AgentContext {
  /** Aborted when the user cancels the run. Providers must stop promptly. */
  signal: AbortSignal
  /** Streams progress to the UI and the run log. */
  emit(kind: RunEventKind, message: string): void
}

export interface AgentRunInput {
  task: Task
  project: Project
}

/**
 * Contract every coding agent implements: the simulated agent today,
 * Claude / Codex adapters later. A provider returns *proposed* changes as
 * diffs; applying them to a repository is a separate, user-approved step.
 */
export interface AgentProvider {
  readonly info: AgentInfo
  run(input: AgentRunInput, ctx: AgentContext): Promise<RunResult>
}

export class AbortedError extends Error {
  constructor() {
    super('Esecuzione annullata')
    this.name = 'AbortedError'
  }
}
