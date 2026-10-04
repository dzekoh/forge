import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * A JSON document on disk with atomic, serialized writes.
 * Writes go to a temp file and are renamed over the target, so a crash
 * never leaves a half-written file. Concurrent saves are queued.
 */
export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly fallback: () => T
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback()
      throw err
    }
  }

  write(data: T): Promise<void> {
    const json = JSON.stringify(data, null, 2)
    const next = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${process.pid}.tmp`
      await writeFile(tmp, json, 'utf8')
      await rename(tmp, this.path)
    })
    // Keep the queue alive even if one write fails; the caller still sees the error.
    this.queue = next.catch(() => undefined)
    return next
  }
}
