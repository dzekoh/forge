# Architettura di Forge

## Obiettivi che guidano le scelte

- **Local-first**: nessun server, nessun account; i dati restano sulla macchina.
- **Sicurezza**: il renderer non ha accesso a Node; ogni input dal renderer è validato nel main process;
  nessun agente modifica un repository senza un passo esplicito di approvazione.
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
│ runs/         RunManager: avvia, annulla, trasmette, registra        │
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

- **Project**: nome, percorso assoluto del repository, descrizione.
- **Task**: appartiene a un progetto; titolo, descrizione, agente, stato.
- **Run**: un'esecuzione di un task: eventi (log), risultato (riepilogo, modifiche come diff, report test), errore.

Ciclo di vita del task:

```
todo ──Esegui──▶ running ──ok──▶ review ──Approva──▶ done
  ▲                 │  └─test falliti / errore──▶ failed
  │                 └─Annulla──▶ todo
  └──────── Rifiuta (da review o failed) ─────────┘
```

All'avvio, le esecuzioni rimaste `running` (crash o chiusura forzata) diventano `interrupted` e il task
torna `todo`. Si conservano le ultime 10 esecuzioni per task e al massimo 500 eventi per esecuzione.

Il file dati ha un campo `version`: una versione sconosciuta blocca l'avvio invece di sovrascrivere i dati.

## Agenti

```ts
interface AgentProvider {
  info: AgentInfo                 // id, nome, tipo: simulated | cli | api
  run(input: { task, project }, ctx: { signal, emit }): Promise<RunResult>
}
```

Un provider riceve il task e il progetto, trasmette eventi con `emit`, rispetta `signal` per
l'annullamento e restituisce modifiche **proposte** come diff unificati. Non applica nulla: applicare le
modifiche è un passo separato che richiede l'approvazione dell'utente.

`SimulatedAgent` implementa il contratto senza rete né file system, così il workflow si prova a costo zero.

## Prossimi passi (fase 5 e oltre)

1. **Workspace isolato**: per ogni esecuzione reale, un `git worktree` su un branch dedicato; diff e test
   letti da lì con `git diff`; "Approva" fa merge o lascia il branch, "Rifiuta" elimina il worktree.
2. **Provider Claude e Codex**: adapter `cli` (Claude Code, Codex CLI) che girano nel worktree, e/o
   adapter `api`. Chiavi API nel portachiavi di sistema (`safeStorage`), mai nel file JSON.
3. **Configurazione provider/modelli**, poi **ruoli** (prompt + modello + permessi) e **workflow**
   (sequenze di ruoli, es. pianifica → implementa → revisiona).
4. Esecuzione dei test reali del repository con comando configurabile per progetto.
