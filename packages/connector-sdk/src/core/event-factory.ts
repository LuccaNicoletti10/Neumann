/**
 * connector-sdk — src/core/event-factory.ts
 * Monta CanonicalEvent com payload_hash estável.
 */

import { hashPayload, type CanonicalEvent } from 'contracts';

import type { Clock, IdGenerator } from './types.js';

export interface EventFactoryInput {
  source_system: string;
  source_object: string;
  source_primary_key: string;
  schema_version: string;
  connector_id: string;
  checkpoint: string;
  principal: string;
  policy_tags?: string[];
  payload: Record<string, unknown>;
  /** Se omitido, usa clock() para occurred_at e ingested_at. */
  occurred_at?: string;
  event_id?: string;
}

export interface EventFactory {
  create(input: EventFactoryInput): CanonicalEvent;
}

export interface EventFactoryOptions {
  clock: Clock;
  nextId: IdGenerator;
  defaultPrincipal?: string;
}

export function createEventFactory(opts: EventFactoryOptions): EventFactory {
  const defaultPrincipal = opts.defaultPrincipal ?? 'sa:ingest';
  return {
    create(input) {
      const occurred_at = input.occurred_at ?? opts.clock();
      const ingested_at = opts.clock();
      return {
        event_id: input.event_id ?? opts.nextId('evt'),
        source_system: input.source_system,
        source_object: input.source_object,
        source_primary_key: input.source_primary_key,
        schema_version: input.schema_version,
        occurred_at,
        ingested_at,
        connector_id: input.connector_id,
        checkpoint: input.checkpoint,
        principal: input.principal || defaultPrincipal,
        policy_tags: input.policy_tags ?? [],
        payload_hash: hashPayload(input.payload),
        payload: input.payload,
      };
    },
  };
}
