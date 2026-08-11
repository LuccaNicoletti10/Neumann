/**
 * connector-postgres — src/core/connector.ts
 * Connector Postgres: snapshot paginado + CDC por updated_at.
 * NUNCA importa Ontology — só contracts + sdk.
 */

import type {
  CanonicalEvent,
  Connector,
  Cursor,
  HealthStatus,
  ObjectRef,
  SourceObject,
  SourceSchema,
} from 'contracts';
import {
  createDeterministicClock,
  createEventFactory,
  createIdGenerator,
  type EventFactory,
} from 'connector-sdk';

import { decodeCursor, encodeCursor, type PgCursorState } from './cursor.js';
import type { PostgresConnectorConfig, TableConfig } from './types.js';

interface RowRecord {
  [key: string]: unknown;
}

function tableOrThrow(tables: TableConfig[], name: string): TableConfig {
  const t = tables.find((x) => x.name === name);
  if (!t) throw new Error(`tabela não configurada: ${name}`);
  return t;
}

function rowPayload(row: RowRecord, pk: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v;
  }
  // garantir pk string no payload
  if (!(pk in out)) out[pk] = row[pk];
  return out;
}

function isDeleted(row: RowRecord, deletedCol: string): boolean {
  const v = row[deletedCol];
  return v !== null && v !== undefined && v !== '';
}

export function createPostgresConnector(config: PostgresConnectorConfig): Connector {
  const pageSize = config.pageSize ?? 500;
  const schemaVersion = config.schemaVersion ?? '1';
  const principal = config.principal ?? 'sa:ingest';
  const policyTags = config.policyTags ?? [];
  const clock = config.clock ?? createDeterministicClock();
  const nextId = config.nextId ?? createIdGenerator();
  const factory: EventFactory = createEventFactory({ clock, nextId, defaultPrincipal: principal });

  let current: PgCursorState = decodeCursor(config.initialCursorToken);

  const capabilities = ['snapshot', 'cdc'] as const;

  async function emitPage(
    table: TableConfig,
    rows: RowRecord[],
    mode: 'snapshot' | 'cdc',
  ): Promise<CanonicalEvent[]> {
    const pkCol = table.primaryKey;
    const deletedCol = table.deletedAtColumn ?? 'deleted_at';
    const updatedCol = table.updatedAtColumn ?? 'updated_at';
    const events: CanonicalEvent[] = [];

    for (const row of rows) {
      const pk = String(row[pkCol] ?? '');
      const updatedAt = String(row[updatedCol] ?? clock());
      const deleted = isDeleted(row, deletedCol);

      if (mode === 'snapshot') {
        current = { kind: 'snapshot', object: table.name, lastPk: pk };
      } else {
        current = { kind: 'cdc', object: table.name, updatedAt, lastPk: pk };
      }

      const checkpoint = encodeCursor(current);
      const payload = rowPayload(row, pkCol);
      if (deleted) payload.__deleted = true;

      events.push(
        factory.create({
          source_system: config.sourceSystem,
          source_object: table.name,
          source_primary_key: pk,
          schema_version: schemaVersion,
          connector_id: config.connectorId,
          checkpoint,
          principal,
          policy_tags: policyTags,
          payload,
          occurred_at: updatedAt,
        }),
      );
    }
    return events;
  }

  return {
    connectorId: config.connectorId,
    capabilities: [...capabilities],

    async discover(): Promise<SourceObject[]> {
      return config.tables.map((t) => ({
        name: t.name,
        sourceSystem: config.sourceSystem,
        kind: 'table',
      }));
    },

    async schema(obj: ObjectRef): Promise<SourceSchema> {
      const table = tableOrThrow(config.tables, obj.objectName);
      if (table.columns && table.columns.length > 0) {
        return {
          object: obj,
          columns: table.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
          })),
          schemaVersion,
        };
      }
      const { rows } = await config.client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        is_pk?: boolean;
      }>(
        `SELECT column_name, data_type, is_nullable, is_pk
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [table.name],
      );
      return {
        object: obj,
        columns: rows.map((r) => ({
          name: r.column_name,
          dataType: r.data_type,
          nullable: r.is_nullable === 'YES',
          isPrimaryKey: Boolean(r.is_pk) || r.column_name === table.primaryKey,
        })),
        schemaVersion,
      };
    },

    async *snapshot(obj: ObjectRef): AsyncIterable<CanonicalEvent> {
      const table = tableOrThrow(config.tables, obj.objectName);
      // Retomar se já estamos em snapshot desta tabela
      let lastPk: string | null = null;
      if (current.kind === 'snapshot' && current.object === table.name) {
        lastPk = current.lastPk;
      } else {
        current = { kind: 'snapshot', object: table.name, lastPk: null };
      }

      for (;;) {
        const { rows } = await config.client.query<RowRecord>(
          `SELECT * FROM ${table.name}
           WHERE ($1::text IS NULL OR id > $1)
           ORDER BY id ASC
           LIMIT $2`,
          [lastPk, pageSize],
        );
        if (rows.length === 0) break;
        const events = await emitPage(table, rows, 'snapshot');
        for (const e of events) yield e;
        const last = rows[rows.length - 1]!;
        lastPk = String(last[table.primaryKey]);
        if (rows.length < pageSize) break;
      }
    },

    async *read(cursor: Cursor): AsyncIterable<CanonicalEvent> {
      const state = decodeCursor(cursor.token || encodeCursor(current));
      // Inferir tabela: do cursor, ou da config (primeira)
      const objectName =
        state.kind === 'cdc' || state.kind === 'snapshot'
          ? state.object
          : config.tables[0]?.name;
      if (!objectName) return;
      const table = tableOrThrow(config.tables, objectName);

      let updatedAt = '';
      let lastPk = '';
      if (state.kind === 'cdc') {
        updatedAt = state.updatedAt;
        lastPk = state.lastPk;
      } else if (state.kind === 'snapshot' && state.lastPk) {
        // Após snapshot completo, CDC começa "depois" do que já vimos:
        // usamos updated_at mínimo + lastPk do snapshot como ponto de partida fraco.
        // Na prática: watermark vazio + pk do último snapshot → só linhas com updated_at
        // posterior ou mesmo instante com pk maior. Para gate, após snapshot full
        // o caller tipicamente inicia CDC com cursor empty ou cdc inicial.
        lastPk = state.lastPk;
        updatedAt = '';
      }

      current =
        state.kind === 'cdc'
          ? state
          : { kind: 'cdc', object: table.name, updatedAt, lastPk };

      for (;;) {
        const { rows } = await config.client.query<RowRecord>(
          `SELECT * FROM ${table.name}
           WHERE updated_at > $1
              OR (updated_at = $1 AND id > $2)
           ORDER BY updated_at ASC, id ASC
           LIMIT $3`,
          [updatedAt, lastPk, pageSize],
        );
        if (rows.length === 0) break;
        const events = await emitPage(table, rows, 'cdc');
        for (const e of events) yield e;
        const last = rows[rows.length - 1]!;
        updatedAt = String(last[table.updatedAtColumn ?? 'updated_at']);
        lastPk = String(last[table.primaryKey]);
        if (rows.length < pageSize) break;
      }
    },

    async checkpoint(): Promise<Cursor> {
      return { token: encodeCursor(current) };
    },

    async health(): Promise<HealthStatus> {
      const checkedAt = clock();
      try {
        await config.client.query('SELECT 1 AS ok');
        return { state: 'ok', checkedAt, message: 'sql client ok' };
      } catch (err) {
        return {
          state: 'down',
          checkedAt,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
