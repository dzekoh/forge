import type { AgentCheck, AgentInfo, AgentSettings } from '@shared/types'
import { childEnv, runProcess } from '../../process/runProcess'
import type { AgentContext, AgentOutcome, AgentProvider, AgentRunInput } from '../types'
import { buildTaskPrompt } from './prompt'

const DEFAULT_TIMEOUT_MS = 30 * 60_000
const MAX_MESSAGE_CHARS = 2_000

/** Accumulates what a CLI reported while its JSON stream is parsed. */
export interface StreamState {
  /** Last message from the agent, used as the run summary. */
  summary: string
  /** Set when the stream itself reports a failure. */
  failure: string | null
}

export interface CliAgentOptions {
  timeoutMs?: number
}

/**
 * Base class for coding agents driven through their command-line interface
 * in headless mode. The CLI runs with the worktree as working directory,
 * receives the prompt on stdin and streams JSON lines on stdout, which each
 * subclass maps to run events.
 *
 * Forge never handles credentials here: each CLI uses its own login or the
 * API key already present in the user's environment.
 */
export abstract class CliAgent implements AgentProvider {
  abstract readonly info: Omit<AgentInfo, 'settings'>
  abstract readonly defaultSettings: AgentSettings

  constructor(private readonly opts: CliAgentOptions = {}) {}

  /** Arguments for a headless run (the prompt arrives on stdin). */
  protected abstract buildArgs(settings: AgentSettings, workspacePath: string): string[]

  /** Maps one parsed JSON line to events and/or state changes. */
  protected abstract handleEvent(event: Record<string, unknown>, ctx: AgentContext, state: StreamState): void

  async run({ task, project, workspacePath, settings }: AgentRunInput, ctx: AgentContext): Promise<AgentOutcome> {
    const effective = settings ?? this.defaultSettings
    const state: StreamState = { summary: '', failure: null }
    ctx.emit('step', `Avvio ${this.info.name}${effective.model ? ` (${effective.model})` : ''}`)

    let result
    try {
      result = await runProcess({
        command: effective.command,
        args: this.buildArgs(effective, workspacePath),
        cwd: workspacePath,
        stdin: buildTaskPrompt(task, project),
        signal: ctx.signal,
        timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env: childEnv({ NO_COLOR: '1' }),
        onStdoutLine: (line) => this.handleLine(line, ctx, state)
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Comando "${effective.command}" non trovato: installa ${this.info.name} o imposta il percorso`)
      }
      throw err
    }

    if (result.timedOut) throw new Error(`${this.info.name} non ha finito entro il tempo massimo`)
    if (state.failure) throw new Error(state.failure)
    if (result.exitCode !== 0) {
      const detail = lastLines(result.stderr) || `exit ${result.exitCode}`
      throw new Error(`${this.info.name} terminato con errore: ${detail}`)
    }
    return { summary: state.summary || `${this.info.name} ha terminato senza un riepilogo.` }
  }

  async check(settings: AgentSettings): Promise<AgentCheck> {
    try {
      const res = await runProcess({
        command: settings.command,
        args: ['--version'],
        cwd: process.cwd(),
        signal: new AbortController().signal,
        timeoutMs: 15_000
      })
      if (res.exitCode !== 0) return { available: false, version: null, error: lastLines(res.output) || 'errore' }
      return { available: true, version: res.output.trim().split('\n')[0] ?? '', error: null }
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      return { available: false, version: null, error: missing ? 'Comando non trovato' : String(err) }
    }
  }

  private handleLine(line: string, ctx: AgentContext, state: StreamState): void {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return // Not JSON (banners, warnings): ignore, stderr carries real errors.
    }
    if (event && typeof event === 'object' && !Array.isArray(event)) {
      this.handleEvent(event as Record<string, unknown>, ctx, state)
    }
  }
}

export function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function lastLines(text: string, n = 5): string {
  return text.trim().split('\n').slice(-n).join('\n')
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
