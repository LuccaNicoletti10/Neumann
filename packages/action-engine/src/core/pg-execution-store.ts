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

function asVersionMap(value: unknown): Record<string, number> | undefined {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = Number(v);
  }
  return out;
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
    ontologyVersionId: row.ontology_version_id == null ? undefined : String(row.ontology_version_id),
    actionTypeHash: row.action_type_hash == null ? undefined : String(row.action_type_hash),
    expectedObjectVersions: asVersionMap(row.expected_object_versions),
    policyGeneration:
      row.policy_generation == null ? undefined : Number(row.policy_generation),
    requestHash: row.request_hash == null ? undefined : String(row.request_hash),
    hashVersion: row.hash_version == null ? undefined : Number(row.hash_version),
  };
}

const ENVELOPE_COLUMNS = `
           id, ontology_id, action_type_id, action_api_name, parameters,
           principal, status, idempotency_key, result, error, audit_entry_id,
           started_at, finished_at, approval,
           ontology_version_id, action_type_hash, expected_object_versions, policy_generation,
           request_hash, hash_version`;

function envelopeValues(execution: ActionExecution): unknown[] {
  return [
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
    execution.ontologyVersionId ?? null,
    execution.actionTypeHash ?? null,
    execution.expectedObjectVersions
      ? JSON.stringify(execution.expectedObjectVersions)
      : null,
    execution.policyGeneration ?? null,
    execution.requestHash ?? null,
    execution.hashVersion ?? null,
  ];
}

async function findByScopedKey(
  sql: CreatePgActionExecutionStoreOptions['sql'],
  ontologyId: string,
  principal: string,
  actionApiName: string,
  key: string,
): Promise<ActionExecution | undefined> {
  const result = await sql.query(
    `SELECT * FROM platform_action_executions
     WHERE ontology_id = $1 AND principal = $2
       AND action_api_name = $3 AND idempotency_key = $4
     LIMIT 1`,
    [ontologyId, principal, actionApiName, key],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? rowToExecution(row) : undefined;
}

export function createPgActionExecutionStore(
  opts: CreatePgActionExecutionStoreOptions,
): ActionExecutionStore {
  const { sql } = opts;

  return {
    async save(execution) {
      await sql.query(
        `INSERT INTO platform_action_executions (${ENVELOPE_COLUMNS}
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18,$19,$20)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           error = EXCLUDED.error,
           audit_entry_id = EXCLUDED.audit_entry_id,
           finished_at = EXCLUDED.finished_at,
           approval = EXCLUDED.approval,
           ontology_version_id = COALESCE(EXCLUDED.ontology_version_id, platform_action_executions.ontology_version_id),
           action_type_hash = COALESCE(EXCLUDED.action_type_hash, platform_action_executions.action_type_hash),
           expected_object_versions = COALESCE(EXCLUDED.expected_object_versions, platform_action_executions.expected_object_versions),
           policy_generation = COALESCE(EXCLUDED.policy_generation, platform_action_executions.policy_generation),
           request_hash = COALESCE(platform_action_executions.request_hash, EXCLUDED.request_hash),
           hash_version = COALESCE(platform_action_executions.hash_version, EXCLUDED.hash_version)`,
        envelopeValues(execution),
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

    async findByIdempotencyKey(ontologyId, actionApiName, key, principal) {
      // WHY: scoped to caller's principal — mirrors the unique index scope
      // (ontology_id, principal, action_api_name, idempotency_key). A caller
      // must never receive another principal's execution via this method.
      return findByScopedKey(sql, ontologyId, principal, actionApiName, key);
    },

    async claim(execution) {
      if (!execution.idempotencyKey) {
        await this.save(execution);
        return { claimed: true, execution };
      }
      // WHY: ON CONFLICT uses the (ontology_id, principal, action_api_name, idempotency_key)
      // index (migration 0020). Different principals with the same key are independent executions.
      const inserted = await sql.query(
        `INSERT INTO platform_action_executions (${ENVELOPE_COLUMNS}
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18,$19,$20)
         ON CONFLICT (ontology_id, principal, action_api_name, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        envelopeValues(execution),
      );
      if (inserted.rows[0]) {
        return {
          claimed: true,
          execution: rowToExecution(inserted.rows[0] as Record<string, unknown>),
        };
      }
      // Another row with the same (ontologyId, principal, actionApiName, idempotencyKey) exists.
      const existing = await findByScopedKey(
        sql,
        execution.ontologyId,
        execution.principal,
        execution.actionApiName,
        execution.idempotencyKey,
      );
      if (!existing) {
        throw new Error('idempotency conflict without existing execution');
      }
      // WHY: same scope + different hash = IDEMPOTENCY_CONFLICT, zero writes.
      if (
        execution.requestHash &&
        existing.requestHash &&
        existing.requestHash !== execution.requestHash
      ) {
        const err: Error & { code?: string } = new Error(
          `idempotency conflict: same key "${execution.idempotencyKey}" previously used with a different request hash`,
        );
        err.code = 'IDEMPOTENCY_CONFLICT';
        throw err;
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
