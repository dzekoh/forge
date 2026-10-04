import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeCodeAgent } from '../src/main/agents/cli/claudeCodeAgent'
import { CodexAgent } from '../src/main/agents/cli/codexAgent'
import { buildTaskPrompt } from '../src/main/agents/cli/prompt'
import { AgentRegistry } from '../src/main/agents/registry'
import { Repository } from '../src/main/data/repository'
import { RunManager } from '../src/main/runs/runManager'
import { Workspaces } from '../src/main/workspace/workspaces'

const FAKE_CLAUDE = resolve(__dirname, 'fixtures/fake-claude.mjs')
const FAKE_CODEX = resolve(__dirname, 'fixtures/fake-codex.mjs')

let dir: string
let repoPath: string
let logPath: string

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-cli-'))
  repoPath = join(dir, 'repo')
  logPath = join(dir, 'fake.log')
  process.env.FAKE_LOG = logPath
  await mkdir(repoPath)
  sh(repoPath, 'init', '-q', '-b', 'main')
  sh(repoPath, 'config', 'user.name', 'Test')
  sh(repoPath, 'config', 'user.email', 'test@example.com')
  await writeFile(join(repoPath, 'README.md'), '# demo\n')
  sh(repoPath, 'add', '.')
  sh(repoPath, 'commit', '-q', '-m', 'init')
})

afterEach(async () => {
  delete process.env.FAKE_LOG
  await rm(dir, { recursive: true, force: true })
})

async function setup(agentId: 'claude-code' | 'codex', title: string, model = '') {
  const agents = new AgentRegistry()
    .register(new ClaudeCodeAgent({ timeoutMs: 20_000 }))
    .register(new CodexAgent({ timeoutMs: 20_000 }))
  const repo = await Repository.open(join(dir, 'data', 'forge-data.json'), {
    isKnownAgent: (id) => agents.has(id),
    defaultAgentId: 'claude-code'
  })
  const agent = agents.get(agentId)
  await repo.updateAgentSettings(agentId, agent.defaultSettings!, {
    command: agentId === 'codex' ? FAKE_CODEX : FAKE_CLAUDE,
    model
  })
  const runs = new RunManager(repo, agents, new Workspaces(join(dir, 'worktrees')), () => undefined)
  const project = await repo.createProject({ name: 'Demo', repoPath, testCommand: 'test -f README.md' })
  const task = await repo.createTask({ projectId: project.id, title, agentId })
  const run = async () => {
    const started = await runs.start(task.id)
    await runs.wait(started.id)
    return repo.getRun(started.id)!
  }
  return { repo, runs, task, run }
}

const lastCall = async (): Promise<{ args: string[]; prompt: string; cwd: string }> => {
  const lines = (await readFile(logPath, 'utf8')).trim().split('\n')
  return JSON.parse(lines.at(-1)!)
}

