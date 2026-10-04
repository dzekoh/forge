import { spawn } from 'node:child_process'
import type { TestReport } from '@shared/types'

const MAX_OUTPUT_CHARS = 64_000

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
export function runTests({ cwd, command, signal, timeoutMs = 10 * 60_000, onLine }: TestRunOptions): Promise<TestReport> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)

    const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', FORCE_COLOR: '0' }
    delete env['ELECTRON_RUN_AS_NODE']
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env
    })

    let output = ''
    let pending = ''
    let timedOut = false
    const append = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output = (output + text).slice(-MAX_OUTPUT_CHARS)
      if (!onLine) return
      const lines = (pending + text).split(/\r?\n/)
      pending = lines.pop() ?? ''
      lines.forEach((l) => l.trim() && onLine(l))
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const kill = (): void => {
      if (child.exitCode !== null || child.pid === undefined) return
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
        else process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    const onAbort = (): void => kill()
    signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', (err) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return reject(signal.reason)
      if (pending.trim() && onLine) onLine(pending)
      const note = timedOut ? `\n… interrotto dopo ${Math.round(timeoutMs / 1000)}s (timeout)` : ''
      resolve({
        command,
        ok: code === 0 && !timedOut,
        exitCode: timedOut ? null : code,
        durationMs: Date.now() - started,
        output: output + note
      })
    })
  })
}
