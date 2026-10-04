import { useEffect, useState } from 'react'
import type { AgentInfo, Project, RepoInfo, Task } from '@shared/types'
import { taskStatusLabel } from '../format'

interface Props {
  project: Project
  tasks: Task[]
  agents: AgentInfo[]
  selectedId: string | null
  onSelect(id: string): void
  onCreate(input: { title: string; description: string; agentId: string }): Promise<void>
  onDeleteProject(): void
}

export function TaskList(props: Props): React.JSX.Element {
  const { project, tasks, agents, selectedId, onSelect, onCreate, onDeleteProject } = props
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id)
  }, [agents, agentId])

  useEffect(() => {
    setRepoInfo(null)
    window.forge.projects.inspectRepo(project.repoPath).then(setRepoInfo, () => setRepoInfo(null))
  }, [project.repoPath])

  return (
    <section className="tasks">
      <header className="project-header">
        <div>
          <h1>{project.name}</h1>
          <div className="path" title={project.repoPath}>
            {project.repoPath}
          </div>
          {repoInfo && (
            <span className={`badge ${repoInfo.isGitRepo ? 'ok' : 'warn'}`}>
              {!repoInfo.exists ? 'cartella mancante' : repoInfo.isGitRepo ? 'git' : 'non git'}
            </span>
          )}
        </div>
        <button className="btn ghost danger" onClick={onDeleteProject} title="Elimina progetto">
          Elimina
        </button>
      </header>
      {project.description && <p className="muted">{project.description}</p>}

      <form
        className="card new-task"
        onSubmit={async (e) => {
          e.preventDefault()
          await onCreate({ title, description, agentId })
          setTitle('')
          setDescription('')
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nuovo task…" required />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrizione (facoltativa)"
          rows={2}
        />
        <span className="muted small">Agente simulato: scrivi #fail per far fallire i test, #error per simulare un crash.</span>
        <div className="row">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agente">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn primary">Aggiungi</button>
        </div>
      </form>

      <ul className="task-list">
        {tasks.length === 0 && <li className="muted">Nessun task ancora.</li>}
        {tasks.map((t) => (
          <li key={t.id}>
            <button className={`task-item${t.id === selectedId ? ' active' : ''}`} onClick={() => onSelect(t.id)}>
              <span className="task-title">{t.title}</span>
              <span className={`status status-${t.status}`}>{taskStatusLabel[t.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
