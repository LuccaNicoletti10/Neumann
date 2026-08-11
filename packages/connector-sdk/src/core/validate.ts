/**
 * connector-sdk — src/core/validate.ts
 * Validação leve do shape Connector (sem Ontology).
 */

import type { Capability, Connector } from 'contracts';

const KNOWN: ReadonlySet<Capability> = new Set([
  'snapshot',
  'cdc',
  'pushdown',
  'subscribe',
]);

export interface ConnectorValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateConnectorShape(connector: Connector): ConnectorValidationResult {
  const errors: string[] = [];
  if (!connector.connectorId || typeof connector.connectorId !== 'string') {
    errors.push('connectorId obrigatório');
  }
  if (!Array.isArray(connector.capabilities) || connector.capabilities.length === 0) {
    errors.push('capabilities[] não pode ser vazio');
  } else {
    for (const c of connector.capabilities) {
      if (!KNOWN.has(c)) errors.push(`capability desconhecida: ${String(c)}`);
    }
  }
  const methods = [
    'discover',
    'schema',
    'snapshot',
    'read',
    'checkpoint',
    'health',
  ] as const;
  for (const m of methods) {
    if (typeof connector[m] !== 'function') {
      errors.push(`método ausente: ${m}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertConnectorShape(connector: Connector): void {
  const result = validateConnectorShape(connector);
  if (!result.ok) {
    throw new Error(`Connector inválido: ${result.errors.join('; ')}`);
  }
}
