/**
 * event-bus — src/worker/outbox-worker.ts
 *
 * PEÇA 2 (fechamento do loop) — o consumidor que faltava.
 *
 * A action insere a intenção de side effect em outbox_events DENTRO da
 * transação. Este worker roda DEPOIS do commit: pega lotes com
 * FOR UPDATE SKIP LOCKED (multi-worker safe), despacha para o handler
 * registrado por topic, marca published_at. Falha => attempts+1 e retry
 * com backoff; acima de maxAttempts => dead letter (published_at setado
 * + payload marcado, para não travar a fila).
 *
 * Uso:
 *   const worker = createOutboxWorker({
 *     sql,
 *     handlers: {
 *       'action.side_effect.writeback': async (ev) => {
 *         await erpClient.update(ev.payload);   // o write-back de verdade
 *       },
 *     },
 *   });
 *   worker.start();          // polling
 *   await worker.drainOnce() // ou manual (testes / cron)
 */

import type { SqlClient } from 'contracts';

export interface OutboxEventRow {
  eventId: string;
  topic: string;
  orderingKey: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  createdAt: string;
  attempts: number;
}

export type OutboxHandler = (event: OutboxEventRow) => Promise<void>;

export interface CreateOutboxWorkerOptions {
  sql: SqlClient & {
    transaction?: <T>(fn: (tx: SqlClient) => Promise<T>) => Promise<T>;
  };
  handlers: Record<string, OutboxHandler>;
  /** Tamanho do lote por ciclo. Default 20. */
  batchSize?: number;
  /** Intervalo de polling em ms. Default 1000. */
  pollIntervalMs?: number;
  /** Tentativas antes de dead-letter. Default 8. */
  maxAttempts?: number;
  onError?: (event: OutboxEventRow, error: unknown) => void;
  onDeadLetter?: (event: OutboxEventRow, error: unknown) => void;
}

export interface OutboxWorker {
  /** Processa um lote e retorna quantos eventos tratou. */
  drainOnce(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
  running(): boolean;
}

function rowToEvent(row: Record<string, unknown>): OutboxEventRow {
  return {
    eventId: String(row.event_id),
    topic: String(row.topic),
    orderingKey: String(row.ordering_key),
    payload: (row.payload as Record<string, unknown>) ?? {},
    principal: String(row.principal),
    tenantId: String(row.tenant_id ?? 'default'),
    traceId: String(row.trace_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    attempts: Number(row.attempts ?? 0),
  };
}

export function createOutboxWorker(opts: CreateOutboxWorkerOptions): OutboxWorker {
  const {
    sql,
    handlers,
    batchSize = 20,
    pollIntervalMs = 1000,
    maxAttempts = 8,
  } = opts;
  const onError = opts.onError ?? (() => {});
  const onDeadLetter =
    opts.onDeadLetter ??
    ((ev, err) =>
      console.error(`[outbox] DEAD LETTER ${ev.eventId} topic=${ev.topic}:`, err));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let inFlight: Promise<void> = Promise.resolve();

  async function processBatch(tx: SqlClient): Promise<number> {
    const res = await tx.query(
      `SELECT * FROM outbox_events
       WHERE published_at IS NULL
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    const rows = (res.rows as Record<string, unknown>[]).map(rowToEvent);

    for (const ev of rows) {
      const handler = handlers[ev.topic];
      if (!handler) {
        // Sem handler não é erro fatal: marca published com flag para inspeção.
        await tx.query(
          `UPDATE outbox_events
           SET published_at = now(),
               payload = payload || '{"__unhandled": true}'::jsonb
           WHERE event_id = $1`,
          [ev.eventId],
        );
        continue;
      }
      try {
        await handler(ev);
        await tx.query(
          `UPDATE outbox_events SET published_at = now() WHERE event_id = $1`,
          [ev.eventId],
        );
      } catch (err) {
        onError(ev, err);
        if (ev.attempts + 1 >= maxAttempts) {
          onDeadLetter(ev, err);
          await tx.query(
            `UPDATE outbox_events
             SET published_at = now(),
                 attempts = attempts + 1,
                 payload = payload || jsonb_build_object(
                   '__dead_letter', true,
                   '__last_error', $2::text
                 )
             WHERE event_id = $1`,
            [ev.eventId, err instanceof Error ? err.message : String(err)],
          );
        } else {
          await tx.query(
            `UPDATE outbox_events SET attempts = attempts + 1 WHERE event_id = $1`,
            [ev.eventId],
          );
        }
      }
    }
    return rows.length;
  }

  async function drainOnce(): Promise<number> {
    if (sql.transaction) {
      return sql.transaction((tx) => processBatch(tx));
    }
    return processBatch(sql);
  }

  function schedule() {
    if (!active) return;
    timer = setTimeout(() => {
      inFlight = drainOnce()
        .catch((err) => console.error('[outbox] cycle failed:', err))
        .then(() => schedule()) as Promise<void>;
    }, pollIntervalMs);
  }

  return {
    drainOnce,
    start() {
      if (active) return;
      active = true;
      schedule();
    },
    async stop() {
      active = false;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
    running: () => active,
  };
}

/* ------------------------------------------------------------------ */
/* Handler pronto: write-back via SQL para tabela espelho do ERP.      */
/* Troque por chamada de API quando o canal do ERP existir.            */
/* ------------------------------------------------------------------ */

export function createSqlMirrorWritebackHandler(opts: {
  sql: SqlClient;
  /** ex.: 'erp_writeback_queue' — criada pelo cliente/integração. */
  table: string;
}): OutboxHandler {
  return async (ev) => {
    await opts.sql.query(
      `INSERT INTO ${opts.table.replace(/[^a-zA-Z0-9_]/g, '')} (event_id, payload, principal, trace_id, created_at)
       VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (event_id) DO NOTHING`,
      [ev.eventId, JSON.stringify(ev.payload), ev.principal, ev.traceId],
    );
  };
}
