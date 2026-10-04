# Forge

App desktop local-first per orchestrare coding agent multi-provider: un'unica interfaccia per
configurare provider e modelli, definire ruoli e workflow, eseguire task su repository locali e
revisionare le modifiche tramite diff e test.

**Stato: MVP, fasi 1–4.** Gestione di progetti e task con dati locali e un agente simulato che
percorre l'intero workflow (esecuzione → log in streaming → diff → test → revisione) senza chiamare
API e senza toccare i repository. L'integrazione con Claude e Codex è la fase successiva.

## Avvio rapido

Requisiti: Node.js 20+ e npm.

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

1. Crea un progetto indicando il percorso di un repository locale (viene solo letto per verificare che esista e sia Git).
2. Aggiungi un task e premi **Esegui**: l'agente simulato mostra i passi nel log, poi propone un diff e un report dei test.
3. Il task passa **In revisione**: **Approva** lo chiude, **Rifiuta** lo rimette in coda.

Scenari dell'agente simulato, scelti dal testo del task: `#fail` fa fallire i test, `#error` simula un crash.
Un'esecuzione si può annullare mentre è in corso.

I dati sono in `forge-data.json` nella cartella dati dell'utente di Electron
(`FORGE_DATA_DIR` permette di sceglierne un'altra).

Architettura e decisioni: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
