/**
 * ingestion-runtime — MappingDefinition → ProjectionEffect[].
 * Connectors never see this module.
 */

import type {
  MappingDefinition,
  ProjectionEffect,
  ProjectLinkCommand,
  ProjectObjectCommand,
  RawEnvelope,
} from 'contracts';

import { MappingTransformError } from './errors.js';

function applyTransform(
  raw: unknown,
  transform: 'identity' | 'string' | 'number' | 'boolean' | undefined,
): unknown {
  const t = transform ?? 'identity';
  if (t === 'identity') return raw;
  if (t === 'string') return raw == null ? '' : String(raw);
  if (t === 'number') {
    if (typeof raw === 'number') return raw;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (t === 'boolean') return Boolean(raw);
  throw new MappingTransformError(`unknown transform "${String(t)}"`);
}

function asFields(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MappingTransformError('payload must be an object');
  }
  return payload as Record<string, unknown>;
}

export function primaryKeyOf(fields: Record<string, unknown>, pkFields: readonly string[]): string {
  const parts: string[] = [];
  for (const field of pkFields) {
    const value = fields[field];
    if (value === undefined || value === null || value === '') {
      throw new MappingTransformError(`missing primary key field "${field}"`);
    }
    parts.push(String(value));
  }
  return parts.join('|');
}

/**
 * One envelope → one object (+ optional links) under the pinned definition.
 */
export function envelopeToEffects(input: {
  envelope: RawEnvelope;
  definition: MappingDefinition;
  ontologyId: string;
  principal: string;
}): ProjectionEffect[] {
  const fields = asFields(input.envelope.payload);
  const pk = primaryKeyOf(fields, input.definition.primaryKeyFields);
  const properties: Record<string, unknown> = {};
  for (const pm of input.definition.propertyMappings) {
    properties[pm.propertyTypeId] = applyTransform(fields[pm.sourceField], pm.transform);
  }
  const objectCmd: ProjectObjectCommand = {
    ontologyId: input.ontologyId,
    objectTypeId: input.definition.objectTypeId,
    primaryKey: pk,
    properties,
    source: input.envelope.source,
    sourceEventId: input.envelope.sourceEventId,
    observedAt: input.envelope.occurredAt,
    principal: input.principal,
    provenance: {
      connectorId: input.envelope.connectorId,
      mappingObjectTypeId: input.definition.objectTypeId,
      ...input.envelope.metadata,
    },
  };
  const effects: ProjectionEffect[] = [{ kind: 'project_object', cmd: objectCmd }];
  for (const lm of input.definition.linkMappings) {
    const targetPk = fields[lm.sourceField];
    if (targetPk === undefined || targetPk === null || targetPk === '') continue;
    const linkCmd: ProjectLinkCommand = {
      ontologyId: input.ontologyId,
      linkTypeId: lm.linkTypeId,
      sourceObjectTypeId: input.definition.objectTypeId,
      sourcePrimaryKey: pk,
      targetObjectTypeId: lm.targetObjectTypeId,
      targetPrimaryKey: String(targetPk),
      source: input.envelope.source,
      sourceEventId: input.envelope.sourceEventId,
      observedAt: input.envelope.occurredAt,
      principal: input.principal,
    };
    effects.push({ kind: 'project_link', cmd: linkCmd });
  }
  return effects;
}
