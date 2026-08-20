/**
 * object-platform — src/core/ontology-version-policy.ts
 *
 * One authority for "which OntologyVersion validates this operation".
 *
 * WHY a module instead of a helper per caller: governed repository, ActionExecutor
 * and ProjectionWriter each used to answer this question on their own, so
 * publishing a version silently changed the schema of live objects in one path
 * and not in another. The decision is taken once, at the start of an operation,
 * and carried for the whole transaction.
 *
 * Invariants:
 *   - create  → explicit pin, else latest resolved once at operation start.
 *   - mutate  → the version stamped on the existing record. Publishing a new
 *               version does not migrate it and does not change its schema.
 *   - migrate → the declared target; the declared source must match the record.
 */

import type {
  OntologyId,
  OntologyRegistry,
  OntologyVersion,
  OntologyVersionId,
} from 'contracts';

import { OntologyValidationError, OntologyVersionMismatchError } from './errors.js';

export type OntologyVersionPin =
  | {
      kind: 'create';
      ontologyId: OntologyId;
      /** Caller-supplied pin. Absent → latest at operation start. */
      requested?: OntologyVersionId;
    }
  | {
      kind: 'mutate';
      ontologyId: OntologyId;
      /** Version stamped on the record being mutated. */
      stamped?: OntologyVersionId;
      /** Version the caller is operating under (Action pin, batch pin). */
      requested?: OntologyVersionId;
    }
  | {
      kind: 'migrate';
      ontologyId: OntologyId;
      from: OntologyVersionId;
      to: OntologyVersionId;
      /** Version stamped on the record. Must equal `from`. */
      stamped?: OntologyVersionId;
    };

export interface PinnedOntologyVersion {
  /** The version that governs validation for this operation. */
  version: OntologyVersion;
  /**
   * Set when the caller operates under a different version than the one that
   * governs. Carried so a violation can name both versions instead of only
   * reporting an undeclared property.
   */
  divergentRequest?: OntologyVersionId;
}

/** Narrow port. One question, one answer. */
export interface OntologyVersionPolicy {
  pin(request: OntologyVersionPin): Promise<PinnedOntologyVersion>;
}

export interface CreateOntologyVersionPolicyOptions {
  registry: OntologyRegistry;
  /** Resolved-version cache TTL in ms. 0 = no cache. Default 0. */
  cacheTtlMs?: number;
  /** Injected for tests; production uses Date.now. */
  now?: () => number;
}

export function createOntologyVersionPolicy(
  opts: CreateOntologyVersionPolicyOptions,
): OntologyVersionPolicy {
  const { registry } = opts;
  const cacheTtlMs = opts.cacheTtlMs ?? 0;
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, { version: OntologyVersion | undefined; at: number }>();

  async function load(
    ontologyId: OntologyId,
    versionId: OntologyVersionId | undefined,
  ): Promise<OntologyVersion | undefined> {
    const key = `${ontologyId}::${versionId ?? 'latest'}`;
    if (cacheTtlMs > 0) {
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlMs) return hit.version;
    }
    const version = versionId
      ? await registry.getVersion(versionId)
      : await registry.getLatestVersion(ontologyId);
    if (cacheTtlMs > 0) cache.set(key, { version, at: now() });
    return version;
  }

  async function require(
    ontologyId: OntologyId,
    versionId: OntologyVersionId | undefined,
  ): Promise<OntologyVersion> {
    const version = await load(ontologyId, versionId);
    if (!version) {
      throw new OntologyValidationError([
        versionId
          ? `ontology version "${versionId}" does not exist`
          : `ontology "${ontologyId}" has no committed version; commit before writing objects`,
      ]);
    }
    if (version.ontologyId !== ontologyId) {
      throw new OntologyValidationError([
        `ontology version "${version.id}" belongs to ontology "${version.ontologyId}", not "${ontologyId}"`,
      ]);
    }
    return version;
  }

  return {
    async pin(request: OntologyVersionPin): Promise<PinnedOntologyVersion> {
      if (request.kind === 'create') {
        return { version: await require(request.ontologyId, request.requested) };
      }

      if (request.kind === 'mutate') {
        // WHY: an unstamped legacy row has no schema of record, so the decision
        // is taken once here — at the start of the operation — and the write
        // stamps it. This is not a mid-operation fallback to latest.
        const version = await require(request.ontologyId, request.stamped);
        const divergentRequest =
          request.requested && request.requested !== version.id
            ? request.requested
            : undefined;
        return divergentRequest ? { version, divergentRequest } : { version };
      }

      if (request.stamped !== undefined && request.stamped !== request.from) {
        throw new OntologyVersionMismatchError({
          objectVersionId: request.stamped,
          requestedVersionId: request.from,
          incompatibility: ['declared migration source does not match the object'],
        });
      }
      // WHY: both endpoints must exist before the write so a migration cannot
      // stamp a version that was never committed.
      await require(request.ontologyId, request.from);
      return { version: await require(request.ontologyId, request.to) };
    },
  };
}
