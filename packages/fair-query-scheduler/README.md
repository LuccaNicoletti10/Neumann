# fair-query-scheduler

Escalonador justo (**fair scheduling**) para cargas mistas de consultas, em TypeScript/Node 20+ (ESM), **sem dependências de runtime**. É uma **implementação funcional independente** dos mecanismos da patente **US 9.092.482 B2** ("Fair Scheduling for Mixed-Query Loads") — nenhum texto dos claims é copiado; cada módulo reimplementa os mecanismos de forma original e o cabeçalho de cada arquivo `.ts` indica qual componente da patente ele implementa funcionalmente.

## Mecanismos implementados

1. **Job request com estimativa de custo** — clientes submetem `JobRequest { query, costEstimate, params? }`, onde `costEstimate` é o número esperado de resultados da consulta. (`src/core/types.ts`, `src/core/cost.ts`)
2. **Decisão por threshold** — se `costEstimate > thresholdCost`, o job é dividido em múltiplas sub-query tasks; caso contrário, executa como task única. (`src/core/task-splitter.ts`)
3. **Divisão por keyset/seek pagination** — a 1ª sub-task aplica um rate limiter (`LIMIT N`, `N ≈ threshold`); após cada execução, determina-se o **valor do último resultado retornado** e a próxima sub-task inclui esse valor (`WHERE id > lastValue ORDER BY id LIMIT N`), até não haver mais resultados (task retorna `< limit` linhas). (`src/core/task-splitter.ts`, `src/core/dbms.ts`)
4. **Fila de execução round-robin** — enqueue no FIM; loop: dequeue da FRENTE → executa a PRÓXIMA sub-task do job no DBMS → se houver sub-tasks pendentes, re-enfileira no FIM; senão, o job completa. (`src/core/job-queue.ts`, `src/core/scheduler.ts`)
5. **Cancelamento** — remove o job item da fila e marca o job como `cancelled`; sub-task em voo não é re-enfileirada. (`src/core/scheduler.ts`)
6. **Migração de nó** — DBMS multi-nó: em `t1` remove o job item da fila (mesmo com sub-task em execução no nó A); em `t2 > t1` gera um SEGUNDO query job (continuação) baseado no primeiro, retomando do último valor, e o enfileira atribuído a um nó B ≠ A. (`src/core/scheduler.ts`, `src/core/dbms.ts`)
7. **Métricas de latência** — por job: latência até o 1º resultado e tempo de conclusão. O comparador (`runComparison`) executa a mesma carga em modo **FCFS** (sem divisão) × **fair** (round-robin) e demonstra que jobs de baixo custo têm latência menor no modo fair quando concorrem com jobs de alto custo. (`src/core/compare.ts`)

## Determinismo

Toda a lógica usa um **`Clock` injetável** (`now(): number`, `advance(ms)`). A latência do DBMS simulado (`baseMs + perRowMs × linhas retornadas`) avança o clock — nada de `Date.now()`/`setTimeout`/`Math.random()` na lógica. O scheduler **não usa timers**: expõe `step(): boolean` (um ciclo dequeue → sub-task → reenqueue) e `runUntilIdle(): Promise<void>`; testes dirigem o clock com `FakeClock`.

## Estrutura
src/core/types.ts         Tipos: JobRequest, QueryJob, SubQueryTask, JobItem, Row, Clock/FakeClock
src/core/dbms.ts          DBMS multi-nó SIMULADO em memória (tabelas ordenadas por chave, latência simulada)
src/core/cost.ts          CostEstimator (estimativa do request ou contagem estimada da tabela)
src/core/task-splitter.ts Decisão por threshold + iterador lazy de sub-tasks keyset
src/core/job-queue.ts     Fila de execução round-robin (enqueue fim, dequeue frente, reenqueue, remove)
src/core/scheduler.ts     FairScheduler: submit/step/runUntilIdle/cancel/migrate/métricas
src/core/compare.ts       runComparison: mesma carga FCFS × fair, métricas lado a lado
src/server/index.ts       HTTP (node:http apenas): /health, /jobs, /jobs/:id, cancel, migrate, /compare
src/cli.ts                CLI: submit, run, cancel, compare, serve, demo
src/index.ts              Re-exports da API pública
tests/*.test.ts           Vitest: cobertura de todos os mecanismos (1–7), HTTP e CLI
plain

## Uso como biblioteca

```ts
import {
  DatabaseManagementSystem, DatabaseNode, FairScheduler, FakeClock, runComparison,
} from 'fair-query-scheduler';

const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, value: `row-${i + 1}` }));
const dbms = new DatabaseManagementSystem([
  new DatabaseNode('node-a', { events: rows }),
  new DatabaseNode('node-b', { events: rows }), // 2º nó para migração
]);

const scheduler = new FairScheduler({ dbms, clock: new FakeClock(0), thresholdCost: 100 });
const bigId = scheduler.submit({ query: 'events', costEstimate: 1000 }); // dividido (1000 > 100)
const smallId = scheduler.submit({ query: 'events', costEstimate: 10 }); // task única
await scheduler.runUntilIdle(); // ou: while (scheduler.step()) {}

const big = await scheduler.result(bigId);
console.log(big.rows.length, big.metrics.completionTimeMs);

// Cancelamento e migração:
// scheduler.cancel(jobId);
// scheduler.migrate(jobId, 'node-b');

// Comparação FCFS × fair:
const cmp = await runComparison(
  [{ query: 'events', costEstimate: 1000 }, { query: 'events', costEstimate: 10 }],
  { dbms, thresholdCost: 100 },
);
console.log(cmp.fcfs.jobs, cmp.fair.jobs);
Uso via CLI
bash
npm run cli -- demo                                  # carga mista embutida: latência de job pequeno com e sem fair scheduling
npm run cli -- submit --query events --cost 1000     # submete e executa um job
npm run cli -- run --mode fair --file jobs.json      # executa carga de arquivo (fair|fcfs)
npm run cli -- cancel job-2 --file jobs.json         # cancela um job da carga e executa o restante
npm run cli -- compare --file jobs.json              # métricas FCFS × fair
npm run cli -- serve --port 8080                     # sobe o servidor HTTP
Formato de jobs.json:
JSON
{
  "tableSizes": { "events": 1000 },
  "thresholdCost": 100,
  "jobs": [
    { "query": "events", "costEstimate": 1000 },
    { "query": "events", "costEstimate": 10 }
  ]
}
Uso via HTTP
bash
npm run serve -- --port 8080
Table
Método	Rota	Descrição
GET	/health	{ ok: true }
POST	/jobs	body {query, costEstimate, params?} → { jobId } (201)
GET	/jobs/:id	drena a fila e retorna estado + resultados agregados + métricas
POST	/jobs/:id/cancel	remove o job da fila e o marca cancelled
POST	/jobs/:id/migrate	body {toNode} → continuação do job executa em outro nó
POST	/compare	body {jobs: [...], thresholdCost?, tables?} → métricas FCFS × fair
Corpos maiores que 8 MB → 413; JSON inválido → 400; rota/job desconhecido → 404.
Scripts
bash
npm install
npm test            # vitest run (todos os mecanismos 1–7 + HTTP + CLI)
npm run typecheck   # tsc --noEmit (strict, noUncheckedIndexedAccess, noImplicitOverride)
npm run build       # emite dist/ (apenas src)
npm run cli -- demo
npm run serve       # servidor HTTP de demonstração
plain
