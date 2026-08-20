import type {
  FunctionExecutionRecord,
  FunctionExecutionStore,
} from './execution-store.js';
import {
  FunctionIdempotencyConflictError,
  FunctionLeaseHeldError,
  FunctionTerminalError,
} from './errors.js';
import type { FunctionExecutionStatus, FunctionTypedError, SqlClient } from 'contracts';
import { isFunctionTerminal } from 'contracts';

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function rowToRecord(row: Record<string, unknown>): FunctionExecutionRecord {
  return {
    executionId: String(row.id),
    pin: {
      ontologyId: String(row.ontology_id),
      ontologyVersionId: String(row.ontology_version_id),
      functionId: String(row.function_id),
      functionVersion: Number(row.function_version),
      artifactHash: String(row.artifact_hash),
      inputSchemaHash: String(row.input_schema_hash),
      outputSchemaHash: String(row.output_schema_hash),
    },
    principal: String(row.principal),
    parameters: parseJson(row.parameters, {}),
    parametersHash: String(row.parameters_hash),
    objectRefs: parseJson(row.object_refs, []),
    objectSnapshot: parseJson(row.object_snapshot, []),
    readAsOf: toIso(row.read_as_of),
    readSeq: Number(row.read_seq ?? 0),
    policyGeneration: Number(row.policy_generation),
    idempotencyKey: row.idempotency_key == null ? undefined : String(row.idempotency_key),
    requestHash: row.request_hash == null ? undefined : String(row.request_hash),
    status: String(row.status) as FunctionExecutionStatus,
    result: row.result == null ? undefined : parseJson(row.result, null),
    error: row.error == null ? undefined : parseJson<FunctionTypedError | undefined>(row.error, undefined),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    startedAt: row.started_at == null ? undefined : toIso(row.started_at),
    finishedAt: row.finished_at == null ? undefined : toIso(row.finished_at),
    leaseOwner: row.lease_owner == null ? undefined : String(row.lease_owner),
    leaseExpiresAt:
      row.lease_expires_at == null ? undefined : toIso(row.lease_expires_at),
    attempt: Number(row.attempt),
    logEvents: parseJson(row.log_events, []),
  };
}

const COLUMNS = `id, ontology_id, ontology_version_id, function_id, function_version,
  artifact_hash, input_schema_hash, output_schema_hash, principal, parameters, parameters_hash,
  object_refs, object_snapshot, read_as_of, read_seq, policy_generation, idempotency_key, request_hash,
  status, result, error, created_at, updated_at, started_at, finished_at,
  lease_owner, lease_expires_at, attempt, log_events`;

