
Agendador justo com **fila de execução limitada (bounded)** para cargas mistas de
consultas, em TypeScript/ESM, **zero dependências de runtime** e **determinismo total**
(Clock injetável — sem timers, `Date.now` ou `Math.random` na lógica).

Este pacote é uma **implementação funcional independente** dos mecanismos descritos na
patente **US 9,715,526 B2** (Palantir, *"Fair Scheduling for Mixed-Query Loads"* —
continuação). **Nenhum texto dos claims é reproduzido**: os mecanismos foram
reimplementados de forma original a partir da descrição funcional.

## Mecanismos implementados

1. **Job + cost estimate** — submissão de `QueryJob` com `costEstimate` (número esperado
   de resultados) e parâmetros opcionais.
2. **Divisão baseada no cost estimate** — o job é dividido (de forma lazy) em sub-query
   tasks; **cada sub-task retorna MENOS resultados que o cost estimate**
   (`chooseTaskLimit(costEstimate, maxTaskSize)` garante `limit < costEstimate` sempre
   que `costEstimate > 1`; `costEstimate = 1` → task única de 1).
3. **Keyset chaining com rate limiter** — a 1ª sub-task usa `LIMIT N`; ao terminar cada
   sub-task, o scheduler **determina o valor do último resultado retornado** e a próxima
   sub-task **inclui esse valor** (`after = lastValue`, seek pagination). Fim da cadeia:
   uma sub-task retorna `< limit` linhas.
4. **Job execution queue BOUNDED** — a fila tem tamanho máximo configurável
   (`maxQueueSize`). Um job item ocupa um slot **do primeiro dequeue até a conclusão de
   TODAS as sub-tasks**: itens re-enfileirados (round-robin) e itens "em voo" continuam
   contando como ocupantes.
5. **Backpressure com waiting queue** — submissão com fila não cheia → entra no fim da
   execution queue; fila cheia → vai para uma **waiting queue FIFO separada** e só entra
   na execution quando uma vaga abre (vaga abre somente quando um job **completa** ou é
   **cancelado** — nunca por re-enqueue).
6. **Round-robin com marcação de progresso** — `step()` faz exatamente um ciclo:
   dequeue da frente → executa 1 sub-task → re-enfileira no fim marcando progresso
   (`subTaskSeqCompleted` + `lastValue`); sem mais sub-tasks → completa, libera o slot e
   promove o 1º da waiting queue (que entra no **fim** da execution).
7. **Cancelamento** — remove o job item da execution queue (liberando slot → promove o
   1º da waiting) ou da waiting queue.
8. **Migração de nó** — remove o job item cujas sub-tasks executavam num nó A, gera um
   **2º query job baseado no 1º** (preservando progresso e resultados) e o enfileira para
   executar sua 1ª sub-task num **nó B ≠ A** (DBMS multi-nó simulado).
9. **Métricas e comparador** — latência de 1º resultado e de conclusão por job;
   `waitingQueueEnqueuedCount`; `runComparison` executa a mesma carga em fair-bounded e
   em **FCFS** e mostra a redução de latência dos jobs de baixo custo.

## Estrutura
src/core/types.ts         QueryJob, SubQueryTask, JobRecord/JobItem, JobStatus, Row, Clock injetável
src/core/dbms.ts          DatabaseNode + DatabaseManagementSystem (multi-nó, rows ordenadas por id,
executa {after, limit}; latência determinística baseMs + perRowMsrows via Clock)
src/core/task-splitter.ts Geração lazy de sub-tasks keyset + chooseTaskLimit (invariante limit < costEstimate)
src/core/bounded-queue.ts BoundedJobQueue (maxQueueSize, admit/dequeue/reenqueue/complete/remove, snapshot)
src/core/scheduler.ts     BoundedFairScheduler (submit/step/runUntilIdle/cancel/migrate/métricas/snapshot)
src/core/compare.ts       runComparison: fair-bounded vs FCFS lado a lado
src/server/index.ts       HTTP só com node:http (zero deps)
src/cli.ts                CLI: submit/run/queue/cancel/compare/serve/demo
src/index.ts              Re-exports públicos
tests/.test.ts           Vitest — cobre TODOS os mecanismos 1–9, HTTP e CLI
plain

