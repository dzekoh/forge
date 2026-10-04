#!/usr/bin/env node
// Stand-in for the `codex` CLI in tests: `codex exec --json` event shape, no network.
import { appendFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('codex-cli 9.9.9')
  process.exit(0)
}
let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt, cwd: process.cwd() }) + '\n')

const cd = args[args.indexOf('--cd') + 1]
if (cd) process.chdir(cd)
const emit = (e) => console.log(JSON.stringify(e))
emit({ type: 'thread.started', thread_id: 't1' })
emit({ type: 'turn.started' })
emit({ type: 'error', message: 'Reconnecting... 1/5' })

if (prompt.includes('#fail')) {
  emit({ type: 'turn.failed', error: { message: 'quota esaurita' } })
  process.exit(1)
}

emit({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls', status: 'in_progress' } })
emit({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' } })
writeFileSync('codex-output.txt', 'ciao da codex\n')
emit({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'codex-output.txt', kind: 'add' }] } })
emit({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Aggiunto codex-output.txt' } })
emit({ type: 'turn.completed', usage: { input_tokens: 120, output_tokens: 30 } })
