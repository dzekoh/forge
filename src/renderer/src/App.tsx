import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, Project, Task } from '@shared/types'
import { ProjectForm } from './components/ProjectForm'
import { ProjectSidebar } from './components/ProjectSidebar'
import { TaskDetail } from './components/TaskDetail'
import { TaskList } from './components/TaskList'
import { errorMessage } from './format'

const api = window.forge

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  /** Runs an API call and shows its error in the banner instead of throwing. */
  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null)
      return await fn()
    } catch (err) {
      setError(errorMessage(err))
      return undefined
    }
  }, [])

  useEffect(() => {
    void guard(async () => {
      const [p, a] = await Promise.all([api.projects.list(), api.agents.list()])
      setProjects(p)
      setAgents(a)
      if (p[0]) setProjectId(p[0].id)
      if (!p.length) setCreatingProject(true)
    })
  }, [guard])

  useEffect(() => {
    setTaskId(null)
    if (!projectId) return setTasks([])
    void guard(async () => setTasks(await api.tasks.list(projectId)))
  }, [projectId, guard])

  // Keep the task list in sync when a run finishes, whichever task it belongs to.
  useEffect(
    () =>
      api.runs.onUpdate((update) => {
        if (update.type === 'finished') upsertTask(update.task)
      }),
    []
  )

  function upsertTask(task: Task): void {
    if (task.projectId !== projectIdRef.current) return
    setTasks((list) => {
      const exists = list.some((t) => t.id === task.id)
      return exists ? list.map((t) => (t.id === task.id ? task : t)) : [task, ...list]
    })
  }

  const project = projects.find((p) => p.id === projectId) ?? null
  const task = tasks.find((t) => t.id === taskId) ?? null

  return (
    <div className="app">
      <ProjectSidebar
        projects={projects}
        selectedId={creatingProject ? null : projectId}
        onSelect={(id) => {
          setCreatingProject(false)
          setProjectId(id)
        }}
        onNew={() => setCreatingProject(true)}
      />

      <main className="main">
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="link" onClick={() => setError(null)}>
              Chiudi
            </button>
          </div>
        )}

        {creatingProject ? (
          <ProjectForm
            canCancel={projects.length > 0}
            onCancel={() => setCreatingProject(false)}
            onSubmit={async (input) => {
              const created = await guard(() => api.projects.create(input))
              if (!created) return
              setProjects((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)))
              setProjectId(created.id)
              setCreatingProject(false)
            }}
          />
        ) : project ? (
          <div className="workspace">
            <TaskList
              project={project}
              tasks={tasks}
              agents={agents}
              selectedId={taskId}
              onSelect={setTaskId}
              onCreate={async (input) => {
                const created = await guard(() => api.tasks.create({ ...input, projectId: project.id }))
                if (created) {
                  upsertTask(created)
                  setTaskId(created.id)
                }
              }}
              onDeleteProject={async () => {
                if (!confirm(`Eliminare il progetto "${project.name}" e tutti i suoi task?`)) return
                const ok = await guard(() => api.projects.remove(project.id).then(() => true))
                if (!ok) return
                const rest = projects.filter((p) => p.id !== project.id)
                setProjects(rest)
                setProjectId(rest[0]?.id ?? null)
                if (!rest.length) setCreatingProject(true)
              }}
            />
            {task ? (
              <TaskDetail
                key={task.id}
                task={task}
                agents={agents}
                guard={guard}
                onChange={upsertTask}
                onDeleted={() => {
                  setTasks((list) => list.filter((t) => t.id !== task.id))
                  setTaskId(null)
                }}
              />
            ) : (
              <section className="detail empty">Seleziona o crea un task.</section>
            )}
          </div>
        ) : (
          <div className="empty">Nessun progetto selezionato.</div>
        )}
      </main>
    </div>
  )
}