## Uso como biblioteca

```ts
import {
  BoundedFairScheduler,
  DatabaseManagementSystem,
  ManualClock,
  generateRows,
  runComparison,
} from 'bounded-fair-scheduler';

const dbms = DatabaseManagementSystem.uniform(['node-A', 'node-B'], generateRows(1000));
const clock = new ManualClock(0);
const scheduler = new BoundedFairScheduler({
  maxQueueSize: 2,   // fila BOUNDED
  maxTaskSize: 50,   // teto do rate limiter por sub-task
  clock,
  dbms,
  defaultNode: 'node-A',
});

const big = scheduler.submit({ query: 'SELECT * FROM vendas', costEstimate: 1000 });
const small = scheduler.submit({ query: 'SELECT * FROM usuarios WHERE id = ?', costEstimate: 10, params: { id: 7 } });
// big.admitted === 'execution'; se a fila encher, admitted === 'waiting'

scheduler.step();          // exatamente 1 ciclo (dequeue → 1 sub-task → reenqueue/complete)
scheduler.runUntilIdle();  // até as filas esvaziarem

scheduler.getMetrics(small.jobId); // firstResultLatencyMs, completionLatencyMs, waitingTimeMs...
scheduler.summary();               // waitingQueueEnqueuedCount, promotedFromWaitingCount...

scheduler.cancel('job-1');
scheduler.migrate(big.jobId, 'node-B'); // 2º job continua no nó B sem perda nem duplicata

const report = runComparison(
  [{ query: 'pesada', costEstimate: 1000 }, { query: 'leve', costEstimate: 10 }],
  { dbms, maxQueueSize: 8, maxTaskSize: 50 },
);
// report.lowCost.completionLatencyReductionPct > 0 → fair-bounded vence FCFS
Uso via CLI
bash
npm run cli -- demo                                   # carga mista com fila pequena (waiting queue + latências)
npm run cli -- submit --query "SELECT 1" --cost 100   # → {"jobId":"job-1","admitted":"execution"}
npm run cli -- submit --query "SELECT 2" --cost 10    # fila cheia → admitted: "waiting"
npm run cli -- queue                                  # snapshot execution + waiting com posições
npm run cli -- run                                    # round-robin até esvaziar + métricas
npm run cli -- cancel job-1                           # cancela (execution ou waiting)
npm run cli -- compare --file jobs.json               # fair-bounded vs FCFS
npm run serve -- --port 8080                          # servidor HTTP
Estado da CLI persiste em .bfs-state.json (ou --state <arquivo>). Tamanhos padrão:
--max-queue-size 2, --max-task-size 50 (valem na criação do estado).
Uso via HTTP
POST/GET com JSON; corpo máximo de 8 MB (MAX_BODY).
Table
Método	Rota	Descrição
GET	/health	{status:'ok'}
POST	/jobs	{query, costEstimate, params?, node?} → 201 {jobId, admitted}
GET	/jobs/:id	Métricas do job (404 se inexistente)
GET	/queue	Snapshot: execution + waiting com posições, ocupação, isFull
POST	/run	{steps?} → executa N ciclos ou até esvaziar
POST	/jobs/:id/cancel	Cancela na execution (promove waiting) ou na waiting
POST	/jobs/:id/migrate	{toNode} → 2º job no nó B ≠ A
POST	/compare	{jobs:[...]} → relatório fair-bounded vs FCFS
GET	/summary	Contadores globais + snapshot da fila
Erros: 400 (corpo/JSON inválido), 404 (rota/job inexistente), 413 (corpo > 8 MB).
Scripts
bash
npm install
npm test            # vitest — todos os mecanismos 1–9, HTTP e CLI
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
npm run build       # emite dist/ (ESM + .d.ts)
Determinismo
Toda a lógica depende apenas do Clock injetado (now(): number). O DBMS simulado
avança o relógio com a latência determinística baseMs + perRowMs * rowsRetornadas.
Nos testes usa-se ManualClock/FakeClock; não há timers, Date.now() nem
Math.random() na lógica do pacote.
plain

## `bounded-fair-scheduler/src/core/types.ts`
```ts
// bounded-fair-scheduler — tipos fundamentais do agendador.
// Implementa funcionalmente, de forma independente, os componentes "job de consulta com
// estimativa de custo" e "item de job com marcação de progresso" descritos na patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads", continuação).
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original dos mecanismos.

