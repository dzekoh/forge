import type { TestReport } from '@shared/types'
import { childEnv, runProcess } from '../process/runProcess'

export interface TestRunOptions {
  cwd: string
  command: string
  signal: AbortSignal
  timeoutMs?: number
  onLine?: (line: string) => void
}

/**
 * Runs the project's test command in the run's worktree through the system
 * shell (the command is written by the user in the project settings).
 * The whole process tree is killed on cancel or timeout.
 */
export async function runTests({ cwd, command, signal, timeoutMs = 10 * 60_000, onLine }: TestRunOptions): Promise<TestReport> {
  const res = await runProcess({
    command,
    cwd,
    shell: true,
    signal,
    timeoutMs,
    env: childEnv({ CI: '1', FORCE_COLOR: '0' }),
    onStdoutLine: onLine,
    onStderrLine: onLine
  })
  const note = res.timedOut ? `\n… interrotto dopo ${Math.round(timeoutMs / 1000)}s (timeout)` : ''
  return {
    command,
    ok: res.exitCode === 0,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    output: res.output + note
  }
}
