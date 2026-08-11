/**
 * connector-postgres — src/core/types.ts
 */

import type { SqlClient } from './sql-client.js';
import type { Clock, IdGenerator } from 'connector-sdk';

export interface TableConfig {
  name: string;
  primaryKey: string;
  /** Coluna de watermark para CDC (default updated_at). */
  updatedAtColumn?: string;
  /** Coluna de soft-delete (default deleted_at). */
  deletedAtColumn?: string;
  columns?: Array<{
    name: string;
    dataType: string;
    nullable: boolean;
    isPrimaryKey?: boolean;
  }>;
}

export interface PostgresConnectorConfig {
  connectorId: string;
  sourceSystem: string;
  tables: TableConfig[];
  client: SqlClient;
  pageSize?: number;
  schemaVersion?: string;
  principal?: string;
  policyTags?: string[];
  clock?: Clock;
  nextId?: IdGenerator;
  /** Cursor inicial (ex.: após restart a partir do CheckpointStore). */
  initialCursorToken?: string;
}
