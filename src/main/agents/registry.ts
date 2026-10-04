import type { AgentInfo } from '@shared/types'
import type { AgentProvider } from './types'

export class AgentRegistry {
  private readonly providers = new Map<string, AgentProvider>()

  register(provider: AgentProvider): this {
    if (this.providers.has(provider.info.id)) throw new Error(`Agente già registrato: ${provider.info.id}`)
    this.providers.set(provider.info.id, provider)
    return this
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  get(id: string): AgentProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Agente sconosciuto: ${id}`)
    return provider
  }

  list(): AgentInfo[] {
    return [...this.providers.values()].map((p) => p.info)
  }
}
