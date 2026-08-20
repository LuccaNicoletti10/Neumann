/**
 * object-platform — src/core/projection-request-identity.ts
 *
 * WHY: one canonical module computes the fingerprint for a batch of projection
 * effects. Every semantically relevant field must appear explicitly in the
 * fingerprint — hiding cardinality or endpoints inside an opaque `cmd` object
 * would let a divergent retry silently succeed.
 *
 * hashVersion increments if the algorithm changes. Existing ledger rows with
 * a different hashVersion are treated as a conflict (fail-closed).
 */

import type {
  ProjectionEffect,
} from 'contracts';
import { hashCanonical } from './hash.js';

export const PROJECTION_HASH_VERSION = 1;

/**
 * Normalised, explicitly-typed representation of one effect's identity fields.
 * All fields that influence idempotency semantics are present at the top level.
 * WHY: if cardinality or endpoint types were buried inside a `cmd` blob they
 * would be visible to `JSON.stringify` but invisible to schema reviews and
 * golden tests.
 */
export type ProjectionEffectFingerprint =
  | {
      kind: 'project_object';
      ontologyId: string;
      objectTypeId: string;
      primaryKey: string;
      properties: Record<string, unknown>;
      expectedVersion: number | undefined;
      expectedAbsent: boolean;
      provenance: Record<string, unknown> | undefined;
      observedAt: string | undefined;
      source: string;
      sourceEventId: string;
      principal: string;
    }
  | {
      kind: 'delete_object';
      ontologyId: string;
      objectTypeId: string;
      primaryKey: string;
      expectedVersion: number | undefined;
      source: string;
      sourceEventId: string;
      principal: string;
    }
  | {
      kind: 'project_link';
      ontologyId: string;
      linkTypeId: string;
      sourceObjectTypeId: string;
      sourcePrimaryKey: string;
      targetObjectTypeId: string;
      targetPrimaryKey: string;
      cardinality: string | undefined;
      provenance: Record<string, unknown> | undefined;
      observedAt: string | undefined;
      source: string;
      sourceEventId: string;
      principal: string;
    }
  | {
      kind: 'delete_link';
      ontologyId: string;
      linkTypeId: string;
      sourceObjectTypeId: string;
      sourcePrimaryKey: string;
      targetObjectTypeId: string;
      targetPrimaryKey: string;
      expectedVersion: number | undefined;
      source: string;
      sourceEventId: string;
      principal: string;
    };

export interface ProjectionRequestIdentityInput {
  source: string;
  ontologyId: string;
  ontologyVersionId?: string;
  sourceEventId: string;
  principal: string;
  observedAt: string | undefined;
  provenance: Record<string, unknown> | undefined;
  effects: ProjectionEffectFingerprint[];
  hashVersion: number;
}

export interface ProjectionRequestIdentity {
  fingerprint: ProjectionRequestIdentityInput;
  batchHash: string;
  hashVersion: number;
}

/**
 * Flatten a ProjectionEffect into its canonical fingerprint.
 * All semantically relevant fields appear at the top level with explicit names.
 */
export function normaliseEffect(
  effect: ProjectionEffect,
  batchPrincipal: string,
): ProjectionEffectFingerprint {
  switch (effect.kind) {
    case 'project_object':
      return {
        kind: 'project_object',
        ontologyId: effect.cmd.ontologyId,
        objectTypeId: effect.cmd.objectTypeId,
        primaryKey: effect.cmd.primaryKey,
        properties: effect.cmd.properties,
        expectedVersion: effect.cmd.expectedVersion,
        expectedAbsent: effect.cmd.expectedVersion === undefined,
        provenance: effect.cmd.provenance,
        observedAt: effect.cmd.observedAt,
        source: effect.cmd.source,
        sourceEventId: effect.cmd.sourceEventId,
        principal: effect.cmd.principal ?? batchPrincipal,
      };
    case 'delete_object':
      return {
        kind: 'delete_object',
        ontologyId: effect.cmd.ontologyId,
        objectTypeId: effect.cmd.objectTypeId,
        primaryKey: effect.cmd.primaryKey,
        expectedVersion: effect.cmd.expectedVersion,
        source: effect.cmd.source,
        sourceEventId: effect.cmd.sourceEventId,
        principal: effect.cmd.principal ?? batchPrincipal,
      };
    case 'project_link':
      return {
        kind: 'project_link',
        ontologyId: effect.cmd.ontologyId,
        linkTypeId: effect.cmd.linkTypeId,
        sourceObjectTypeId: effect.cmd.sourceObjectTypeId,
        sourcePrimaryKey: effect.cmd.sourcePrimaryKey,
        targetObjectTypeId: effect.cmd.targetObjectTypeId,
        targetPrimaryKey: effect.cmd.targetPrimaryKey,
        cardinality: effect.cmd.cardinality,
        provenance: effect.cmd.provenance,
        observedAt: effect.cmd.observedAt,
        source: effect.cmd.source,
        sourceEventId: effect.cmd.sourceEventId,
        principal: effect.cmd.principal ?? batchPrincipal,
      };
    case 'delete_link':
      return {
        kind: 'delete_link',
        ontologyId: effect.cmd.ontologyId,
        linkTypeId: effect.cmd.linkTypeId,
        sourceObjectTypeId: effect.cmd.sourceObjectTypeId,
        sourcePrimaryKey: effect.cmd.sourcePrimaryKey,
        targetObjectTypeId: effect.cmd.targetObjectTypeId,
        targetPrimaryKey: effect.cmd.targetPrimaryKey,
        expectedVersion: effect.cmd.expectedVersion,
        source: effect.cmd.source,
        sourceEventId: effect.cmd.sourceEventId,
        principal: effect.cmd.principal ?? batchPrincipal,
      };
  }
}

/**
 * Build the canonical identity for a batch command.
 * The hash covers the full ordered normalised effect list; the caller must
 * supply stable observedAt/provenance — values generated internally would
 * make an identical retry diverge.
 */
export function buildProjectionRequestIdentity(
  input: Omit<ProjectionRequestIdentityInput, 'hashVersion'>,
): ProjectionRequestIdentity {
  const withVersion: ProjectionRequestIdentityInput = {
    ...input,
    hashVersion: PROJECTION_HASH_VERSION,
  };
  return {
    fingerprint: withVersion,
    batchHash: hashCanonical(withVersion),
    hashVersion: PROJECTION_HASH_VERSION,
  };
}
