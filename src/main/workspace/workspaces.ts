import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileChange, RepoInfo, RunWorkspace } from '@shared/types'
import { git, gitOk } from './git'

const MAX_DIFF_CHARS_PER_FILE = 200_000
const FALLBACK_IDENTITY = ['-c', 'user.name=Forge', '-c', 'user.email=forge@localhost']

export interface MergeOutcome {
  merged: boolean
  message: string
}

/**
 * Isolated workspaces for agent runs, backed by `git worktree`.
 *
 * Each run gets its own worktree (under Forge's data folder) on a fresh
 * `forge/...` branch created from the repository's HEAD. Agents only ever
 * write inside that worktree; the user's checkout changes only when a run
 * is approved and merged.
 */
export class Workspaces {
  constructor(private readonly rootDir: string) {}

  async inspect(repoPath: string): Promise<RepoInfo> {
    const exists = await stat(repoPath).then((s) => s.isDirectory(), () => false)
    if (!exists) return { exists, isGitRepo: false, hasCommits: false }
    const top = await git(repoPath, ['rev-parse', '--show-toplevel']).catch(() => null)
    if (top === null) return { exists, isGitRepo: false, hasCommits: false }
    const hasCommits = await gitOk(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    return { exists, isGitRepo: true, hasCommits }
  }

  async create(repoPath: string, runId: string, label: string): Promise<RunWorkspace> {
    const info = await this.inspect(repoPath)
    if (!info.exists) throw new Error(`Cartella del repository non trovata: ${repoPath}`)
    if (!info.isGitRepo) throw new Error('La cartella del progetto non è un repository Git')
    if (!info.hasCommits) throw new Error('Il repository non ha ancora commit: serve almeno un commit')

    const baseCommit = (await git(repoPath, ['rev-parse', 'HEAD'])).trim()
    const branch = `forge/${label}-${runId.slice(0, 8)}`
    const path = join(this.rootDir, runId)
    await git(repoPath, ['worktree', 'add', '-b', branch, path, baseCommit])
    return { path, branch, baseCommit, active: true }
  }

  /** Stages everything in the worktree and returns one unified diff per changed file. */
  async diff(ws: RunWorkspace): Promise<FileChange[]> {
    await git(ws.path, ['add', '--all'])
    const names = (await git(ws.path, ['diff', '--cached', '--name-only', '-z', ws.baseCommit]))
      .split('\0')
      .filter(Boolean)
    const changes: FileChange[] = []
    for (const path of names) {
      let diff = await git(ws.path, ['diff', '--cached', '--no-color', '--no-ext-diff', ws.baseCommit, '--', path])
      if (diff.length > MAX_DIFF_CHARS_PER_FILE) {
        diff = `${diff.slice(0, MAX_DIFF_CHARS_PER_FILE)}\n… diff troncato (${diff.length} caratteri)`
      }
      changes.push({ path, diff: diff.trimEnd() })
    }
    return changes
  }

  /** Commits the staged changes on the run's branch. Returns false if there was nothing to commit. */
  async commit(ws: RunWorkspace, message: string): Promise<boolean> {
    await git(ws.path, ['add', '--all'])
    if (await gitOk(ws.path, ['diff', '--cached', '--quiet'])) return false
    const hasIdentity = await gitOk(ws.path, ['config', 'user.email'])
    await git(ws.path, [...(hasIdentity ? [] : FALLBACK_IDENTITY), 'commit', '--no-verify', '-m', message])
    return true
  }

  /**
   * Merges the run's branch into the repository's current branch, but only
   * when that is safe: the checkout is on a branch and has no uncommitted
   * changes to tracked files. On conflict the merge is aborted.
   */
  async merge(repoPath: string, ws: RunWorkspace, message: string): Promise<MergeOutcome> {
    const current = (await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
    if (!current) return { merged: false, message: 'Il repository non è su un branch (detached HEAD)' }
    const dirty = (await git(repoPath, ['status', '--porcelain', '--untracked-files=no'])).trim()
    if (dirty) return { merged: false, message: 'Il repository ha modifiche non committate' }

    const hasIdentity = await gitOk(repoPath, ['config', 'user.email'])
    try {
      await git(repoPath, [...(hasIdentity ? [] : FALLBACK_IDENTITY), 'merge', '--no-ff', '-m', message, ws.branch])
      return { merged: true, message: `Unito in ${current}` }
    } catch (err) {
      await gitOk(repoPath, ['merge', '--abort'])
      const reason = err instanceof Error ? err.message : String(err)
      return { merged: false, message: `Merge non riuscito, annullato: ${reason}` }
    }
  }

  /** Removes the worktree. Deletes the branch too when asked (force: unmerged work is discarded). */
  async remove(repoPath: string, ws: RunWorkspace, opts: { deleteBranch: boolean }): Promise<void> {
    await gitOk(repoPath, ['worktree', 'remove', '--force', ws.path])
    await rm(ws.path, { recursive: true, force: true })
    await gitOk(repoPath, ['worktree', 'prune'])
    if (opts.deleteBranch) await gitOk(repoPath, ['branch', '-D', ws.branch])
  }

  async deleteMergedBranch(repoPath: string, ws: RunWorkspace): Promise<void> {
    await gitOk(repoPath, ['branch', '-d', ws.branch])
  }
}
