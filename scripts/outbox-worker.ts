/**
 * Outbox worker — drains action.side_effect.writeback after commit.
 * Usage: DATABASE_URL=postgres://... pnpm outbox-worker
 */

import {
  createOutboxWorker,
  createSqlMirrorWritebackHandler,
} from 'event-bus';
import { createPgSqlClient } from 'object-platform';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const sql = createPgSqlClient({ connectionString: url });
const worker = createOutboxWorker({
  sql,
  handlers: {
    'action.side_effect.writeback': createSqlMirrorWritebackHandler({
      sql,
      table: 'erp_writeback_queue',
    }),
  },
  maxAttempts: 8,
});

worker.start();
console.log('Neumann outbox worker started');

const shutdown = async () => {
  await worker.stop();
  await sql.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