describe('Claude Code adapter', () => {
  it('runs headless in the worktree and produces a real diff', async () => {
    const { run } = await setup('claude-code', 'Aggiungi output', 'fake-sonnet')
    const finished = await run()

    expect(finished.status).toBe('succeeded')
    expect(finished.result?.summary).toBe('Creato agent-output.md per Aggiungi output')
    expect(finished.result?.changes.map((c) => c.path)).toEqual(['agent-output.md'])
    expect(finished.result?.tests?.ok).toBe(true)
    const messages = finished.events.map((e) => e.message)
    expect(messages).toContain('Modello: fake-sonnet')
    expect(messages).toContain('Write: agent-output.md')
    expect(messages.some((m) => m.includes('costo $0.0123'))).toBe(true)

    const call = await lastCall()
    expect(call.cwd).toBe(finished.workspace!.path)
    expect(call.args).toEqual([
      '--print', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits', '--no-session-persistence', '--model', 'fake-sonnet'
    ])
    expect(call.prompt).toContain('## Task\nAggiungi output')
    // Nothing touched the user's checkout.
    expect(existsSync(join(repoPath, 'agent-output.md'))).toBe(false)
  })

  it('an error result fails the run with the CLI message', async () => {
    const { run } = await setup('claude-code', 'Troppo lungo #fail')
    const finished = await run()
    expect(finished.status).toBe('failed')
    expect(finished.error).toBe('Claude Code: Limite di turni raggiunto')
    expect(finished.workspace?.active).toBe(false)
  })

  it('a crash reports stderr', async () => {
    const { run } = await setup('claude-code', 'Boom #crash')
    expect((await run()).error).toMatch(/fatal: something exploded/)
  })

  it('a missing CLI gives an actionable error', async () => {
    const { repo, run } = await setup('claude-code', 'Senza CLI')
    await repo.updateAgentSettings('claude-code', { command: 'claude', model: '' }, { command: join(dir, 'nope') })
    expect((await run()).error).toMatch(/non trovato: installa Claude Code/)
  })

  it('cancel kills the CLI and cleans up', async () => {
    const { repo, runs, task } = await setup('claude-code', 'Lento #hang')
    const started = await runs.start(task.id)
    for (let i = 0; i < 300 && !runs.get(started.id)?.events.some((e) => e.message.startsWith('Modello')); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    runs.cancel(started.id)
    await runs.wait(started.id)
    expect(repo.getRun(started.id)?.status).toBe('cancelled')
    expect(sh(repoPath, 'branch', '--format=%(refname:short)')).toBe('main')
  })

  it('check reports the installed version', async () => {
    const agent = new ClaudeCodeAgent()
    expect(await agent.check({ command: FAKE_CLAUDE, model: '' })).toEqual({
      available: true,
      version: '9.9.9 (Claude Code)',
      error: null
    })
    expect(await agent.check({ command: join(dir, 'nope'), model: '' })).toMatchObject({
      available: false,
      error: 'Comando non trovato'
    })
  })
})

describe('Codex adapter', () => {
  it('runs codex exec with the workspace-write sandbox', async () => {
    const { run } = await setup('codex', 'Saluta')
    const finished = await run()

    expect(finished.status).toBe('succeeded')
    expect(finished.result?.summary).toBe('Aggiunto codex-output.txt')
    expect(finished.result?.changes.map((c) => c.path)).toEqual(['codex-output.txt'])
    const messages = finished.events.map((e) => e.message)
    expect(messages).toContain('$ ls')
    expect(messages).toContain('Modifica file: codex-output.txt')
    expect(messages).toContain('Avviso: Reconnecting... 1/5')
    expect(messages).toContain('Token: 120 in · 30 out')

    const call = await lastCall()
    expect(call.args).toEqual([
      'exec', '--json', '--sandbox', 'workspace-write', '--cd', finished.workspace!.path,
      '--ephemeral', '--color', 'never', '-'
    ])
  })

  it('turn.failed fails the run', async () => {
    const { run } = await setup('codex', 'Senza quota #fail')
    expect((await run()).error).toBe('Codex: quota esaurita')
  })
})

describe('settings', () => {
  it('validates and persists agent settings', async () => {
    const repo = await Repository.open(join(dir, 'data', 'forge-data.json'), {
      isKnownAgent: () => true,
      defaultAgentId: 'x'
    })
    const defaults = { command: 'claude', model: '' }
    expect(repo.getAgentSettings('claude-code', defaults)).toEqual(defaults)
    await repo.updateAgentSettings('claude-code', defaults, { model: 'claude-sonnet-5-5' })
    expect(repo.getAgentSettings('claude-code', defaults)).toEqual({ command: 'claude', model: 'claude-sonnet-5-5' })
    await expect(repo.updateAgentSettings('claude-code', defaults, { model: 'x; rm -rf /' })).rejects.toThrow(/Modello/)
    await expect(repo.updateAgentSettings('claude-code', defaults, { command: '' })).rejects.toThrow(/Comando/)
  })
})

describe('prompt', () => {
  it('describes the task, the worktree rules and the test command', () => {
    const prompt = buildTaskPrompt(
      { title: 'Fix login', description: 'Il bottone non va' } as never,
      { name: 'App', description: '', testCommand: 'npm test' } as never
    )
    expect(prompt).toContain('## Task\nFix login\n\nIl bottone non va')
    expect(prompt).toContain('Do not commit')
    expect(prompt).toContain('`npm test`')
  })
})
