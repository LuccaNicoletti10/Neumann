/**
 * connector-postgres — src/index.ts
 */

export { createPostgresConnector } from './core/connector.js';
export {
  createMemorySqlClient,
  type SqlClient,
  type MemorySqlClient,
  type MemoryPersonRow,
} from './core/sql-client.js';
export { encodeCursor, decodeCursor, type PgCursorState } from './core/cursor.js';
export type { PostgresConnectorConfig, TableConfig } from './core/types.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
