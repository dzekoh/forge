import { useState } from 'react'
import type { AgentCheck, AgentInfo, AgentSettings } from '@shared/types'

interface Props {
  agents: AgentInfo[]
  guard<T>(fn: () => Promise<T>): Promise<T | undefined>
  onUpdated(agent: AgentInfo): void
}

export function AgentSettingsView({ agents, guard, onUpdated }: Props): React.JSX.Element {
  return (
    <div className="settings">
      <h1>Agenti</h1>
      <p className="muted">
        Forge usa le CLI installate sul tuo computer, con il loro login (o la chiave API già presente
        nell&apos;ambiente). Forge non salva credenziali. Ogni agente lavora solo nel worktree dell&apos;esecuzione.
      </p>
      {agents.map((a) =>
        a.settings ? (
          <AgentCard key={a.id} agent={a} settings={a.settings} guard={guard} onUpdated={onUpdated} />
        ) : (
          <section key={a.id} className="card agent-card">
            <h2>{a.name}</h2>
            <p className="muted small">{a.description}</p>
          </section>
        )
      )}
    </div>
  )
}

function AgentCard({
  agent,
  settings,
  guard,
  onUpdated
}: {
  agent: AgentInfo
  settings: AgentSettings
  guard: Props['guard']
  onUpdated: Props['onUpdated']
}): React.JSX.Element {
  const [command, setCommand] = useState(settings.command)
  const [model, setModel] = useState(settings.model)
  const [check, setCheck] = useState<AgentCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = command !== settings.command || model !== settings.model

  async function verify(): Promise<void> {
    setBusy(true)
    setCheck(null)
    const res = await guard(() => window.forge.agents.check(agent.id))
    setBusy(false)
    if (res) setCheck(res)
  }

  return (
    <form
      className="card agent-card"
      onSubmit={async (e) => {
        e.preventDefault()
        const updated = await guard(() => window.forge.agents.configure(agent.id, { command, model }))
        if (updated) {
          onUpdated(updated)
          setCheck(null)
        }
      }}
    >
      <h2>{agent.name}</h2>
      <p className="muted small">{agent.description}</p>
      <div className="grid-2">
        <label>
          Comando
          <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} required />
        </label>
        <label>
          Modello (vuoto = predefinito della CLI)
          <input className="mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="predefinito" />
        </label>
      </div>
      <div className="row end">
        {check && (
          <span className={`hint ${check.available ? 'ok' : 'warn'}`}>
            {check.available ? `Disponibile: ${check.version}` : `Non disponibile: ${check.error}`}
          </span>
        )}
        <button type="button" className="btn" disabled={busy || dirty} onClick={() => void verify()}>
          {busy ? 'Verifica…' : 'Verifica'}
        </button>
        <button className="btn primary" disabled={!dirty}>
          Salva
        </button>
      </div>
    </form>
  )
}
