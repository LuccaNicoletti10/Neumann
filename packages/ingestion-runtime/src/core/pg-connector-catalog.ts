/**
 * ingestion-runtime — PostgreSQL ConnectorRegistrationRepository (0023).
 */

import type { ConnectorKind, ConnectorRegistration, ConnectorRegistrationRepository, SqlClient } from 'contracts';

import { assertConfigHasNoSecret } from './connector-catalog.js';
import { IngestionVersionConflictError } from './errors.js';

function rowToReg(row: Record<string, unknown>): ConnectorRegistration {
  const secretRef = row.secret_ref == null ? undefined : String(row.secret_ref);
  const reg: ConnectorRegistration = {
    connectorId: String(row.connector_id),
    kind: row.kind as ConnectorKind,
    enabled: Boolean(row.enabled),
    config: (row.config ?? {}) as Record<string, unknown>,
    servicePrincipal: String(row.service_principal),
    mappingId: String(row.mapping_id),
    ontologyId: String(row.ontology_id),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
  if (secretRef) reg.secretRef = secretRef;
  return reg;
}

export function createPgConnectorRegistrationRepository(opts: {
  sql: SqlClient;
}): ConnectorRegistrationRepository {
  const { sql } = opts;
  return {
    async get(connectorId) {
      const found = await sql.query(
        `SELECT * FROM connector_registrations WHERE connector_id = $1`,
        [connectorId],
      );
      const row = found.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToReg(row) : undefined;
    },
    async list() {
      const found = await sql.query(
        `SELECT * FROM connector_registrations ORDER BY connector_id`,
      );
      return found.rows.map((row) => rowToReg(row as Record<string, unknown>));
    },
    async put(registration, expectedVersion) {
      assertConfigHasNoSecret(registration.config);
      const current = await sql.query(
        `SELECT * FROM connector_registrations WHERE connector_id = $1`,
        [registration.connectorId],
      );
      const existing = current.rows[0] as Record<string, unknown> | undefined;
      if (!existing) {
        if (expectedVersion !== undefined && expectedVersion !== 0) {
          throw new IngestionVersionConflictError(
            `connector ${registration.connectorId} does not exist`,
          );
        }
        await sql.query(
          `INSERT INTO connector_registrations (
             connector_id, kind, enabled, config, secret_ref, service_principal,
             mapping_id, ontology_id, version, created_at, updated_at
           ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,1,$9,$10)`,
          [
            registration.connectorId,
            registration.kind,
            registration.enabled,
            JSON.stringify(registration.config),
            registration.secretRef ?? null,
            registration.servicePrincipal,
            registration.mappingId,
            registration.ontologyId,
            registration.createdAt,
            registration.updatedAt,
          ],
        );
        const stored = await sql.query(
          `SELECT * FROM connector_registrations WHERE connector_id = $1`,
          [registration.connectorId],
        );
        return rowToReg(stored.rows[0] as Record<string, unknown>);
      }
      const version = Number(existing.version);
      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new IngestionVersionConflictError(
          `connector ${registration.connectorId} version conflict`,
        );
      }
      const updated = await sql.query(
        `UPDATE connector_registrations SET
           kind = $2, enabled = $3, config = $4::jsonb, secret_ref = $5,
           service_principal = $6, mapping_id = $7, ontology_id = $8,
           version = version + 1, updated_at = $9
         WHERE connector_id = $1 AND version = $10
         RETURNING *`,
        [
          registration.connectorId,
          registration.kind,
          registration.enabled,
          JSON.stringify(registration.config),
          registration.secretRef ?? null,
          registration.servicePrincipal,
          registration.mappingId,
          registration.ontologyId,
          registration.updatedAt,
          version,
        ],
      );
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new IngestionVersionConflictError(
          `connector ${registration.connectorId} version conflict`,
        );
      }
      return rowToReg(row);
    },
  };
}
