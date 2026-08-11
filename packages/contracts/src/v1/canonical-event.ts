/**
 * contracts — src/v1/canonical-event.ts
 * Envelope canônico congelado (Passo 6). Campos alinhados ao event-bus;
 * `checkpoint` é string (vazio quando ausente).
 */

import { createHash } from 'node:crypto';

/** Envelope canônico de todo dado que entra na plataforma. */
export interface CanonicalEvent {
  event_id: string;
  source_system: string;
  source_object: string;
  source_primary_key: string;
  /** Versão de schema como string (número stringificado de forma consistente). */
  schema_version: string;
  occurred_at: string;
  ingested_at: string;
  connector_id: string;
  /** Cursor opaco; string vazia quando ainda não há checkpoint. */
  checkpoint: string;
  principal: string;
  policy_tags: string[];
  /** sha256 hex do JSON canônico do payload. */
  payload_hash: string;
  payload: Record<string, unknown>;
}

/** Serializa valor com chaves ordenadas recursivamente (JSON canônico). */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/** sha256 hex do payload canonicamente serializado. */
export function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeJson(payload), 'utf8').digest('hex');
}

/** Valida presença dos campos obrigatórios do envelope (shape leve, sem zod). */
export function assertCanonicalEvent(value: unknown): asserts value is CanonicalEvent {
  if (value === null || typeof value !== 'object') {
    throw new Error('CanonicalEvent: esperado objeto');
  }
  const e = value as Record<string, unknown>;
  const required: Array<keyof CanonicalEvent> = [
    'event_id',
    'source_system',
    'source_object',
    'source_primary_key',
    'schema_version',
    'occurred_at',
    'ingested_at',
    'connector_id',
    'checkpoint',
    'principal',
    'policy_tags',
    'payload_hash',
    'payload',
  ];
  for (const key of required) {
    if (!(key in e)) throw new Error(`CanonicalEvent: campo ausente: ${key}`);
  }
  if (typeof e.event_id !== 'string') throw new Error('CanonicalEvent: event_id deve ser string');
  if (typeof e.source_system !== 'string') throw new Error('CanonicalEvent: source_system deve ser string');
  if (typeof e.source_object !== 'string') throw new Error('CanonicalEvent: source_object deve ser string');
  if (typeof e.source_primary_key !== 'string') {
    throw new Error('CanonicalEvent: source_primary_key deve ser string');
  }
  if (typeof e.schema_version !== 'string') throw new Error('CanonicalEvent: schema_version deve ser string');
  if (typeof e.occurred_at !== 'string') throw new Error('CanonicalEvent: occurred_at deve ser string');
  if (typeof e.ingested_at !== 'string') throw new Error('CanonicalEvent: ingested_at deve ser string');
  if (typeof e.connector_id !== 'string') throw new Error('CanonicalEvent: connector_id deve ser string');
  if (typeof e.checkpoint !== 'string') throw new Error('CanonicalEvent: checkpoint deve ser string');
  if (typeof e.principal !== 'string') throw new Error('CanonicalEvent: principal deve ser string');
  if (!Array.isArray(e.policy_tags) || !e.policy_tags.every((t) => typeof t === 'string')) {
    throw new Error('CanonicalEvent: policy_tags deve ser string[]');
  }
  if (typeof e.payload_hash !== 'string') throw new Error('CanonicalEvent: payload_hash deve ser string');
  if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) {
    throw new Error('CanonicalEvent: payload deve ser objeto');
  }
}

/** Serializa envelope para JSON estável (chaves de topo ordenadas + payload canônico). */
export function serializeCanonicalEvent(event: CanonicalEvent): string {
  return canonicalizeJson(event);
}

/** Parse + assert de um CanonicalEvent a partir de JSON. */
export function parseCanonicalEvent(json: string): CanonicalEvent {
  const parsed: unknown = JSON.parse(json);
  assertCanonicalEvent(parsed);
  return parsed;
}
