import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunUpdate } from '@shared/types'
import { AgentRegistry } from '../src/main/agents/registry'
import { SimulatedAgent, slugify } from '../src/main/agents/simulatedAgent'
import { Repository } from '../src/main/data/repository'
import { RunManager } from '../src/main/runs/runManager'

let dir: string
let dataPath: string
let agents: AgentRegistry

const open = (): Promise<Repository> =>
  Repository.open(dataPath, { isKnownAgent: (id) => agents.has(id), defaultAgentId: 'simulated' })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-test-'))
  dataPath = join(dir, 'forge-data.json')
  agents = new AgentRegistry().register(new SimulatedAgent({ stepDelayMs: 0 }))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Repository', () => {
  it('persists projects and tasks across reopen', async () => {
    const repo = await open()
    const project = await repo.createProject({ name: '  Demo ', repoPath: '/tmp/demo' })
    await repo.createTask({ projectId: project.id, title: 'Primo task' })

    const reopened = await open()
    expect(reopened.listProjects().map((p) => p.name)).toEqual(['Demo'])
    const [task] = reopened.listTasks(project.id)
    expect(task).toMatchObject({ title: 'Primo task', status: 'todo', agentId: 'simulated' })
  })

  it('rejects invalid input', async () => {
    const repo = await open()
    await expect(repo.createProject({ name: '', repoPath: '/tmp/x' })).rejects.toThrow(/Nome/)
    await expect(repo.createProject({ name: 'x', repoPath: 'relative/path' })).rejects.toThrow(/assoluto/)
    const p = await repo.createProject({ name: 'x', repoPath: '/tmp/x' })
    await expect(repo.createTask({ projectId: p.id, title: 't', agentId: 'nope' })).rejects.toThrow(/sconosciuto/)
    await expect(repo.createTask({ projectId: 'missing', title: 't' })).rejects.toThrow(/non trovato/)
  })

  it('removing a project removes its tasks', async () => {
    const repo = await open()
    const p = await repo.createProject({ name: 'x', repoPath: '/tmp/x' })
    await repo.createTask({ projectId: p.id, title: 't' })
    await repo.removeProject(p.id)
    expect(repo.listProjects()).toEqual([])
    expect(repo.listTasks(p.id)).toEqual([])
  })

  it('marks runs left running by a crash as interrupted', async () => {
    const repo = await open()
    const p = await repo.createProject({ name: 'x', repoPath: '/tmp/x' })
    const t = await repo.createTask({ projectId: p.id, title: 't' })
    await repo.beginRun(t.id, 'simulated')

    const reopened = await open()
    expect(reopened.getTask(t.id).status).toBe('todo')
    expect(reopened.listRuns(t.id)[0]?.status).toBe('interrupted')
  })

  it('refuses data written by an unknown schema version', async () => {
    await writeFile(dataPath, JSON.stringify({ version: 99, projects: [], tasks: [], runs: [] }))
    await expect(open()).rejects.toThrow(/non supportata/)
  })
})

describe('RunManager with the simulated agent', () => {
  async function setup(title: string) {
    const repo = await open()
    const updates: RunUpdate[] = []
    const runs = new RunManager(repo, agents, (u) => updates.push(u))
    const project = await repo.createProject({ name: 'Demo', repoPath: '/tmp/demo' })
    const task = await repo.createTask({ projectId: project.id, title })
    return { repo, runs, task, updates }
  }

  it('runs a task to review with diff and green tests, then approves it', async () => {
    const { repo, runs, task, updates } = await setup('Aggiungi login')
    const run = await runs.start(task.id)
    expect(repo.getTask(task.id).status).toBe('running')
    await expect(runs.start(task.id)).rejects.toThrow(/già in esecuzione/)

    await runs.wait(run.id)
    const finished = repo.getRun(run.id)!
    expect(finished.status).toBe('succeeded')
    expect(finished.result?.changes.map((c) => c.path)).toEqual([
      'forge-sim/aggiungi-login.md',
      'forge-sim/aggiungi-login.test.ts'
    ])
    expect(finished.result?.tests?.failed).toBe(0)
    expect(finished.events.length).toBeGreaterThan(3)
    expect(updates.filter((u) => u.type === 'event').length).toBe(finished.events.length)
    expect(updates.at(-1)).toMatchObject({ type: 'finished', task: { status: 'review' } })

    expect((await repo.reviewTask(task.id, 'approve')).status).toBe('done')
    // Persisted, not just in memory.
    const saved = JSON.parse(await readFile(dataPath, 'utf8'))
    expect(saved.tasks[0].status).toBe('done')
  })

  it('failing tests mark the task failed; reject puts it back in the queue', async () => {
    const { repo, runs, task } = await setup('Refactor #fail')
    const run = await runs.start(task.id)
    await runs.wait(run.id)
    expect(repo.getRun(run.id)?.status).toBe('failed')
    expect(repo.getTask(task.id).status).toBe('failed')
    await expect(repo.reviewTask(task.id, 'approve')).rejects.toThrow()
    expect((await repo.reviewTask(task.id, 'reject')).status).toBe('todo')
  })

  it('an agent crash is recorded as a failed run', async () => {
    const { repo, runs, task } = await setup('Crash #error')
    const run = await runs.start(task.id)
    await runs.wait(run.id)
    expect(repo.getRun(run.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/simulato/) })
  })

  it('cancelling stops the run and frees the task', async () => {
    agents = new AgentRegistry().register(new SimulatedAgent({ stepDelayMs: 50 }))
    const { repo, runs, task } = await setup('Lento')
    const run = await runs.start(task.id)
    runs.cancel(run.id)
    await runs.wait(run.id)
    expect(repo.getRun(run.id)?.status).toBe('cancelled')
    expect(repo.getTask(task.id).status).toBe('todo')
  })

  it('cannot delete a running task', async () => {
    const { repo, runs, task } = await setup('Occupato')
    const run = await runs.start(task.id)
    await expect(repo.removeTask(task.id)).rejects.toThrow(/esecuzione/)
    await runs.wait(run.id)
  })
})

describe('slugify', () => {
  it('produces safe file names', () => {
    expect(slugify('Città: perché sì!')).toBe('citta-perche-si')
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('***')).toBe('task')
  })
})
