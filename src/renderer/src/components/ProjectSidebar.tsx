import type { Project } from '@shared/types'

interface Props {
  projects: Project[]
  selectedId: string | null
  agentsSelected: boolean
  onSelect(id: string): void
  onNew(): void
  onAgents(): void
}

export function ProjectSidebar({ projects, selectedId, agentsSelected, onSelect, onNew, onAgents }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">Forge</div>
      <div className="sidebar-title">Progetti</div>
      <nav>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item${p.id === selectedId ? ' active' : ''}`}
            onClick={() => onSelect(p.id)}
            title={p.repoPath}
          >
            {p.name}
          </button>
        ))}
      </nav>
      <button className="btn ghost" onClick={onNew}>
        + Nuovo progetto
      </button>
      <div className="sidebar-spacer" />
      <button className={`nav-item${agentsSelected ? ' active' : ''}`} onClick={onAgents}>
        Agenti
      </button>
    </aside>
  )
}
