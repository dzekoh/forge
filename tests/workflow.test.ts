import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunUpdate } from '@shared/types'
import { AgentRegistry } from '../src/main/agents/registry'
import { SimulatedAgent, slugify } from '../src/main/agents/simulatedAgent'
import { Repository } from '../src/main/data/repository'
import { RunManager } from '../src/main/runs/runManager'
import { Workspaces } from '../src/main/workspace/workspaces'

let dir: string
let dataPath: string
let repoPath: string
let agents: AgentRegistry

const open = (): Promise<Repository> =>
  Repository.open(dataPath, { isKnownAgent: (id) => agents.has(id), defaultAgentId: 'simulated' })

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A real git repository with one commit, so worktrees, diffs and merges are exercised for real. */
async function makeRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  sh(path, 'init', '-q', '-b', 'main')
  sh(path, 'config', 'user.name', 'Test')
  sh(path, 'config', 'user.email', 'test@example.com')
  await writeFile(join(path, 'README.md'), '# demo\n')
  sh(path, 'add', '.')
  sh(path, 'commit', '-q', '-m', 'init')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-test-'))
  dataPath = join(dir, 'data', 'forge-data.json')
  repoPath = join(dir, 'repo')
  await makeRepo(repoPath)
  agents = new AgentRegistry().register(new SimulatedAgent({ stepDelayMs: 0 }))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Repository', () => {
  it('persists projects and tasks across reopen', async () => {
    const repo = await open()
    const project = await repo.createProject({ name: '  Demo ', repoPath: '/tmp/demo', testCommand: ' npm test ' })
    await repo.createTask({ projectId: project.id, title: 'Primo task' })

    const reopened = await open()
    expect(reopened.listProjects()).toMatchObject([{ name: 'Demo', testCommand: 'npm test' }])
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
    expect(reopened.interruptedRuns).toHaveLength(1)
  })

  it('migrates version 1 data to the current schema', async () => {
    await mkdir(join(dir, 'data'), { recursive: true })
    const v1 = {
      version: 1,
      projects: [{ id: 'p1', name: 'Old', repoPath: '/tmp/old', description: '', createdAt: 'x', updatedAt: 'x' }],
      tasks: [],
      runs: [
        {
          id: 'r1', taskId: 't1', agentId: 'simulated', status: 'failed', startedAt: 'x', finishedAt: 'x', events: [], error: null,
          result: { summary: 's', changes: [], tests: { command: 'npm test', passed: 2, failed: 1, output: 'o' } }
        }
      ]
    }
    await writeFile(dataPath, JSON.stringify(v1))
    const repo = await open()
    expect(repo.listProjects()[0]?.testCommand).toBe('')
    expect(repo.getRun('r1')).toMatchObject({ workspace: null, review: null, result: { tests: { ok: false } } })
    const saved = JSON.parse(await readFile(dataPath, 'utf8'))
    expect(saved.version).toBe(3)
    expect(saved.settings).toEqual({ agents: {} })
  })

  it('refuses data written by an unknown schema version', async () => {
    await mkdir(join(dir, 'data'), { recursive: true })
    await writeFile(dataPath, JSON.stringify({ version: 99, projects: [], tasks: [], runs: [] }))
    await expect(open()).rejects.toThrow(/non supportata/)
  })
})

describe('Workspaces', () => {
  it('inspects folders', async () => {
    const ws = new Workspaces(join(dir, 'wt'))
    expect(await ws.inspect(repoPath)).toEqual({ exists: true, isGitRepo: true, hasCommits: true })
    expect(await ws.inspect(join(dir, 'missing'))).toEqual({ exists: false, isGitRepo: false, hasCommits: false })
    const empty = join(dir, 'empty')
    await mkdir(empty)
    sh(empty, 'init', '-q')
    expect(await ws.inspect(empty)).toEqual({ exists: true, isGitRepo: true, hasCommits: false })
  })
})

