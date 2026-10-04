# Forge

App desktop local-first per orchestrare coding agent multi-provider: un'unica interfaccia per
configurare provider e modelli, definire ruoli e workflow, eseguire task su repository locali e
revisionare le modifiche tramite diff e test.

**Stato: MVP.** Gestione di progetti e task con dati locali e un agente simulato che percorre l'intero
workflow su un repository Git reale: worktree isolato → log in streaming → diff → test del progetto →
revisione → merge. Nessuna chiamata API. L'integrazione con Claude e Codex è la fase successiva.

## Avvio rapido

Requisiti: Node.js 20+, npm e `git` nel PATH.

```bash
npm install
npm run dev        # app in modalità sviluppo con hot reload
```

| Comando              | Cosa fa                                                         |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Avvia l'app in sviluppo                                         |
| `npm run build`      | Compila main, preload e renderer in `out/`                      |
| `npm start`          | Avvia la build compilata                                        |
| `npm run typecheck`  | Controllo dei tipi TypeScript                                   |
| `npm test`           | Test unitari (repository, agente simulato, esecuzioni)          |
| `npm run test:e2e`   | Build + smoke test end-to-end dell'app Electron (Playwright)    |
| `npm run check`      | typecheck + test + build                                        |

Su Linux senza display lo smoke test va lanciato con `xvfb-run -a npm run test:e2e`.

## Provare il workflow

1. Crea un progetto indicando un repository Git locale con almeno un commit e, se vuoi, un comando di test
   (es. `npm ci && npm test`).
2. Aggiungi un task e premi **Esegui**. Forge crea un `git worktree` su un branch `forge/…`, l'agente
   simulato ci scrive una nota Markdown, poi Forge raccoglie il diff ed esegue il comando di test nel worktree.
3. Il task passa **In revisione** (o **Fallito** se i test falliscono):
   - **Approva e unisci** fa il commit sul branch e lo unisce nel branch corrente del repository. Se il
     checkout ha modifiche non committate o il merge va in conflitto, il branch resta lì da unire a mano.
   - **Rifiuta** elimina worktree e branch.

Il tuo checkout non cambia mai finché non approvi. Scrivendo `#error` nel task l'agente simula un crash;
un'esecuzione si può annullare mentre è in corso (anche durante i test).

I dati sono in `forge-data.json` e i worktree in `worktrees/`, nella cartella dati dell'utente di Electron
(`FORGE_DATA_DIR` permette di sceglierne un'altra).

Architettura e decisioni: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
