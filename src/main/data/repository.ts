import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  NewProjectInput,
  NewTaskInput,
  Project,
  ProjectPatch,
  Run,
  RunReview,
  RunWorkspace,
  Task,
  TaskPatch,
  TaskStatus
} from '@shared/types'
import { JsonFile } from './jsonFile'
import {
  ValidationError,
  optionalString,
  requireAbsolutePath,
  requireId,
  requireObject,
  requireString
} from './validate'

export const SCHEMA_VERSION = 2
const MAX_RUNS_PER_TASK = 10

export interface ForgeData {
  version: number
  projects: Project[]
  tasks: Task[]
  runs: Run[]
}

export const emptyData = (): ForgeData => ({ version: SCHEMA_VERSION, projects: [], tasks: [], runs: [] })

/** Upgrades data written by older versions of Forge. Each step bumps the version by one. */
export function migrate(raw: { version: number } & Record<string, unknown>): ForgeData {
  const data = raw as unknown as ForgeData & { version: number }
  if (data.version === 1) {
    for (const p of data.projects) p.testCommand ??= ''
    for (const r of data.runs) {
      r.workspace ??= null
      r.review ??= null
      const tests = r.result?.tests as unknown as { command: string; failed?: number; output: string } | null
      if (r.result && tests && !('ok' in tests)) {
        r.result.tests = { command: tests.command, ok: !tests.failed, exitCode: null, durationMs: 0, output: tests.output }
      }
    }
    data.version = 2
  }
  if (data.version !== SCHEMA_VERSION) throw new Error(`Versione dati non supportata: ${data.version}`)
  return data
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} non trovato: ${id}`)
    this.name = 'NotFoundError'
  }
}

export interface RepositoryOptions {
  isKnownAgent: (id: string) => boolean
  defaultAgentId: string
  now?: () => Date
}

/**
 * In-memory state backed by a single JSON file. Every mutation is validated,
 * applied in memory and then persisted. Fine for the MVP's data volume; the
 * class is the only place that knows about storage, so moving to SQLite later
 * only touches this file.
 */
export class Repository {
  private data: ForgeData = emptyData()
  private readonly now: () => Date
  /** Runs found "running" at startup (crash or forced quit); their worktrees need cleanup. */
  interruptedRuns: Run[] = []

  private constructor(
    private readonly file: JsonFile<ForgeData>,
    private readonly opts: RepositoryOptions
  ) {
    this.now = opts.now ?? (() => new Date())
  }

  static async open(path: string, opts: RepositoryOptions): Promise<Repository> {
    const repo = new Repository(new JsonFile(path, emptyData), opts)
    const loaded = await repo.file.read()
    const version = loaded.version
    repo.data = migrate(loaded as unknown as { version: number } & Record<string, unknown>)
    if (version !== SCHEMA_VERSION) await repo.save()
    await repo.recoverInterruptedRuns()
    return repo
  }

  private stamp(): string {
    return this.now().toISOString()
  }

  private save(): Promise<void> {
    return this.file.write(this.data)
  }

  /** Runs left "running" by a crash or quit cannot resume: mark them and free their tasks. */
  private async recoverInterruptedRuns(): Promise<void> {
    let changed = false
    for (const run of this.data.runs) {
      if (run.status !== 'running') continue
      run.status = 'interrupted'
      run.finishedAt = this.stamp()
      run.error = "Esecuzione interrotta alla chiusura dell'app"
      this.interruptedRuns.push(run)
      const task = this.data.tasks.find((t) => t.id === run.taskId)
      if (task && task.status === 'running') {
        task.status = 'todo'
        task.updatedAt = this.stamp()
      }
      changed = true
    }
    if (changed) await this.save()
  }

  // ---- Projects -----------------------------------------------------------

  listProjects(): Project[] {
    return [...this.data.projects].sort((a, b) => a.name.localeCompare(b.name))
  }

  getProject(id: string): Project {
    const project = this.data.projects.find((p) => p.id === id)
    if (!project) throw new NotFoundError('Progetto', id)
    return project
  }

  async createProject(input: NewProjectInput): Promise<Project> {
    const obj = requireObject(input, 'progetto')
    const ts = this.stamp()
    const project: Project = {
      id: randomUUID(),
      name: requireString(obj.name, 'Nome', { max: 100 }),
      repoPath: requireAbsolutePath(obj.repoPath, 'Percorso repository', isAbsolute),
      description: optionalString(obj.description, 'Descrizione') ?? '',
      testCommand: optionalString(obj.testCommand, 'Comando test', { max: 2000 }) ?? '',
      createdAt: ts,
      updatedAt: ts
    }
    this.data.projects.push(project)
    await this.save()
    return project
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<Project> {
    const project = this.getProject(requireId(id))
    const obj = requireObject(patch, 'modifica')
    if (obj.name !== undefined) project.name = requireString(obj.name, 'Nome', { max: 100 })
    if (obj.repoPath !== undefined) {
      project.repoPath = requireAbsolutePath(obj.repoPath, 'Percorso repository', isAbsolute)
    }
    const description = optionalString(obj.description, 'Descrizione')
    if (description !== undefined) project.description = description
    const testCommand = optionalString(obj.testCommand, 'Comando test', { max: 2000 })
    if (testCommand !== undefined) project.testCommand = testCommand
    project.updatedAt = this.stamp()
    await this.save()
    return project
  }

  async removeProject(id: string): Promise<void> {
    const project = this.getProject(requireId(id))
    if (this.data.tasks.some((t) => t.projectId === project.id && t.status === 'running')) {
      throw new ValidationError('Il progetto ha un task in esecuzione')
    }
    const taskIds = new Set(this.data.tasks.filter((t) => t.projectId === project.id).map((t) => t.id))
    this.data.projects = this.data.projects.filter((p) => p.id !== project.id)
    this.data.tasks = this.data.tasks.filter((t) => !taskIds.has(t.id))
    this.data.runs = this.data.runs.filter((r) => !taskIds.has(r.taskId))
    await this.save()
  }

  // ---- Tasks --------------------------------------------------------------

  listTasks(projectId: string): Task[] {
    requireId(projectId, 'projectId')
    return this.data.tasks
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getTask(id: string): Task {
    const task = this.data.tasks.find((t) => t.id === id)
    if (!task) throw new NotFoundError('Task', id)
    return task
  }

  private requireAgent(value: unknown): string {
    if (value === undefined) return this.opts.defaultAgentId
    const id = requireString(value, 'Agente', { max: 64 })
    if (!this.opts.isKnownAgent(id)) throw new ValidationError(`Agente sconosciuto: ${id}`)
    return id
  }

  async createTask(input: NewTaskInput): Promise<Task> {
    const obj = requireObject(input, 'task')
    const project = this.getProject(requireId(obj.projectId, 'projectId'))
    const ts = this.stamp()
    const task: Task = {
      id: randomUUID(),
      projectId: project.id,
      title: requireString(obj.title, 'Titolo', { max: 200 }),
      description: optionalString(obj.description, 'Descrizione', { max: 20000 }) ?? '',
      status: 'todo',
      agentId: this.requireAgent(obj.agentId),
      lastRunId: null,
      createdAt: ts,
      updatedAt: ts
    }
    this.data.tasks.push(task)
    await this.save()
    return task
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const task = this.getTask(requireId(id))
    if (task.status === 'running') throw new ValidationError('Task in esecuzione: attendi o annulla')
    const obj = requireObject(patch, 'modifica')
    if (obj.title !== undefined) task.title = requireString(obj.title, 'Titolo', { max: 200 })
    const description = optionalString(obj.description, 'Descrizione', { max: 20000 })
    if (description !== undefined) task.description = description
    if (obj.agentId !== undefined) task.agentId = this.requireAgent(obj.agentId)
    task.updatedAt = this.stamp()
    await this.save()
    return task
  }

  async removeTask(id: string): Promise<void> {
    const task = this.getTask(requireId(id))
    if (task.status === 'running') throw new ValidationError('Task in esecuzione: attendi o annulla')
    this.data.tasks = this.data.tasks.filter((t) => t.id !== task.id)
    this.data.runs = this.data.runs.filter((r) => r.taskId !== task.id)
    await this.save()
  }

  async setTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = this.getTask(id)
    task.status = status
    task.updatedAt = this.stamp()
    await this.save()
    return task
  }

  // ---- Runs ---------------------------------------------------------------

  getRun(id: string): Run | null {
    return this.data.runs.find((r) => r.id === id) ?? null
  }

  listRuns(taskId: string): Run[] {
    requireId(taskId, 'taskId')
    return this.data.runs
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async beginRun(taskId: string, agentId: string): Promise<{ run: Run; task: Task }> {
    const task = this.getTask(taskId)
    if (task.status === 'running') throw new ValidationError('Il task è già in esecuzione')
    const run: Run = {
      id: randomUUID(),
      taskId,
      agentId,
      status: 'running',
      startedAt: this.stamp(),
      finishedAt: null,
      events: [],
      workspace: null,
      result: null,
      review: null,
      error: null
    }
    this.data.runs.push(run)
    task.status = 'running'
    task.lastRunId = run.id
    task.updatedAt = this.stamp()
    this.pruneRuns(taskId)
    await this.save()
    return { run, task }
  }

  async finishRun(run: Run, taskStatus: TaskStatus): Promise<{ run: Run; task: Task }> {
    const stored = this.getRun(run.id)
    if (!stored) throw new NotFoundError('Esecuzione', run.id)
    Object.assign(stored, run, { finishedAt: this.stamp() })
    const task = this.getTask(run.taskId)
    task.status = taskStatus
    task.updatedAt = this.stamp()
    await this.save()
    return { run: stored, task }
  }

  async setRunWorkspace(runId: string, workspace: RunWorkspace | null): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new NotFoundError('Esecuzione', runId)
    run.workspace = workspace
    await this.save()
    return run
  }

  async recordReview(runId: string, review: RunReview, taskStatus: TaskStatus): Promise<{ run: Run; task: Task }> {
    const run = this.getRun(runId)
    if (!run) throw new NotFoundError('Esecuzione', runId)
    run.review = review
    if (run.workspace) run.workspace.active = false
    const task = this.getTask(run.taskId)
    task.status = taskStatus
    task.updatedAt = this.stamp()
    await this.save()
    return { run, task }
  }

  private pruneRuns(taskId: string): void {
    const runs = this.listRuns(taskId)
    const drop = new Set(runs.slice(MAX_RUNS_PER_TASK).map((r) => r.id))
    if (drop.size) this.data.runs = this.data.runs.filter((r) => !drop.has(r.id))
  }
}
