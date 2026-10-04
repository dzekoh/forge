import { spawn } from 'node:child_process'

const MAX_TAIL_CHARS = 64_000

export interface RunProcessOptions {
  command: string
  args?: string[]
  cwd: string
  /** Use the system shell. Only for commands typed by the user (e.g. the test command). */
  shell?: boolean
  /** Written to stdin, which is then closed. */
  stdin?: string
  signal: AbortSignal
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface ProcessResult {
  /** Null when the process was killed (timeout or cancel). */
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  /** Tail of stdout and stderr interleaved, as the user would see it in a terminal. */
  output: string
  stderr: string
}

export class ProcessAbortedError extends Error {
  constructor() {
    super('Processo annullato')
    this.name = 'ProcessAbortedError'
  }
}

/** Environment for child processes: the user's environment minus Electron-specific switches. */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['ELECTRON_RENDERER_URL']
  return env
}

/**
 * Spawns a process in its own process group and resolves when it exits.
 * Cancel (signal) and timeout kill the whole process tree. Rejects with
 * ProcessAbortedError on cancel, or with the spawn error (e.g. ENOENT).
 */
export function runProcess(opts: RunProcessOptions): Promise<ProcessResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new ProcessAbortedError())

    const child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      shell: opts.shell ?? false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: opts.env ?? childEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const lineSplitter = (onLine?: (line: string) => void) => {
      let pending = ''
      return {
        push(text: string): void {
          if (!onLine) return
          const lines = (pending + text).split(/\r?\n/)
          pending = lines.pop() ?? ''
          lines.forEach((l) => l.trim() && onLine(l))
        },
        flush(): void {
          if (onLine && pending.trim()) onLine(pending)
          pending = ''
        }
      }
    }
    const out = lineSplitter(opts.onStdoutLine)
    const err = lineSplitter(opts.onStderrLine)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output = (output + text).slice(-MAX_TAIL_CHARS)
      out.push(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output = (output + text).slice(-MAX_TAIL_CHARS)
      stderr = (stderr + text).slice(-MAX_TAIL_CHARS)
      err.push(text)
    })
    // A child that exits without reading stdin must not crash us with EPIPE.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(opts.stdin ?? '')

    const kill = (): void => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
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
    }, opts.timeoutMs)
    const onAbort = (): void => kill()
    opts.signal.addEventListener('abort', onAbort, { once: true })

    const finish = (): void => {
      settled = true
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
    }

    child.on('error', (e) => {
      if (settled) return
      finish()
      reject(e)
    })
    child.on('close', (code) => {
      if (settled) return
      finish()
      if (opts.signal.aborted) return reject(new ProcessAbortedError())
      out.flush()
      err.flush()
      resolve({
        exitCode: timedOut ? null : code,
        timedOut,
        durationMs: Date.now() - started,
        output,
        stderr
      })
    })
  })
}
