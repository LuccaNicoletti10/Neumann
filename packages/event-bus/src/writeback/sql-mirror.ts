/**
 * event-bus — SqlMirrorConnector
 * Internal ERP *simulator sink* (erp_writeback_queue). Not a real ERP.
 */

import type { SqlClient } from 'contracts';

import type { WritebackConnector, WritebackRequest, WritebackResult } from './types.js';

export function createSqlMirrorConnector(opts: {
  sql: SqlClient;
  table?: string;
}): WritebackConnector {
  const table = (opts.table ?? 'erp_writeback_queue').replace(/[^a-zA-Z0-9_]/g, '');
  return {
    kind: 'sql-mirror',
    async execute(req: WritebackRequest): Promise<WritebackResult> {
      await opts.sql.query(
        `INSERT INTO ${table} (event_id, payload, principal, trace_id, created_at)
         VALUES ($1, $2::jsonb, $3, $4, now())
         ON CONFLICT (event_id) DO NOTHING`,
        [req.eventId, JSON.stringify(req.payload), req.principal, req.traceId],
      );
      return {
        ok: true,
        externalId: req.eventId,
        externalOperationId: req.eventId,
        statusCode: 200,
        responseMetadata: { sink: 'sql-mirror', table },
      };
    },
  };
}
