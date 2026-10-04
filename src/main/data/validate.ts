// Small input guards for data arriving over IPC. The renderer is treated as untrusted.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${what}: oggetto non valido`)
  }
  return value as Record<string, unknown>
}

export function requireString(value: unknown, field: string, opts: { max?: number } = {}): string {
  if (typeof value !== 'string') throw new ValidationError(`${field}: deve essere una stringa`)
  const trimmed = value.trim()
  if (!trimmed) throw new ValidationError(`${field}: obbligatorio`)
  const max = opts.max ?? 200
  if (trimmed.length > max) throw new ValidationError(`${field}: massimo ${max} caratteri`)
  return trimmed
}

export function optionalString(value: unknown, field: string, opts: { max?: number } = {}): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${field}: deve essere una stringa`)
  const max = opts.max ?? 5000
  if (value.length > max) throw new ValidationError(`${field}: massimo ${max} caratteri`)
  return value.trim()
}

export function requireId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new ValidationError(`${field}: identificativo non valido`)
  }
  return value
}

export function requireAbsolutePath(value: unknown, field: string, isAbsolute: (p: string) => boolean): string {
  const path = requireString(value, field, { max: 1024 })
  if (!isAbsolute(path)) throw new ValidationError(`${field}: serve un percorso assoluto`)
  return path
}
