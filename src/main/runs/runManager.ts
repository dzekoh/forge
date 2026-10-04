import type { ReviewDecision, Run, RunReview, RunUpdate, Task, TaskStatus } from '@shared/types'
import type { AgentRegistry } from '../agents/registry'
import { slugify } from '../agents/simulatedAgent'
import { AbortedError } from '../agents/types'
import type { Repository } from '../data/repository'
import { requireId, ValidationError } from '../data/validate'
import { runTests } from '../workspace/testRunner'
import type { Workspaces } from '../workspace/workspaces'

const MAX_EVENTS_PER_RUN = 500
const MAX_TEST_LINES_STREAMED = 200

interface ActiveRun {
  controller: AbortController
  done: Promise<void>
  working: Run
}

/**
 * Orchestrates a task run end to end:
 *   worktree -> agent -> diff -> tests -> review (merge or discard).
 * One run per task at a time; `start` returns as soon as the run is registered
 * and the rest happens in the background, streamed through `publish`.
 */
export class RunManager {
  private readonly active = new Map<string, ActiveRun>()

  constructor(
    private readonly repo: Repository,
    private readonly agents: AgentRegistry,
    private readonly workspaces: Workspaces,
    private readonly publish: (update: RunUpdate) => void,
    private readonly opts: { testTimeoutMs?: number } = {}
  ) {}

