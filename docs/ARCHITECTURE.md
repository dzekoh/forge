# Architettura di Forge

## Obiettivi che guidano le scelte

- **Local-first**: nessun server, nessun account; i dati restano sulla macchina.
- **Sicurezza**: il renderer non ha accesso a Node; ogni input dal renderer è validato nel main process;
  gli agenti lavorano solo in un worktree isolato e il checkout dell'utente cambia solo dopo l'approvazione.
- **Modularità**: gli agenti sono provider intercambiabili dietro un'unica interfaccia.
- **MVP prima di tutto**: dipendenze minime, niente database nativi o framework di stato finché non servono.

## Stack

| Livello    | Scelta                                   | Perché                                                         |
| ---------- | ---------------------------------------- | -------------------------------------------------------------- |
| Shell      | Electron 44                              | App desktop multipiattaforma con accesso a file system e processi |
| Build      | electron-vite 5 (Vite 7)                 | Un solo tool per main, preload e renderer, con HMR             |
| UI         | React 19 + CSS semplice                  | Nessuna libreria UI: meno dipendenze, tema chiaro/scuro nativo |
| Linguaggio | TypeScript strict                        | Tipi condivisi tra i tre processi                              |
| Dati       | File JSON con scritture atomiche         | Zero dipendenze native; sostituibile con SQLite in un solo file |
| Test       | Vitest (unità) + Playwright (e2e Electron) |                                                              |

## Processi e confini

```
┌──────────────────────── main process (Node) ────────────────────────┐
│ index.ts      finestra, CSP/permessi, ciclo di vita                  │
│ ipc.ts        handler IPC: verifica mittente, inoltra ai servizi     │
│ data/         Repository (stato + validazione) su JsonFile atomico   │
│ agents/       AgentProvider, AgentRegistry, SimulatedAgent           │
│ workspace/    Workspaces (git worktree, diff, commit, merge), test   │
│ runs/         RunManager: worktree → agente → diff → test → review   │
└──────────────▲───────────────────────────────────┬──────────────────┘
               │ ipcRenderer.invoke (canali fissi)  │ runs:update (eventi)
┌──────────────┴──────── preload (sandbox) ─────────▼──────────────────┐
│ window.forge: API tipizzata ForgeApi, nient'altro                    │
└──────────────▲───────────────────────────────────────────────────────┘
┌──────────────┴──────── renderer (React) ─────────────────────────────┐
│ App → ProjectSidebar · ProjectForm · TaskList · TaskDetail · DiffView │
└──────────────────────────────────────────────────────────────────────┘
```

`src/shared/` contiene i tipi di dominio e il contratto `ForgeApi` con i nomi dei canali: è l'unico
codice importato da tutti e tre i processi.

### Sicurezza dell'app

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP restrittiva nel renderer (`script-src 'self'`).
- Navigazione e nuove finestre bloccate; i link `https://` si aprono nel browser di sistema.
- Tutte le richieste di permessi del browser (camera, notifiche…) sono rifiutate.
- Gli handler IPC rifiutano chiamate da frame diversi dalla pagina dell'app.
- Il main process valida ogni input (tipi, lunghezze, id, percorsi assoluti, agente esistente).

## Modello dati

- **Project**: nome, percorso assoluto del repository Git, descrizione, comando di test.
- **Task**: appartiene a un progetto; titolo, descrizione, agente, stato.
- **Run**: un'esecuzione di un task: eventi (log), workspace (worktree, branch, commit di partenza),
  risultato (riepilogo, diff per file, report test), esito della revisione, errore.

Ciclo di vita del task:

```
todo ──Esegui──▶ running ──ok──▶ review ──Approva──▶ done
  ▲                 │  └─test falliti / errore──▶ failed
  │                 └─Annulla──▶ todo
  └──────── Rifiuta (da review o failed) ─────────┘
```

All'avvio, le esecuzioni rimaste `running` (crash o chiusura forzata) diventano `interrupted` e il task
torna `todo`. Si conservano le ultime 10 esecuzioni per task e al massimo 500 eventi per esecuzione.

Il file dati ha un campo `version` con migrazioni incrementali (`migrate` in `data/repository.ts`): una
versione sconosciuta blocca l'avvio invece di sovrascrivere i dati.

## Esecuzione di un task

```
RunManager.start
  1. Workspaces.create   git worktree add -b forge/<slug>-<id> <dati>/worktrees/<runId> HEAD
  2. agent.run           l'agente modifica i file solo nel worktree
  3. Workspaces.diff     git add --all + git diff --cached <base> per file
  4. runTests            comando di test del progetto, nel worktree, via shell
                         (timeout 10 min, output troncato, albero di processi ucciso su annulla)
  5. task → review (test ok o assenti) | failed (test falliti)

RunManager.review
  approve  commit sul branch → rimuove il worktree → merge --no-ff nel branch corrente
           solo se il checkout è su un branch e senza modifiche ai file tracciati;
           altrimenti (o se il merge va in conflitto, che viene annullato) il branch resta da unire a mano
  reject   rimuove worktree e branch
```

Annullamenti, crash dell'agente e una nuova esecuzione dello stesso task eliminano il worktree
precedente. All'avvio i worktree di esecuzioni interrotte vengono ripuliti. Git è sempre invocato con
`execFile` e una lista di argomenti, mai tramite shell; il commit sul branch dell'agente usa
`--no-verify`. Il comando di test è l'unica cosa eseguita via shell: lo scrive l'utente.

Il worktree parte da un checkout pulito: per progetti con dipendenze il comando di test deve
includerne l'installazione (es. `npm ci && npm test`).

## Agenti

```ts
interface AgentProvider {
  info: AgentInfo                 // id, nome, tipo: simulated | cli | api
  run(input: { task, project, workspacePath }, ctx: { signal, emit }): Promise<{ summary }>
}
```

Un provider riceve il task, il progetto e il percorso del worktree, scrive solo lì, trasmette eventi con
`emit`, rispetta `signal` per l'annullamento e restituisce un riepilogo. Diff e test li ricava Forge dal
worktree, quindi sono gli stessi per qualunque provider.

`SimulatedAgent` implementa il contratto senza rete: scrive una nota Markdown nel worktree.

## Prossimi passi

1. **Provider Claude e Codex**: adapter `cli` (Claude Code, Codex CLI) eseguiti con `cwd` nel worktree,
   e/o adapter `api`. Chiavi API nel portachiavi di sistema (`safeStorage`), mai nel file JSON.
2. **Configurazione provider/modelli**, poi **ruoli** (prompt + modello + permessi) e **workflow**
   (sequenze di ruoli, es. pianifica → implementa → revisiona).
3. App pacchettizzata su macOS: il PATH dei processi avviati dal Finder non include quello della shell,
   quindi `git`/`npm` vanno risolti esplicitamente.
