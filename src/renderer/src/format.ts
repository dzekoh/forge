import type { RunStatus, TaskStatus } from '@shared/types'

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: 'Da fare',
  running: 'In esecuzione',
  review: 'In revisione',
  done: 'Completato',
  failed: 'Fallito'
}

export const runStatusLabel: Record<RunStatus, string> = {
  running: 'In corso',
  succeeded: 'Riuscito',
  failed: 'Fallito',
  cancelled: 'Annullato',
  interrupted: 'Interrotto'
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' })
}

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron prefixes errors thrown in ipcMain handlers; keep only the useful part.
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
