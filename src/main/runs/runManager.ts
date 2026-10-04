import type { Run, RunUpdate, TaskStatus } from '@shared/types'
import type { AgentRegistry } from '../agents/registry'
import { AbortedError } from '../agents/types'
import type { Repository } from '../data/repository'
import { requireId, ValidationError } from '../data/validate'

const MAX_EVENTS_PER_RUN = 500

/**
 * Starts agent runs, streams their events and records the outcome.
 * One run per task at a time; runs execute in the background and
 * `start` returns as soon as the run is registered.
 */
export class RunManager {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void>; working: Run }>()

  constructor(
    private readonly repo: Repository,
    private readonly agents: AgentRegistry,
    private readonly publish: (update: RunUpdate) => void
  ) {}

  async start(taskId: string): Promise<Run> {
    const task = this.repo.getTask(requireId(taskId, 'taskId'))
    if (!this.agents.has(task.agentId)) throw new ValidationError(`Agente non disponibile: ${task.agentId}`)
    const agent = this.agents.get(task.agentId)
    const project = this.repo.getProject(task.projectId)
    const { run } = await this.repo.beginRun(task.id, agent.info.id)

    const controller = new AbortController()
    const working: Run = structuredClone(run)
    const emit = (kind: Run['events'][number]['kind'], message: string): void => {
      if (working.events.length >= MAX_EVENTS_PER_RUN) return
      const event = { at: new Date().toISOString(), kind, message }
      working.events.push(event)
      this.publish({ type: 'event', runId: run.id, taskId: task.id, event })
    }

    const done = (async () => {
      let taskStatus: TaskStatus
      try {
        const result = await agent.run({ task: { ...task }, project: { ...project } }, { signal: controller.signal, emit })
        working.result = result
        working.status = result.tests && result.tests.failed > 0 ? 'failed' : 'succeeded'
        taskStatus = working.status === 'succeeded' ? 'review' : 'failed'
      } catch (err) {
        if (err instanceof AbortedError || controller.signal.aborted) {
          working.status = 'cancelled'
          working.error = 'Esecuzione annullata'
          taskStatus = 'todo'
        } else {
          working.status = 'failed'
          working.error = err instanceof Error ? err.message : String(err)
          taskStatus = 'failed'
        }
      }
      const finished = await this.repo.finishRun(working, taskStatus)
      this.publish({ type: 'finished', run: structuredClone(finished.run), task: { ...finished.task } })
    })()
      .catch((err) => console.error(`[forge] run ${run.id} non registrato:`, err))
      .finally(() => this.active.delete(run.id))

    this.active.set(run.id, { controller, done, working })
    return structuredClone(run)
  }

  cancel(runId: string): void {
    this.active.get(requireId(runId, 'runId'))?.controller.abort()
  }

  /** Latest state of a run, including events streamed so far while it is still running. */
  get(runId: string): Run | null {
    const id = requireId(runId, 'runId')
    const live = this.active.get(id)
    return live ? structuredClone(live.working) : this.repo.getRun(id)
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }

  /** Waits for a run to settle. Used by tests and on shutdown. */
  async wait(runId: string): Promise<void> {
    await this.active.get(runId)?.done
  }

  async cancelAll(): Promise<void> {
    const pending = [...this.active.values()]
    pending.forEach((r) => r.controller.abort())
    await Promise.allSettled(pending.map((r) => r.done))
  }
}
