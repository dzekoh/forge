import type { AgentSettings } from '@shared/types'
import type { AgentContext } from '../types'
import { CliAgent, clip, obj, str, type StreamState } from './cliAgent'

/**
 * Claude Code in print mode with streamed JSON output.
 *
 * Permissions: `acceptEdits` lets it edit files in the worktree without
 * asking; anything that would need a prompt (e.g. shell commands) is denied,
 * because nobody can answer in headless mode. Forge runs the tests itself.
 */
export class ClaudeCodeAgent extends CliAgent {
  readonly info = {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli' as const,
    description: 'CLI di Anthropic. Usa il login di Claude Code o ANTHROPIC_API_KEY. Modifica solo i file del worktree.'
  }

  readonly defaultSettings: AgentSettings = { command: 'claude', model: '' }

  protected buildArgs(settings: AgentSettings): string[] {
    return [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--no-session-persistence',
      ...(settings.model ? ['--model', settings.model] : [])
    ]
  }

  protected handleEvent(event: Record<string, unknown>, ctx: AgentContext, state: StreamState): void {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init' && str(event.model)) ctx.emit('log', `Modello: ${str(event.model)}`)
        return
      case 'assistant': {
        const content = obj(event.message).content
        if (!Array.isArray(content)) return
        for (const block of content.map(obj)) {
          if (block.type === 'text' && str(block.text).trim()) {
            ctx.emit('log', clip(str(block.text)))
            state.summary = clip(str(block.text))
          } else if (block.type === 'tool_use') {
            ctx.emit('step', describeTool(str(block.name), obj(block.input)))
          }
        }
        return
      }
      case 'result': {
        const cost = typeof event.total_cost_usd === 'number' ? ` · costo $${event.total_cost_usd.toFixed(4)}` : ''
        const turns = typeof event.num_turns === 'number' ? ` · ${event.num_turns} turni` : ''
        if (event.is_error === true || (event.subtype && event.subtype !== 'success')) {
          state.failure = `Claude Code: ${clip(str(event.result) || str(event.subtype) || 'errore')}`
        } else if (str(event.result)) {
          state.summary = clip(str(event.result))
        }
        ctx.emit('log', `Sessione terminata${turns}${cost}`)
        return
      }
    }
  }
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const target = str(input.file_path) || str(input.path) || str(input.pattern) || str(input.command)
  return target ? `${name}: ${clip(target, 200)}` : name
}
