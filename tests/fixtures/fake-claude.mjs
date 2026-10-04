#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: same flags and stream-json shape, no network.
import { appendFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('9.9.9 (Claude Code)')
  process.exit(0)
}
let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt, cwd: process.cwd() }) + '\n')

const emit = (e) => console.log(JSON.stringify(e))
const title = prompt.split('## Task\n')[1]?.split('\n')[0] ?? 'task'
emit({ type: 'system', subtype: 'init', model: 'fake-sonnet', cwd: process.cwd() })
console.log('not json: a banner line')

if (prompt.includes('#hang')) await new Promise((r) => setTimeout(r, 60_000))
if (prompt.includes('#fail')) {
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Limite di turni raggiunto', num_turns: 3 })
  process.exit(1)
}
if (prompt.includes('#crash')) {
  console.error('fatal: something exploded')
  process.exit(2)
}

emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Leggo il progetto.' }] } })
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'agent-output.md' } }] } })
writeFileSync('agent-output.md', `# ${title}\n\nScritto da fake-claude.\n`)
emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })
emit({ type: 'result', subtype: 'success', is_error: false, result: `Creato agent-output.md per ${title}`, num_turns: 2, total_cost_usd: 0.0123 })
