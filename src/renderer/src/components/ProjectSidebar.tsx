import type { Project } from '@shared/types'

interface Props {
  projects: Project[]
  selectedId: string | null
  onSelect(id: string): void
  onNew(): void
}

export function ProjectSidebar({ projects, selectedId, onSelect, onNew }: Props): React.JSX.Element {
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
    </aside>
  )
}
