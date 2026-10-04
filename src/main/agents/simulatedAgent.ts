import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentInfo } from '@shared/types'
import { AbortedError, type AgentContext, type AgentOutcome, type AgentProvider, type AgentRunInput } from './types'

export interface SimulatedAgentOptions {
  /** Pause between steps, to make the streaming visible in the UI. */
  stepDelayMs?: number
}

/**
 * A fake coding agent that exercises the whole workflow (worktree, stream,
 * diff, tests, review, merge) without calling any API. It writes a single
 * Markdown note inside the run's worktree, never in the project checkout.
 *
 * Writing "#error" in the task makes it crash halfway.
 */
export class SimulatedAgent implements AgentProvider {
  readonly info: Omit<AgentInfo, 'settings'> = {
    id: 'simulated',
    name: 'Agente simulato',
    kind: 'simulated',
    description: 'Simula un coding agent senza chiamate API: scrive una nota Markdown nel worktree isolato.'
  }

  private readonly stepDelayMs: number

  constructor(opts: SimulatedAgentOptions = {}) {
    this.stepDelayMs = opts.stepDelayMs ?? 600
  }

  async run({ task, workspacePath }: AgentRunInput, ctx: AgentContext): Promise<AgentOutcome> {
    const text = `${task.title}\n${task.description}`.toLowerCase()
    const relPath = `forge-sim/${slugify(task.title)}.md`

    await this.step(ctx, 'step', `Analizzo il task "${task.title}"`)
    await this.step(ctx, 'step', 'Pianifico le modifiche')
    await this.step(ctx, 'log', `Piano: aggiungere ${relPath}`)

    if (text.includes('#error')) {
      await this.step(ctx, 'error', 'Errore simulato durante la generazione delle modifiche')
      throw new Error('Errore simulato (#error nel task)')
    }

    await this.step(ctx, 'step', 'Scrivo le modifiche nel worktree')
    const description = task.description.trim() || '(nessuna descrizione)'
    await mkdir(join(workspacePath, 'forge-sim'), { recursive: true })
    await writeFile(
      join(workspacePath, relPath),
      `# ${task.title}\n\n${description}\n\n_Generato dall'agente simulato di Forge._\n`,
      'utf8'
    )
    ctx.emit('log', `Scritto ${relPath}`)

    return { summary: `Aggiunta la nota ${relPath} per "${task.title}".` }
  }

  private async step(ctx: AgentContext, kind: 'step' | 'log' | 'error', message: string): Promise<void> {
    await sleep(this.stepDelayMs, ctx.signal)
    ctx.emit(kind, message)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortedError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new AbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug || 'task'
}
