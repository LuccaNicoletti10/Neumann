/**
 * ingestion-runtime — reconstruct pull sources from a durable registration.
 * Connectors stay generic; config never includes a secret.
 */

import { createCsvConnector } from 'connector-csv';
import { createHttpConnector } from 'connector-http';
import type { ConnectorRegistration } from 'contracts';

import { MappingTransformError } from './errors.js';
import { sourceFromConnectorV2, type EnvelopeSource } from './envelope-source.js';

function stringField(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MappingTransformError(`connector config.${key} is required`);
  }
  return value;
}

export function sourceFromRegistration(reg: ConnectorRegistration): EnvelopeSource {
  if (reg.kind === 'csv') {
    const path = stringField(reg.config, 'path');
    return sourceFromConnectorV2(
      createCsvConnector({ path, connectorId: reg.connectorId }),
      reg.connectorId,
    );
  }
  if (reg.kind === 'http') {
    const url = stringField(reg.config, 'url');
    return sourceFromConnectorV2(
      createHttpConnector({ url, connectorId: reg.connectorId }),
      reg.connectorId,
    );
  }
  throw new MappingTransformError(`connector kind "${reg.kind}" is not pullable`);
}
