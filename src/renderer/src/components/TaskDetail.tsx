import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, Run, Task } from '@shared/types'
import { formatTime, runStatusLabel, taskStatusLabel } from '../format'
import { DiffView } from './DiffView'

interface Props {
  task: Task
  agents: AgentInfo[]
  guard<T>(fn: () => Promise<T>): Promise<T | undefined>
  onChange(task: Task): void
  onDeleted(): void
}

const api = window.forge

export function TaskDetail({ task, agents, guard, onChange, onDeleted }: Props): React.JSX.Element {
  const [run, setRun] = useState<Run | null>(null)
  const runIdRef = useRef<string | null>(task.lastRunId)
  const logRef = useRef<HTMLDivElement>(null)
  const agent = agents.find((a) => a.id === task.agentId)

  // Load the latest run, then follow live updates for it.
  useEffect(() => {
    runIdRef.current = task.lastRunId
    if (!task.lastRunId) return setRun(null)
    let cancelled = false
    void api.runs.get(task.lastRunId).then((r) => !cancelled && setRun(r))
    return () => {
      cancelled = true
    }
  }, [task.lastRunId])

  useEffect(
    () =>
      api.runs.onUpdate((update) => {
        if (update.type === 'event' && update.runId === runIdRef.current) {
          setRun((r) => (r && r.id === update.runId ? { ...r, events: [...r.events, update.event] } : r))
        } else if (update.type === 'finished' && update.run.id === runIdRef.current) {
          setRun(update.run)
        }
      }),
    []
  )

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [run?.events.length])

  async function start(): Promise<void> {
    const started = await guard(() => api.runs.start(task.id))
    if (!started) return
    runIdRef.current = started.id
    setRun(started)
    onChange({ ...task, status: 'running', lastRunId: started.id })
  }

  async function review(decision: 'approve' | 'reject'): Promise<void> {
    const updated = await guard(() => api.tasks.review(task.id, decision))
    if (updated) onChange(updated)
  }

  async function remove(): Promise<void> {
    if (!confirm(`Eliminare il task "${task.title}"?`)) return
    const ok = await guard(() => api.tasks.remove(task.id).then(() => true))
    if (ok) onDeleted()
  }

  const running = task.status === 'running'

  return (
    <section className="detail">
      <header className="detail-header">
        <div>
          <h2>{task.title}</h2>
          <div className="muted small">
            {agent?.name ?? task.agentId} · <span className={`status status-${task.status}`}>{taskStatusLabel[task.status]}</span>
          </div>
        </div>
        <div className="row">
          {running ? (
            <button className="btn" onClick={() => run && void api.runs.cancel(run.id)}>
              Annulla
            </button>
          ) : (
            task.status !== 'done' && (
              <button className="btn primary" onClick={() => void start()}>
                {task.lastRunId ? 'Riesegui' : 'Esegui'}
              </button>
            )
          )}
          {!running && (
            <button className="btn ghost danger" onClick={() => void remove()}>
              Elimina
            </button>
          )}
        </div>
      </header>

      {task.description && <p className="description">{task.description}</p>}

      {task.status === 'review' && (
        <div className="card review">
          <strong>Revisione richiesta.</strong> Controlla diff e test, poi decidi. L&apos;agente simulato non applica
          nulla al repository.
          <div className="row end">
            <button className="btn" onClick={() => void review('reject')}>
              Rifiuta
            </button>
            <button className="btn primary" onClick={() => void review('approve')}>
              Approva
            </button>
          </div>
        </div>
      )}
      {task.status === 'failed' && (
        <div className="card review failed">
          L&apos;esecuzione non è andata a buon fine.
          <div className="row end">
            <button className="btn" onClick={() => void review('reject')}>
              Rimetti in coda
            </button>
          </div>
        </div>
      )}

      {run ? (
        <div className="run">
          <div className="run-meta muted small">
            Esecuzione del {formatTime(run.startedAt)} · {runStatusLabel[run.status]}
            {run.error && <span className="error-text"> · {run.error}</span>}
          </div>

          <h3>Log</h3>
          <div className="log" ref={logRef}>
            {run.events.length === 0 && <div className="muted">In attesa dell&apos;agente…</div>}
            {run.events.map((e, i) => (
              <div key={i} className={`log-line kind-${e.kind}`}>
                <span className="time">{new Date(e.at).toLocaleTimeString('it-IT')}</span> {e.message}
              </div>
            ))}
          </div>

          {run.result && (
            <>
              <h3>Riepilogo</h3>
              <p>{run.result.summary}</p>
              <h3>Modifiche proposte</h3>
              <DiffView changes={run.result.changes} />
              {run.result.tests && (
                <>
                  <h3>
                    Test{' '}
                    <span className={`badge ${run.result.tests.failed ? 'warn' : 'ok'}`}>
                      {run.result.tests.passed} ok · {run.result.tests.failed} falliti
                    </span>
                  </h3>
                  <pre className="test-output">
                    $ {run.result.tests.command}
                    {'\n'}
                    {run.result.tests.output}
                  </pre>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="muted">Nessuna esecuzione. Premi «Esegui» per avviare l&apos;agente.</p>
      )}
    </section>
  )
}
