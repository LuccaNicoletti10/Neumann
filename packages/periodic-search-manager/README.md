# periodic-search-manager

Implementação funcional **independente**, em TypeScript, dos mecanismos descritos na patente
US 10,572,487 B1 (Palantir, *"Periodic Database Search Manager For Multiple Data Sources"*).
Este pacote **não copia claims**; implementa os mecanismos funcionais de forma autônoma:

- **Periodic search** — usuários configuram buscas (`SearchConfig`) com query e agenda
  (intervalo ou diária em UTC) que rodam periodicamente via `Scheduler` com relógio injetável
  (determinístico, sem cron externo).
- **Multiple data sources** — cada busca abrange várias fontes via `DataSourceRegistry`
  (`InMemoryDataSource` e `JsonFileDataSource` incluídos; interface `DataSource` extensível).
- **New-data detection** — a cada execução, cada fonte é consultada com `since = watermark`
  (high-watermark por busca/fonte), retornando apenas dados ainda não buscados; o
  `ResultDiffer` deduplica por `recordId` + hash sha256 do conteúdo (registro repetido não
  realerta; registro alterado realerta).
- **Alert/notify** — ao surgirem resultados novos, um `AlertRecord` é criado e os
  destinatários (usuários da busca + membros dos times via `TeamDirectory`, deduplicados)
  são notificados via `Notifier` (`ConsoleNotifier`, `InMemoryNotifier`).
- **Result storage** — buscas, resultados, alertas, execuções, watermarks e seen-set são
  persistidos em JSON (`searches.json`, `results.jsonl`, `alerts.jsonl`, `runs.jsonl`,
  `watermarks.json`, `seen.json`) com escrita atômica (tmp + rename).

## Requisitos

- Node.js 20+

## Scripts

```bash
npm install
npm run build   # tsc -p tsconfig.build.json -> dist/
npm test        # vitest run (40 testes)
npm run cli     # tsx src/cli.ts ...
npm start       # node dist/cli.js serve --port 3000
```

## Uso rápido (HTTP)

```bash
npm run build && npm start
# ou: npm run cli -- serve --port 3000

curl -X POST localhost:3000/sources \
  -H 'content-type: application/json' \
  -d '{"kind":"memory","id":"logs","name":"Logs"}'

curl -X POST localhost:3000/searches \
  -H 'content-type: application/json' \
  -d '{"name":"Monitor de erros","query":{"text":"erro"},
       "dataSourceIds":["logs"],"schedule":{"kind":"interval","everyMs":60000},
       "recipientUserIds":["u1"],"teamIds":["time-sec"]}'

curl -X POST localhost:3000/sources/logs/records \
  -H 'content-type: application/json' \
  -d '{"recordId":"r1","timestamp":"2024-01-01T00:00:10.000Z","content":{"msg":"erro de disco"}}'

curl -X POST localhost:3000/searches/<id>/run
curl localhost:3000/searches/<id>/alerts
```

## Uso rápido (CLI)

```bash
npm run cli -- serve --port 3000
npm run cli -- search create --data-dir ./data --name "Monitor" --source s1 --source-def s1:Logs --every 60s --text "erro" --users u1
npm run cli -- source add-record s1 --json '{"recordId":"r1","timestamp":"2024-01-01T00:00:10.000Z","content":{"msg":"erro"}}'
npm run cli -- search run <id> --data-dir ./data --source-def s1:Logs
npm run cli -- search list --data-dir ./data
npm run cli -- alerts <id> --data-dir ./data
```

## Estrutura

```
src/core/types.ts           Tipos centrais (SearchConfig, QuerySpec, ScheduleSpec, AlertRecord...)
src/core/data-source.ts     Interface DataSource + InMemory/JsonFile + DataSourceRegistry
src/core/watermark-store.ts High-watermarks por (busca, fonte), persistidos
src/core/result-differ.ts   Diff/dedupe por recordId + sha256, seen-set persistido
src/core/alert-manager.ts   Alertas, destinatários (usuários + times), Notifier
src/core/scheduler.ts       Agenda periódica (interval/daily), relógio injetável, tick/start/stop
src/core/search-manager.ts  Fachada: CRUD, runner, scheduler, consultas
src/core/search-store.ts    Persistência JSON atômica (searches/results/alerts/runs)
src/server/index.ts         API HTTP (Fastify + zod)
src/cli.ts                  CLI
tests/                      Suíte vitest (40 testes)
```
