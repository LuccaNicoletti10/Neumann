/**
 * ingestion-runtime — PG adapter for the existing CheckpointStore port.
 */

import type { SqlClient } from 'contracts';
import type { CheckpointStore } from 'connector-sdk';

export function createPgCheckpointStore(opts: { sql: SqlClient }): CheckpointStore {
  const { sql } = opts;
  return {
    async get(connectorId, objectName) {
      const found = await sql.query(
        `SELECT token FROM ingestion_checkpoints WHERE connector_id = $1 AND object_name = $2`,
        [connectorId, objectName],
      );
      const token = found.rows[0]?.token;
      return typeof token === 'string' ? { token } : null;
    },
    async set(connectorId, objectName, cursor) {
      await sql.query(
        `INSERT INTO ingestion_checkpoints (connector_id, object_name, token)
         VALUES ($1, $2, $3)
         ON CONFLICT (connector_id, object_name) DO UPDATE SET token = EXCLUDED.token`,
        [connectorId, objectName, cursor.token],
      );
    },
    async delete(connectorId, objectName) {
      await sql.query(
        `DELETE FROM ingestion_checkpoints WHERE connector_id = $1 AND object_name = $2`,
        [connectorId, objectName],
      );
    },
  };
}