/** Relógio injetável: única fonte de tempo do sistema (determinismo total). */
export interface Clock {
  now(): number;
}

/**
 * Relógio que pode ser avançado pela latência simulada do DBMS
 * (o scheduler e o DBMS exigem esta variante; FakeClock/ManualClock a implementam).
 */
export interface AdvanceableClock extends Clock {
  advance(ms: number): void;
}

/** Relógio manual: avança somente via advance() (usado pela latência simulada do DBMS). */
export class ManualClock implements AdvanceableClock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error('ManualClock.advance: ms negativo');
    this.t += ms;
  }
}

/** Linha de resultado de uma consulta (ordenada por id na fonte de dados). */
export interface Row {
  id: number;
  value: string;
}

/**
 * Job de consulta submetido pelo cliente.
 * costEstimate = número esperado de resultados (dirige a divisão em sub-tarefas).
 */
export interface QueryJob {
  /** Texto da consulta (simbolico neste simulador). */
  query: string;
  /** Número esperado de resultados. */
  costEstimate: number;
  /** Parâmetros opcionais da consulta. */
  params?: Record<string, unknown>;
  /** Nó preferido do DBMS multi-nó (opcional). */
  node?: string;
  /** Id externo opcional; se ausente, o agendador gera um sequencial. */
  id?: string;
}

/**
 * Sub-tarefa de consulta gerada por keyset pagination:
 * - after: valor (id) do último resultado da sub-tarefa anterior (seek);
 * - limit: rate limiter da sub-tarefa — SEMPRE menor que costEstimate (>1).
 */
export interface SubQueryTask {
  jobId: string;
  seq: number;
  after: number | null;
  limit: number;
  node: string;
}

export type JobStatus =
  | 'queued-execution' // ocupa slot da fila de execução limitada
  | 'queued-waiting' // retido na fila de espera (backpressure)
  | 'running' // sub-tarefa em execução neste ciclo
  | 'completed'
  | 'cancelled'
  | 'migrated'; // substituído por um 2º job em outro nó (migração)

export type AdmissionTarget = 'execution' | 'waiting';

/**
 * Item de job: ocupa um slot da fila de execução desde o primeiro dequeue
 * até a conclusão de TODAS as sub-tarefas (mesmo re-enfileirado, continua contando).
 */
export interface JobRecord {
  jobId: string;
  query: string;
  params: Record<string, unknown>;
  costEstimate: number;
  node: string;
  status: JobStatus;
  /** Onde o job foi admitido na submissão. */
  admittedTo: AdmissionTarget;
  /** Sequência da última sub-tarefa completamente executada (marcação de progresso). */
  subTaskSeqCompleted: number;
  /** Valor (id) do último resultado retornado — encadeia a próxima sub-tarefa. */
  lastValue: number | null;
  /** Resultados agregados (ordenados, sem duplicatas). */
  rows: Row[];
  submittedAt: number;
  firstResultAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  waitingEnteredAt: number | null;
  promotedAt: number | null;
  migratedFrom: string | null;
  migratedTo: string | null;
  tasksExecuted: number;
}

/** Métricas públicas por job (latências relativas à submissão). */
export interface JobMetrics {
  jobId: string;
  status: JobStatus;
  admittedTo: AdmissionTarget;
  node: string;
  costEstimate: number;
  rowsReturned: number;
  tasksExecuted: number;
  submittedAt: number;
  /** Latência até o 1º resultado (ms simulados); null se nenhum resultado ainda. */
  firstResultLatencyMs: number | null;
  /** Latência até a conclusão total; null enquanto não concluído. */
  completionLatencyMs: number | null;
  /** Tempo retido na waiting queue; null se nunca esperou. */
  waitingTimeMs: number | null;
  migratedFrom: string | null;
  migratedTo: string | null;
}

/** Gera linhas determinísticas id=1..n (utilitário de testes/demo/CLI). */
export function generateRows(n: number, prefix = 'row'): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push({ id: i, value: `${prefix}-${i}` });
  }
  return rows;
}