import type { FileChange } from '@shared/types'

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return ''
}

export function DiffView({ changes }: { changes: FileChange[] }): React.JSX.Element {
  if (!changes.length) return <p className="muted">Nessuna modifica proposta.</p>
  return (
    <div className="diffs">
      {changes.map((c) => (
        <details key={c.path} open className="diff-file">
          <summary>{c.path}</summary>
          <pre className="diff">
            {c.diff.split('\n').map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line || ' '}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </div>
  )
}
