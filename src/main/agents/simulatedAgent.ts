import type { AgentInfo, FileChange, RunResult, TestReport } from '@shared/types'
import { AbortedError, type AgentContext, type AgentProvider, type AgentRunInput } from './types'

export interface SimulatedAgentOptions {
  /** Pause between steps, to make the streaming visible in the UI. */
  stepDelayMs?: number
}

/**
 * A fake coding agent that exercises the whole workflow (run, stream, diff,
 * tests, review) without calling any API and without touching the filesystem.
 *
 * Scenarios are picked from the task text:
 *   "#fail"  -> the simulated tests fail
 *   "#error" -> the agent crashes halfway
 *   otherwise the run succeeds with green tests
 */
export class SimulatedAgent implements AgentProvider {
  readonly info: AgentInfo = {
    id: 'simulated',
    name: 'Agente simulato',
    kind: 'simulated',
    description: 'Simula un coding agent: nessuna chiamata API, nessuna modifica al repository.'
  }

  private readonly stepDelayMs: number

  constructor(opts: SimulatedAgentOptions = {}) {
    this.stepDelayMs = opts.stepDelayMs ?? 600
  }

  async run({ task, project }: AgentRunInput, ctx: AgentContext): Promise<RunResult> {
    const text = `${task.title}\n${task.description}`.toLowerCase()
    const slug = slugify(task.title)

    await this.step(ctx, 'step', `Analizzo il task "${task.title}"`)
    await this.step(ctx, 'log', `Repository: ${project.repoPath} (sola lettura simulata)`)
    await this.step(ctx, 'step', 'Pianifico le modifiche')
    await this.step(ctx, 'log', `Piano: aggiungere forge-sim/${slug}.md e un test di esempio`)

    if (text.includes('#error')) {
      await this.step(ctx, 'error', 'Errore simulato durante la generazione delle modifiche')
      throw new Error('Errore simulato (#error nel task)')
    }

    await this.step(ctx, 'step', 'Genero le modifiche')
    const changes = buildChanges(task.title, task.description, slug)
    await this.step(ctx, 'log', `${changes.length} file modificati`)

    await this.step(ctx, 'step', 'Eseguo i test')
    const tests = buildTestReport(slug, text.includes('#fail'))
    await this.step(
      ctx,
      tests.failed ? 'error' : 'log',
      `Test: ${tests.passed} superati, ${tests.failed} falliti`
    )

    return {
      summary: tests.failed
        ? `Modifiche proposte per "${task.title}", ma ${tests.failed} test falliscono.`
        : `Modifiche proposte per "${task.title}". Tutti i test superati.`,
      changes,
      tests
    }
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
  return slug || 'task'
}

function newFileDiff(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`)
  ].join('\n')
}

function buildChanges(title: string, description: string, slug: string): FileChange[] {
  const notePath = `forge-sim/${slug}.md`
  const testPath = `forge-sim/${slug}.test.ts`
  const descLines = description.trim() ? description.trim().split('\n') : ['(nessuna descrizione)']
  return [
    {
      path: notePath,
      diff: newFileDiff(notePath, [`# ${title}`, '', ...descLines, '', '_Generato dall\'agente simulato di Forge._'])
    },
    {
      path: testPath,
      diff: newFileDiff(testPath, [
        "import { describe, it, expect } from 'vitest'",
        '',
        `describe('${slug}', () => {`,
        "  it('funziona', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})'
      ])
    }
  ]
}

function buildTestReport(slug: string, fail: boolean): TestReport {
  const output = fail
    ? [`FAIL forge-sim/${slug}.test.ts`, '  ✗ funziona', '    AssertionError: expected false to be true', '', 'Tests: 2 passed, 1 failed']
    : [`PASS forge-sim/${slug}.test.ts`, '  ✓ funziona', '', 'Tests: 3 passed']
  return { command: 'npm test (simulato)', passed: fail ? 2 : 3, failed: fail ? 1 : 0, output: output.join('\n') }
}
