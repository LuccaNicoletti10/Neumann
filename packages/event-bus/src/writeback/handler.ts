/**
 * event-bus — OutboxHandler that runs a WritebackConnector + execution log.
 * HTTP runs outside the outbox claim transaction (worker commits lease first).
 */

import type { SqlClient } from 'contracts';

import type { OutboxHandler } from '../worker/types.js';
import {
  createPgWritebackExecutionStore,
  hashWritebackRequest,
  type WritebackExecutionStore,
} from './executions.js';
import { createSqlMirrorConnector } from './sql-mirror.js';
import type { WritebackConnector, WritebackRequest } from './types.js';

export function createWritebackHandler(opts: {
  connector: WritebackConnector;
  executions: WritebackExecutionStore;
}): OutboxHandler {
  return async (ev) => {
    const payload = ev.payload;
    const connectorId =
      typeof payload.connectorId === 'string' ? payload.connectorId : opts.connector.kind;
    const operation = typeof payload.operation === 'string' ? payload.operation : 'writeback';
    const req: WritebackRequest = {
      eventId: ev.eventId,
      connectorId,
      operation,
      payload,
      principal: ev.principal,
      tenantId: ev.tenantId,
      traceId: ev.traceId,
      attempt: ev.attempts,
      idempotencyKey: `neumann:${ev.eventId}`,
    };
    const started = await opts.executions.start(req, hashWritebackRequest(req));
    const result = await opts.connector.execute(req);
    await opts.executions.finish(started.id, result);
    if (!result.ok) {
      const err = new Error(result.error ?? `writeback failed (${opts.connector.kind})`);
      (err as Error & { retryable?: boolean }).retryable = result.retryable !== false;
      throw err;
    }
  };
}

/** SQL-mirror sink used in tests — not a real ERP. */
export function createSqlMirrorWritebackHandler(opts: {
  sql: SqlClient;
  table?: string;
  executions?: WritebackExecutionStore;
}): OutboxHandler {
  return createWritebackHandler({
    connector: createSqlMirrorConnector(
      opts.table ? { sql: opts.sql, table: opts.table } : { sql: opts.sql },
    ),
    executions: opts.executions ?? createPgWritebackExecutionStore({ sql: opts.sql }),
  });
}