export function createPgFunctionExecutionStore(opts: { sql: SqlClient }): FunctionExecutionStore {
  const { sql } = opts;
  return {
    async insert(execution) {
      try {
        await sql.query(
          `INSERT INTO function_executions (
             id, ontology_id, ontology_version_id, function_id, function_version,
             artifact_hash, input_schema_hash, output_schema_hash, principal, parameters,
             parameters_hash, object_refs, object_snapshot, read_as_of, read_seq, policy_generation,
             idempotency_key, request_hash, status, result, error, created_at, updated_at,
             started_at, finished_at, lease_owner, lease_expires_at, attempt, log_events
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14,$15,$16,
             $17,$18,$19,$20::jsonb,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29::jsonb
           )`,
          [
            execution.executionId,
            execution.pin.ontologyId,
            execution.pin.ontologyVersionId,
            execution.pin.functionId,
            execution.pin.functionVersion,
            execution.pin.artifactHash,
            execution.pin.inputSchemaHash,
            execution.pin.outputSchemaHash,
            execution.principal,
            JSON.stringify(execution.parameters),
            execution.parametersHash,
            JSON.stringify(execution.objectRefs),
            JSON.stringify(execution.objectSnapshot),
            execution.readAsOf,
            execution.readSeq,
            execution.policyGeneration,
            execution.idempotencyKey ?? null,
            execution.requestHash ?? null,
            execution.status,
            execution.result == null ? null : JSON.stringify(execution.result),
            execution.error == null ? null : JSON.stringify(execution.error),
            execution.createdAt,
            execution.updatedAt,
            execution.startedAt ?? null,
            execution.finishedAt ?? null,
            execution.leaseOwner ?? null,
            execution.leaseExpiresAt ?? null,
            execution.attempt,
            JSON.stringify(execution.logEvents),
          ],
        );
        return execution;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/unique|duplicate/i.test(message) || !execution.idempotencyKey) throw err;
        const existing = await this.findByScope({
          ontologyId: execution.pin.ontologyId,
          principal: execution.principal,
          functionId: execution.pin.functionId,
          idempotencyKey: execution.idempotencyKey,
        });
        if (!existing) throw err;
        if (existing.requestHash !== execution.requestHash) {
          throw new FunctionIdempotencyConflictError();
        }
        return existing;
      }
    },
    async findById(executionId) {
      const found = await sql.query<Record<string, unknown>>(
        `SELECT ${COLUMNS} FROM function_executions WHERE id = $1`,
        [executionId],
      );
      const row = found.rows[0];
      return row ? rowToRecord(row) : undefined;
    },
    async findByScope(scope) {
      const found = await sql.query<Record<string, unknown>>(
        `SELECT ${COLUMNS} FROM function_executions
         WHERE ontology_id = $1 AND principal = $2 AND function_id = $3 AND idempotency_key = $4`,
        [scope.ontologyId, scope.principal, scope.functionId, scope.idempotencyKey],
      );
      const row = found.rows[0];
      return row ? rowToRecord(row) : undefined;
    },
    async claimNext(workerId, now, leaseMs) {
      const until = addMs(now, leaseMs);
      const found = await sql.query<Record<string, unknown>>(
        `UPDATE function_executions SET
           status = 'RUNNING',
           lease_owner = $1,
           lease_expires_at = $2,
           attempt = attempt + 1,
           started_at = COALESCE(started_at, $3),
           updated_at = $3
         WHERE id = (
           SELECT id FROM function_executions
           WHERE status = 'PENDING'
              OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $3::timestamptz)
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING ${COLUMNS}`,
        [workerId, until, now],
      );
      const row = found.rows[0];
      return row ? rowToRecord(row) : undefined;
    },
    async claim(executionId, workerId, now, leaseMs) {
      const until = addMs(now, leaseMs);
      const found = await sql.query<Record<string, unknown>>(
        `UPDATE function_executions SET
           status = 'RUNNING',
           lease_owner = $2,
           lease_expires_at = $3,
           attempt = attempt + 1,
           started_at = COALESCE(started_at, $4),
           updated_at = $4
         WHERE id = $1
           AND (
             status = 'PENDING'
             OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $4::timestamptz)
           )
         RETURNING ${COLUMNS}`,
        [executionId, workerId, until, now],
      );
      const row = found.rows[0];
      if (row) return rowToRecord(row);
      const current = await this.findById(executionId);
      if (!current) throw new FunctionLeaseHeldError(executionId);
      if (isFunctionTerminal(current.status)) throw new FunctionTerminalError();
      throw new FunctionLeaseHeldError(executionId);
    },
    async casStatus(input) {
      const from = Array.isArray(input.from) ? input.from : [input.from];
      const terminal = isFunctionTerminal(input.to);
      const found = await sql.query<Record<string, unknown>>(
        `UPDATE function_executions SET
           status = $2,
           result = $3::jsonb,
           error = $4::jsonb,
           log_events = COALESCE($5::jsonb, log_events),
           updated_at = $6,
           finished_at = CASE WHEN $7 THEN $6::timestamptz ELSE finished_at END,
           lease_owner = CASE WHEN $7 THEN NULL ELSE lease_owner END,
           lease_expires_at = CASE WHEN $7 THEN NULL ELSE lease_expires_at END
         WHERE id = $1 AND status = ANY($8::text[])
         RETURNING ${COLUMNS}`,
        [
          input.executionId,
          input.to,
          input.result == null ? null : JSON.stringify(input.result),
          input.error == null ? null : JSON.stringify(input.error),
          input.logEvents == null ? null : JSON.stringify(input.logEvents),
          input.now,
          terminal,
          from,
        ],
      );
      const row = found.rows[0];
      if (!row) throw new FunctionTerminalError();
      return rowToRecord(row);
    },
  };
}
