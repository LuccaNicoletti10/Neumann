/**
 * action-engine — src/core/pg-events.ts
 * PostgreSQL OperationalEventStore (platform_operational_events).
 */

import type { OperationalEvent, OperationalEventStore, SqlClient } from 'contracts';

import type { Clock, IdGenerator } from './types.js';

export interface CreatePgOperationalEventStoreOptions {
  sql: SqlClient;
  clock: Clock;
  nextId: IdGenerator;
}

function rowToEvent(row: Record<string, unknown>): OperationalEvent {
  return {
    id: String(row.id),
    kind: row.kind as OperationalEvent['kind'],
    at: new Date(String(row.at)).toISOString(),
    ontologyId: row.ontology_id == null ? undefined : String(row.ontology_id),
    principal: row.principal == null ? undefined : String(row.principal),
    objectId: row.object_id == null ? undefined : String(row.object_id),
    objectTypeId: row.object_type_id == null ? undefined : String(row.object_type_id),
    primaryKey: row.primary_key == null ? undefined : String(row.primary_key),
    linkId: row.link_id == null ? undefined : String(row.link_id),
    linkTypeId: row.link_type_id == null ? undefined : String(row.link_type_id),
    actionTypeId: row.action_type_id == null ? undefined : String(row.action_type_id),
    actionExecutionId:
      row.action_execution_id == null ? undefined : String(row.action_execution_id),
    payload: (row.payload as Record<string, unknown>) ?? undefined,
  };
}

export function createPgOperationalEventStore(
  opts: CreatePgOperationalEventStoreOptions,
): OperationalEventStore {
  const { sql } = opts;
  return {
    async append(partial) {
      const event: OperationalEvent = {
        id: partial.id ?? opts.nextId('opev'),
        at: partial.at ?? opts.clock(),
        kind: partial.kind,
        ontologyId: partial.ontologyId,
        principal: partial.principal,
        objectId: partial.objectId,
        objectTypeId: partial.objectTypeId,
        primaryKey: partial.primaryKey,
        linkId: partial.linkId,
        linkTypeId: partial.linkTypeId,
        actionTypeId: partial.actionTypeId,
        actionExecutionId: partial.actionExecutionId,
        payload: partial.payload,
      };
      await sql.query(
        `INSERT INTO platform_operational_events (
           id, kind, at, ontology_id, principal,
           object_id, object_type_id, primary_key,
           link_id, link_type_id, action_type_id, action_execution_id, payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          event.id,
          event.kind,
          event.at,
          event.ontologyId ?? null,
          event.principal ?? null,
          event.objectId ?? null,
          event.objectTypeId ?? null,
          event.primaryKey ?? null,
          event.linkId ?? null,
          event.linkTypeId ?? null,
          event.actionTypeId ?? null,
          event.actionExecutionId ?? null,
          event.payload ? JSON.stringify(event.payload) : null,
        ],
      );
      return event;
    },

    async list(filter) {
      const result = await sql.query(
        `SELECT * FROM platform_operational_events
         WHERE ($1::text IS NULL OR ontology_id = $1)
           AND ($2::text IS NULL OR kind = $2)
           AND ($3::text IS NULL OR object_id = $3)
         ORDER BY at ASC
         LIMIT $4`,
        [
          filter?.ontologyId ?? null,
          filter?.kind ?? null,
          filter?.objectId ?? null,
          filter?.limit ?? 10_000,
        ],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToEvent);
    },
  };
}
