import { useEffect, useState } from 'react'
import type { NewProjectInput, RepoInfo } from '@shared/types'

interface Props {
  canCancel: boolean
  onCancel(): void
  onSubmit(input: NewProjectInput): Promise<void>
}

export function ProjectForm({ canCancel, onCancel, onSubmit }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [description, setDescription] = useState('')
  const [testCommand, setTestCommand] = useState('')
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [busy, setBusy] = useState(false)

  // Check the folder as the user types, so problems show before saving.
  useEffect(() => {
    setRepoInfo(null)
    const path = repoPath.trim()
    if (!path) return
    let stale = false
    const timer = setTimeout(() => {
      window.forge.projects
        .inspectRepo(path)
        .then((info) => !stale && setRepoInfo(info))
        .catch(() => !stale && setRepoInfo({ exists: false, isGitRepo: false, hasCommits: false }))
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [repoPath])

  async function browse(): Promise<void> {
    const picked = await window.forge.projects.pickFolder()
    if (!picked) return
    setRepoPath(picked)
    if (!name.trim()) setName(picked.split(/[\\/]/).filter(Boolean).pop() ?? '')
  }

  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        await onSubmit({ name, repoPath, description, testCommand }).finally(() => setBusy(false))
      }}
    >
      <h2>Nuovo progetto</h2>
      <p className="muted">
        Un progetto collega Forge a un repository Git locale. Ogni esecuzione lavora in un worktree separato su un
        branch dedicato: il tuo checkout cambia solo quando approvi.
      </p>

      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. my-app" required />
      </label>

      <label>
        Percorso del repository
        <div className="row">
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/percorso/assoluto/del/repo"
            required
          />
          <button type="button" className="btn" onClick={() => void browse()}>
            Sfoglia…
          </button>
        </div>
        {repoInfo && (
          <span className={`hint ${repoInfo.hasCommits ? 'ok' : 'warn'}`}>
            {!repoInfo.exists
              ? 'Cartella non trovata'
              : !repoInfo.isGitRepo
                ? 'La cartella esiste ma non è un repository Git'
                : repoInfo.hasCommits
                  ? 'Repository Git rilevato'
                  : 'Repository Git senza commit: serve almeno un commit per eseguire i task'}
          </span>
        )}
      </label>

      <label>
        Comando di test (facoltativo)
        <input
          value={testCommand}
          onChange={(e) => setTestCommand(e.target.value)}
          placeholder="Es. npm ci && npm test"
          className="mono"
        />
        <span className="hint muted">
          Viene eseguito nel worktree dopo ogni esecuzione. Il worktree parte pulito: includi l&apos;installazione
          delle dipendenze se serve.
        </span>
      </label>

      <label>
        Descrizione (facoltativa)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </label>

      <div className="row end">
        {canCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Annulla
          </button>
        )}
        <button className="btn primary" disabled={busy}>
          Crea progetto
        </button>
      </div>
    </form>
  )
}
