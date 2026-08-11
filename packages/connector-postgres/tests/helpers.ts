/**
 * connector-postgres — tests/helpers.ts
 */

import { createFixedClock, createIdGenerator } from 'connector-sdk';

import { createPostgresConnector } from '../src/core/connector.js';
import {
  createMemorySqlClient,
  type MemoryPersonRow,
  type MemorySqlClient,
} from '../src/core/sql-client.js';
import type { PostgresConnectorConfig } from '../src/core/types.js';

export const PEOPLE_COLUMNS = [
  { name: 'id', dataType: 'text', nullable: false, isPrimaryKey: true },
  { name: 'name', dataType: 'text', nullable: false },
  { name: 'email', dataType: 'text', nullable: false },
  { name: 'updated_at', dataType: 'timestamptz', nullable: false },
  { name: 'deleted_at', dataType: 'timestamptz', nullable: true },
];

export function seedPeople(n: number, baseIso = '2024-01-01T00:00:00.000Z'): MemoryPersonRow[] {
  const base = Date.parse(baseIso);
  const rows: MemoryPersonRow[] = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push({
      id: String(i),
      name: `Person ${i}`,
      email: `p${i}@example.com`,
      updated_at: new Date(base + i * 1000).toISOString(),
      deleted_at: null,
    });
  }
  return rows;
}

export function makeClient(n: number): MemorySqlClient {
  return createMemorySqlClient(seedPeople(n));
}

export function makeConnector(
  client: MemorySqlClient,
  overrides: Partial<PostgresConnectorConfig> = {},
) {
  return createPostgresConnector({
    connectorId: 'pg-test',
    sourceSystem: 'crm',
    tables: [{ name: 'people', primaryKey: 'id', columns: PEOPLE_COLUMNS }],
    client,
    pageSize: 100,
    clock: createFixedClock('2024-06-01T00:00:00.000Z'),
    nextId: createIdGenerator(),
    ...overrides,
  });
}