  async start(taskId: string): Promise<Run> {
    const task = this.repo.getTask(requireId(taskId, 'taskId'))
    if (task.status === 'running') throw new ValidationError('Il task è già in esecuzione')
    if (!this.agents.has(task.agentId)) throw new ValidationError(`Agente non disponibile: ${task.agentId}`)
    const agent = this.agents.get(task.agentId)
    const project = this.repo.getProject(task.projectId)

    // A new run replaces the previous attempt: its unreviewed worktree is discarded.
    await this.discardWorkspace(task.lastRunId)

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
        emit('step', 'Creo il worktree isolato')
        working.workspace = await this.workspaces.create(project.repoPath, run.id, slugify(task.title))
        await this.repo.setRunWorkspace(run.id, working.workspace)
        emit('log', `Branch ${working.workspace.branch} da ${working.workspace.baseCommit.slice(0, 8)}`)

        const outcome = await agent.run(
          { task: { ...task }, project: { ...project }, workspacePath: working.workspace.path },
          { signal: controller.signal, emit }
        )
        if (controller.signal.aborted) throw new AbortedError()

        emit('step', 'Raccolgo le modifiche')
        const changes = await this.workspaces.diff(working.workspace)
        emit('log', changes.length ? `${changes.length} file modificati` : 'Nessun file modificato')

        let tests = null
        if (project.testCommand) {
          emit('step', `Eseguo i test: ${project.testCommand}`)
          let streamed = 0
          tests = await runTests({
            cwd: working.workspace.path,
            command: project.testCommand,
            signal: controller.signal,
            timeoutMs: this.opts.testTimeoutMs,
            onLine: (line) => {
              if (streamed++ < MAX_TEST_LINES_STREAMED) emit('log', line)
            }
          })
          if (tests.ok) emit('log', 'Test superati')
          else emit('error', `Test falliti (${tests.exitCode === null ? 'timeout' : `exit ${tests.exitCode}`})`)
        } else {
          emit('log', 'Nessun comando di test configurato per il progetto')
        }

        working.result = { summary: outcome.summary, changes, tests }
        working.status = tests && !tests.ok ? 'failed' : 'succeeded'
        taskStatus = working.status === 'succeeded' ? 'review' : 'failed'
      } catch (err) {
        if (err instanceof AbortedError || controller.signal.aborted) {
          working.status = 'cancelled'
          working.error = 'Esecuzione annullata'
          taskStatus = 'todo'
        } else {
          working.status = 'failed'
          working.error = err instanceof Error ? err.message : String(err)
          emit('error', working.error)
          taskStatus = 'failed'
        }
        // Nothing to review after a cancel or a crash: drop the worktree and its branch.
        if (working.workspace?.active) {
          await this.workspaces.remove(project.repoPath, working.workspace, { deleteBranch: true })
          working.workspace = { ...working.workspace, active: false }
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

  /**
   * Human decision on a task's last run.
   *  approve: commit on the run branch, merge it into the repo's current branch
   *           when safe (otherwise keep the branch for a manual merge); task -> done.
   *  reject:  discard worktree and branch; task -> todo.
   */
  async review(taskId: string, decision: ReviewDecision): Promise<{ task: Task; run: Run | null }> {
    const task = this.repo.getTask(requireId(taskId, 'taskId'))
    if (decision !== 'approve' && decision !== 'reject') throw new ValidationError('Decisione non valida')
    if (task.status !== 'review' && task.status !== 'failed') throw new ValidationError('Il task non è in revisione')
    if (decision === 'approve' && task.status !== 'review') {
      throw new ValidationError('Non si può approvare un task fallito')
    }
    const nextStatus: TaskStatus = decision === 'approve' ? 'done' : 'todo'
    const run = task.lastRunId ? this.repo.getRun(task.lastRunId) : null
    if (!run) return { task: { ...(await this.repo.setTaskStatus(task.id, nextStatus)) }, run: null }

    const project = this.repo.getProject(task.projectId)
    const ws = run.workspace?.active ? run.workspace : null
    const review: RunReview = { decision, at: new Date().toISOString(), merged: false, keptBranch: null, message: '' }

    if (!ws) {
      review.message = decision === 'approve' ? 'Nessun worktree da unire' : 'Modifiche scartate'
    } else if (decision === 'reject') {
      await this.workspaces.remove(project.repoPath, ws, { deleteBranch: true })
      review.message = 'Modifiche scartate'
    } else if (!(await this.workspaces.commit(ws, `Forge: ${task.title}`))) {
      await this.workspaces.remove(project.repoPath, ws, { deleteBranch: true })
      review.message = 'Nessuna modifica da unire'
    } else {
      // The branch must not be checked out in the worktree while it is merged.
      await this.workspaces.remove(project.repoPath, ws, { deleteBranch: false })
      const merge = await this.workspaces.merge(project.repoPath, ws, `Merge ${ws.branch}: ${task.title}`)
      if (merge.merged) {
        await this.workspaces.deleteMergedBranch(project.repoPath, ws)
        review.merged = true
        review.message = merge.message
      } else {
        review.keptBranch = ws.branch
        review.message = `${merge.message}: il branch ${ws.branch} resta da unire a mano`
      }
    }
    const result = await this.repo.recordReview(run.id, review, nextStatus)
    return { task: { ...result.task }, run: structuredClone(result.run) }
  }

  async removeTask(taskId: string): Promise<void> {
    const task = this.repo.getTask(requireId(taskId, 'taskId'))
    if (task.status === 'running') throw new ValidationError('Task in esecuzione: attendi o annulla')
    for (const run of this.repo.listRuns(task.id)) await this.discardWorkspace(run.id)
    await this.repo.removeTask(task.id)
  }

  async removeProject(projectId: string): Promise<void> {
    const project = this.repo.getProject(requireId(projectId, 'projectId'))
    const tasks = this.repo.listTasks(project.id)
    if (tasks.some((t) => t.status === 'running')) throw new ValidationError('Il progetto ha un task in esecuzione')
    for (const task of tasks) for (const run of this.repo.listRuns(task.id)) await this.discardWorkspace(run.id)
    await this.repo.removeProject(project.id)
  }

  /** Cleans up worktrees left by runs interrupted by a crash or forced quit. */
  async recoverInterrupted(): Promise<void> {
    for (const run of this.repo.interruptedRuns) {
      await this.discardWorkspace(run.id).catch((err) => console.error('[forge] pulizia worktree fallita:', err))
    }
    this.repo.interruptedRuns = []
  }

  private async discardWorkspace(runId: string | null): Promise<void> {
    const run = runId ? this.repo.getRun(runId) : null
    if (!run?.workspace?.active) return
    const project = this.repo.getProject(this.repo.getTask(run.taskId).projectId)
    await this.workspaces.remove(project.repoPath, run.workspace, { deleteBranch: true })
    await this.repo.setRunWorkspace(run.id, { ...run.workspace, active: false })
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
