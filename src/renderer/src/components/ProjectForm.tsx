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
        .catch(() => !stale && setRepoInfo({ exists: false, isGitRepo: false }))
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
        await onSubmit({ name, repoPath, description }).finally(() => setBusy(false))
      }}
    >
      <h2>Nuovo progetto</h2>
      <p className="muted">
        Un progetto collega Forge a un repository locale. In questa versione Forge legge solo il percorso: nessun
        file viene modificato.
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
          <span className={`hint ${repoInfo.isGitRepo ? 'ok' : 'warn'}`}>
            {!repoInfo.exists
              ? 'Cartella non trovata'
              : repoInfo.isGitRepo
                ? 'Repository Git rilevato'
                : 'La cartella esiste ma non è un repository Git'}
          </span>
        )}
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
