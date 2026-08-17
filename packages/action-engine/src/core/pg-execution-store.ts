/**
 * action-engine — src/core/pg-execution-store.ts
 * PostgreSQL ActionExecutionStore. Idempotency via unique index.
 */

import type {
  ActionExecution,
  ActionExecutionStatus,
  ActionExecutionStore,
  SqlClient,
} from 'contracts';

export interface CreatePgActionExecutionStoreOptions {
  sql: SqlClient;
}

function rowToExecution(row: Record<string, unknown>): ActionExecution {
  return {
    id: String(row.id),
    ontologyId: String(row.ontology_id),
    actionTypeId: String(row.action_type_id),
    actionApiName: String(row.action_api_name),
    parameters: (row.parameters as Record<string, unknown>) ?? {},
    principal: String(row.principal),
    status: String(row.status) as ActionExecutionStatus,
    idempotencyKey: row.idempotency_key == null ? undefined : String(row.idempotency_key),
    startedAt: new Date(String(row.started_at)).toISOString(),
    finishedAt: row.finished_at == null ? undefined : new Date(String(row.finished_at)).toISOString(),
    result: (row.result as Record<string, unknown>) ?? undefined,
    error: row.error == null ? undefined : String(row.error),
    auditEntryId: row.audit_entry_id == null ? undefined : String(row.audit_entry_id),
    approval: (row.approval as ActionExecution['approval']) ?? undefined,
  };
}

export function createPgActionExecutionStore(
  opts: CreatePgActionExecutionStoreOptions,
): ActionExecutionStore {
  const { sql } = opts;

  return {
    async save(execution) {
      await sql.query(
        `INSERT INTO platform_action_executions (
           id, ontology_id, action_type_id, action_api_name, parameters,
           principal, status, idempotency_key, result, error, audit_entry_id,
           started_at, finished_at, approval
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           error = EXCLUDED.error,
           audit_entry_id = EXCLUDED.audit_entry_id,
           finished_at = EXCLUDED.finished_at,
           approval = EXCLUDED.approval`,
        [
          execution.id,
          execution.ontologyId,
          execution.actionTypeId,
          execution.actionApiName,
          JSON.stringify(execution.parameters ?? {}),
          execution.principal,
          execution.status,
          execution.idempotencyKey ?? null,
          execution.result ? JSON.stringify(execution.result) : null,
          execution.error ?? null,
          execution.auditEntryId ?? null,
          execution.startedAt,
          execution.finishedAt ?? null,
          execution.approval ? JSON.stringify(execution.approval) : null,
        ],
      );
    },

    async get(id) {
      const result = await sql.query(
        `SELECT * FROM platform_action_executions WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToExecution(row) : undefined;
    },

    async findByIdempotencyKey(ontologyId, actionApiName, key) {
      const result = await sql.query(
        `SELECT * FROM platform_action_executions
         WHERE ontology_id = $1 AND action_api_name = $2 AND idempotency_key = $3`,
        [ontologyId, actionApiName, key],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToExecution(row) : undefined;
    },

    async claim(execution) {
      if (!execution.idempotencyKey) {
        await this.save(execution);
        return { claimed: true, execution };
      }
      const inserted = await sql.query(
        `INSERT INTO platform_action_executions (
           id, ontology_id, action_type_id, action_api_name, parameters,
           principal, status, idempotency_key, started_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         ON CONFLICT (ontology_id, action_api_name, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          execution.id,
          execution.ontologyId,
          execution.actionTypeId,
          execution.actionApiName,
          JSON.stringify(execution.parameters ?? {}),
          execution.principal,
          execution.status,
          execution.idempotencyKey,
          execution.startedAt,
        ],
      );
      if (inserted.rows[0]) {
        return {
          claimed: true,
          execution: rowToExecution(inserted.rows[0] as Record<string, unknown>),
        };
      }
      const existing = await this.findByIdempotencyKey(
        execution.ontologyId,
        execution.actionApiName,
        execution.idempotencyKey,
      );
      if (!existing) {
        throw new Error('idempotency conflict without existing execution');
      }
      return { claimed: false, execution: existing };
    },

    async casStatus(id, from, to, patch) {
      const result = await sql.query(
        `UPDATE platform_action_executions
         SET status = $2,
             error = COALESCE($3, error),
             finished_at = COALESCE($4, finished_at),
             result = COALESCE($5::jsonb, result),
             audit_entry_id = COALESCE($6, audit_entry_id),
             approval = COALESCE($8::jsonb, approval)
         WHERE id = $1 AND status = $7
         RETURNING *`,
        [
          id,
          to,
          patch?.error ?? null,
          patch?.finishedAt ?? null,
          patch?.result ? JSON.stringify(patch.result) : null,
          patch?.auditEntryId ?? null,
          from,
          patch?.approval ? JSON.stringify(patch.approval) : null,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToExecution(row) : undefined;
    },
  };
}
