/**
 * ingestion-runtime — ConnectorRegistrationRepository (memory).
 * Config is rejected if it contains a secret-bearing key.
 */

import type { ConnectorRegistration, ConnectorRegistrationRepository } from 'contracts';

import { IngestionVersionConflictError, MappingTransformError } from './errors.js';
import { SENSITIVE_CONFIG_KEYS } from './log-redaction.js';

export function assertConfigHasNoSecret(config: Record<string, unknown>, path = 'config'): void {
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_CONFIG_KEYS.test(key)) {
      throw new MappingTransformError(`${path} must not contain ${key}`);
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assertConfigHasNoSecret(value as Record<string, unknown>, `${path}.${key}`);
    }
  }
}

function cloneReg(reg: ConnectorRegistration): ConnectorRegistration {
  return { ...reg, config: { ...reg.config } };
}

export function createMemoryConnectorRegistrationRepository(): ConnectorRegistrationRepository {
  const rows = new Map<string, ConnectorRegistration>();
  return {
    async get(connectorId) {
      const row = rows.get(connectorId);
      return row ? cloneReg(row) : undefined;
    },
    async list() {
      return [...rows.values()].map(cloneReg);
    },
    async put(registration, expectedVersion) {
      assertConfigHasNoSecret(registration.config);
      const current = rows.get(registration.connectorId);
      if (!current) {
        if (expectedVersion !== undefined && expectedVersion !== 0) {
          throw new IngestionVersionConflictError(
            `connector ${registration.connectorId} does not exist`,
          );
        }
        const created: ConnectorRegistration = {
          ...cloneReg(registration),
          version: 1,
        };
        rows.set(created.connectorId, created);
        return cloneReg(created);
      }
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw new IngestionVersionConflictError(
          `connector ${registration.connectorId} version conflict`,
        );
      }
      const next: ConnectorRegistration = {
        ...cloneReg(registration),
        createdAt: current.createdAt,
        version: current.version + 1,
      };
      rows.set(next.connectorId, next);
      return cloneReg(next);
    },
  };
}
