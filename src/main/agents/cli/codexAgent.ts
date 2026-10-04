import type { AgentSettings } from '@shared/types'
import type { AgentContext } from '../types'
import { CliAgent, clip, obj, str, type StreamState } from './cliAgent'

/**
 * OpenAI Codex CLI via `codex exec --json`.
 *
 * Runs with the `workspace-write` sandbox: Codex may run commands, but writes
 * are confined to the worktree and network access stays off by default.
 */
export class CodexAgent extends CliAgent {
  readonly info = {
    id: 'codex',
    name: 'Codex',
    kind: 'cli' as const,
    description: 'CLI di OpenAI. Usa il login di Codex o OPENAI_API_KEY. Sandbox limitata al worktree.'
  }

  readonly defaultSettings: AgentSettings = { command: 'codex', model: '' }

  protected buildArgs(settings: AgentSettings, workspacePath: string): string[] {
    return [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--cd',
      workspacePath,
      '--ephemeral',
      '--color',
      'never',
      ...(settings.model ? ['--model', settings.model] : []),
      '-'
    ]
  }

  protected handleEvent(event: Record<string, unknown>, ctx: AgentContext, state: StreamState): void {
    switch (event.type) {
      case 'item.started': {
        const item = obj(event.item)
        if (item.type === 'command_execution') ctx.emit('step', `$ ${clip(str(item.command), 300)}`)
        return
      }
      case 'item.completed': {
        const item = obj(event.item)
        if (item.type === 'agent_message' && str(item.text).trim()) {
          ctx.emit('log', clip(str(item.text)))
          state.summary = clip(str(item.text))
        } else if (item.type === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0) {
          ctx.emit('log', `Comando terminato con exit ${item.exit_code}`)
        } else if (item.type === 'file_change' && Array.isArray(item.changes)) {
          const paths = item.changes.map((c) => str(obj(c).path)).filter(Boolean)
          if (paths.length) ctx.emit('step', `Modifica file: ${clip(paths.join(', '), 300)}`)
        } else if (item.type === 'error' && str(item.message)) {
          ctx.emit('error', clip(str(item.message)))
        }
        return
      }
      case 'turn.completed': {
        const usage = obj(event.usage)
        const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : null
        const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : null
        if (input !== null && output !== null) ctx.emit('log', `Token: ${input} in · ${output} out`)
        return
      }
      case 'turn.failed':
        state.failure = `Codex: ${clip(str(obj(event.error).message) || 'turno fallito')}`
        return
      case 'error':
        // Codex also reports transient problems (e.g. reconnecting) this way; a real failure ends in turn.failed.
        if (str(event.message)) ctx.emit('log', `Avviso: ${clip(str(event.message), 300)}`)
        return
    }
  }
}
