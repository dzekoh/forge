import type { AgentCheck, AgentInfo, AgentSettings, Project, RunEventKind, Task } from '@shared/types'

export interface AgentContext {
  /** Aborted when the user cancels the run. Providers must stop promptly. */
  signal: AbortSignal
  /** Streams progress to the UI and the run log. */
  emit(kind: RunEventKind, message: string): void
}

export interface AgentRunInput {
  task: Task
  project: Project
  /**
   * Absolute path of the run's isolated git worktree. This is the only place
   * an agent may write; the project's own checkout is never touched.
   */
  workspacePath: string
  /** Effective settings (defaults + user overrides) for configurable agents. */
  settings: AgentSettings | null
}

export interface AgentOutcome {
  /** Short human-readable account of what the agent did. */
  summary: string
}

/**
 * Contract every coding agent implements: the simulated agent today,
 * Claude / Codex adapters later. The agent edits files in the worktree;
 * Forge then collects the diff, runs the project's tests and hands the
 * result to the user for review.
 */
export interface AgentProvider {
  /** Static description; `settings` is filled in from the user's configuration when listed. */
  readonly info: Omit<AgentInfo, 'settings'>
  /** Present for configurable agents (command-line ones). */
  readonly defaultSettings?: AgentSettings
  run(input: AgentRunInput, ctx: AgentContext): Promise<AgentOutcome>
  /** Tells whether the agent can run on this machine (e.g. its CLI is installed). */
  check?(settings: AgentSettings): Promise<AgentCheck>
}

export class AbortedError extends Error {
  constructor() {
    super('Esecuzione annullata')
    this.name = 'AbortedError'
  }
}