describe('RunManager: worktree, tests and review', () => {
  async function setup(title: string, testCommand = '') {
    const repo = await open()
    const updates: RunUpdate[] = []
    const runs = new RunManager(repo, agents, new Workspaces(join(dir, 'worktrees')), (u) => updates.push(u))
    const project = await repo.createProject({ name: 'Demo', repoPath, testCommand })
    const task = await repo.createTask({ projectId: project.id, title, description: 'Dettagli del task' })
    const run = async () => {
      const started = await runs.start(task.id)
      await runs.wait(started.id)
      return repo.getRun(started.id)!
    }
    return { repo, runs, task, updates, run }
  }

  const branches = (): string[] =>
    sh(repoPath, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)

  it('works in a worktree, never in the checkout, and merges on approve', async () => {
    const { repo, runs, task, updates, run } = await setup('Aggiungi login', 'node -e "process.exit(0)"')
    const finished = await run()

    expect(finished.status).toBe('succeeded')
    expect(finished.workspace).toMatchObject({ active: true, branch: expect.stringMatching(/^forge\/aggiungi-login-/) })
    expect(finished.result?.changes.map((c) => c.path)).toEqual(['forge-sim/aggiungi-login.md'])
    expect(finished.result?.changes[0]?.diff).toContain('+# Aggiungi login')
    expect(finished.result?.tests).toMatchObject({ ok: true, exitCode: 0 })
    expect(updates.at(-1)).toMatchObject({ type: 'finished', task: { status: 'review' } })
    // The user's checkout is untouched until approval.
    expect(existsSync(join(repoPath, 'forge-sim'))).toBe(false)
    expect(sh(repoPath, 'status', '--porcelain')).toBe('')

    const { task: done, run: reviewed } = await runs.review(task.id, 'approve')
    expect(done.status).toBe('done')
    expect(reviewed?.review).toMatchObject({ merged: true, keptBranch: null })
    expect(await readFile(join(repoPath, 'forge-sim/aggiungi-login.md'), 'utf8')).toContain('Dettagli del task')
    expect(sh(repoPath, 'log', '-1', '--format=%s')).toMatch(/^Merge forge\/aggiungi-login-/)
    expect(branches()).toEqual(['main'])
    expect(existsSync(finished.workspace!.path)).toBe(false)
    expect(repo.getTask(task.id).status).toBe('done')
  })

  it('keeps the branch instead of merging into a dirty checkout', async () => {
    const { runs, task, run } = await setup('Modifica sporca')
    await run()
    await writeFile(join(repoPath, 'README.md'), '# modificato a mano\n')

    const { run: reviewed } = await runs.review(task.id, 'approve')
    expect(reviewed?.review).toMatchObject({ merged: false, keptBranch: expect.stringMatching(/^forge\//) })
    expect(branches()).toContain(reviewed!.review!.keptBranch)
    expect(await readFile(join(repoPath, 'README.md'), 'utf8')).toBe('# modificato a mano\n')
    expect(existsSync(join(repoPath, 'forge-sim'))).toBe(false)
  })

  it('reject discards worktree and branch', async () => {
    const { repo, runs, task, run } = await setup('Da scartare')
    const finished = await run()
    const { task: back } = await runs.review(task.id, 'reject')
    expect(back.status).toBe('todo')
    expect(branches()).toEqual(['main'])
    expect(existsSync(finished.workspace!.path)).toBe(false)
    expect(repo.getRun(finished.id)?.workspace?.active).toBe(false)
  })

  it('failing tests mark the task failed and the worktree stays until rejected', async () => {
    const { repo, runs, task, run } = await setup('Refactor', 'echo boom && exit 3')
    const finished = await run()
    expect(finished.status).toBe('failed')
    expect(finished.result?.tests).toMatchObject({ ok: false, exitCode: 3 })
    expect(finished.result?.tests?.output).toContain('boom')
    expect(repo.getTask(task.id).status).toBe('failed')
    await expect(runs.review(task.id, 'approve')).rejects.toThrow(/fallito/)
    await runs.review(task.id, 'reject')
    expect(branches()).toEqual(['main'])
  })

  it('tests run inside the worktree and see the agent changes', async () => {
    const { run } = await setup('Vedi file', 'test -f forge-sim/vedi-file.md')
    expect((await run()).result?.tests?.ok).toBe(true)
  })

  it('an agent crash fails the run and cleans the worktree', async () => {
    const { run } = await setup('Crash #error')
    const finished = await run()
    expect(finished).toMatchObject({ status: 'failed', error: expect.stringMatching(/simulato/) })
    expect(finished.workspace?.active).toBe(false)
    expect(branches()).toEqual(['main'])
  })

  it('a project that is not a git repository fails with a clear error', async () => {
    const repo = await open()
    const runs = new RunManager(repo, agents, new Workspaces(join(dir, 'worktrees')), () => undefined)
    const plain = join(dir, 'plain')
    await mkdir(plain)
    const project = await repo.createProject({ name: 'Plain', repoPath: plain })
    const task = await repo.createTask({ projectId: project.id, title: 't' })
    const started = await runs.start(task.id)
    await runs.wait(started.id)
    expect(repo.getRun(started.id)?.error).toMatch(/non è un repository Git/)
  })

  it('cancelling stops the run, kills the tests and removes the worktree', async () => {
    const { repo, runs, task } = await setup('Lento', 'node -e "setTimeout(() => {}, 60000)"')
    const started = await runs.start(task.id)
    // Wait until the test command is running, then cancel.
    for (let i = 0; i < 200 && !runs.get(started.id)?.events.some((e) => e.message.startsWith('Eseguo i test')); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    runs.cancel(started.id)
    await runs.wait(started.id)
    expect(repo.getRun(started.id)?.status).toBe('cancelled')
    expect(repo.getTask(task.id).status).toBe('todo')
    expect(branches()).toEqual(['main'])
  })

  it('a new run discards the previous unreviewed worktree', async () => {
    const { runs, task, run } = await setup('Ripeti')
    const first = await run()
    await runs.start(task.id).then((r) => runs.wait(r.id))
    expect(existsSync(first.workspace!.path)).toBe(false)
    expect(branches()).toHaveLength(2)
  })

  it('removing a task cleans its worktrees', async () => {
    const { runs, task, run } = await setup('Da eliminare')
    const finished = await run()
    await runs.removeTask(task.id)
    expect(existsSync(finished.workspace!.path)).toBe(false)
    expect(branches()).toEqual(['main'])
  })

  it('cannot start or delete a running task', async () => {
    const { runs, task } = await setup('Occupato')
    const started = await runs.start(task.id)
    await expect(runs.start(task.id)).rejects.toThrow(/già in esecuzione/)
    await expect(runs.removeTask(task.id)).rejects.toThrow(/esecuzione/)
    await runs.wait(started.id)
  })
})

describe('slugify', () => {
  it('produces safe branch and file names', () => {
    expect(slugify('Città: perché sì!')).toBe('citta-perche-si')
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('***')).toBe('task')
  })
})
