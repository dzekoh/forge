import { execFile } from 'node:child_process'

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Runs git with an argument list (never through a shell), non-interactively.
 * Resolves with stdout; rejects with a GitError carrying stderr.
 */
export function git(cwd: string, args: string[], opts: { maxBuffer?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        windowsHide: true
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr.trim() || err.message
          reject(new GitError(`git ${args[0]}: ${detail}`, stderr))
        } else {
          resolve(stdout)
        }
      }
    )
  })
}

export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args)
    return true
  } catch {
    return false
  }
}
