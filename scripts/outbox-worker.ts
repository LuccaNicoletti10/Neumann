/**
 * Outbox worker — drains action.side_effect.writeback after commit.
 * Usage: DATABASE_URL=postgres://... pnpm outbox-worker
 */

import {
  createHttpWritebackConnector,
  createOutboxWorker,
  createPgWritebackExecutionStore,
  createSqlMirrorWritebackHandler,
  createWritebackHandler,
} from 'event-bus';
import { createPgSqlClient } from 'object-platform';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const sql = createPgSqlClient({ connectionString: url });
const erpUrl = process.env.ERP_WRITEBACK_URL;
const executions = createPgWritebackExecutionStore({ sql });
const writebackHandler = erpUrl
  ? createWritebackHandler({
      connector: createHttpWritebackConnector({ baseUrl: erpUrl }),
      executions,
    })
  : createSqlMirrorWritebackHandler({
      sql,
      table: 'erp_writeback_queue',
      executions,
    });

const worker = createOutboxWorker({
  sql,
  handlers: {
    'action.side_effect.writeback': writebackHandler,
  },
  maxAttempts: 8,
});

worker.start();
console.log(
  `Neumann outbox worker started (${erpUrl ? `HTTP ${erpUrl}` : 'sql-mirror sink, not a real ERP'})`,
);

const shutdown = async () => {
  await worker.stop();
  await sql.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
