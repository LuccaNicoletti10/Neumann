/**
 * action-engine — src/core/action-request-identity.ts
 *
 * WHY: a single canonical module is the only authority for idempotency scope,
 * canonical request serialization, and request hash. Scattered JSON.stringify
 * calls diverge under key ordering changes; one module is the invariant.
 *
 * Scope minimum: ontologyId + principal + actionApiName + idempotencyKey.
 * ontologyId acts as the tenancy boundary until a dedicated tenantId field
 * is added to IdentityContext (documented debt: Prompt 09 candidate).
 *
 * Hash includes every field that is semantically relevant — a retry with a
 * different payload must produce a different hash so the claim layer can
 * detect it as IDEMPOTENCY_CONFLICT and write zero effects.
 */

import { hashCanonical, canonicalizeJson } from 'object-platform';

export const HASH_VERSION = 1;

export interface ActionRequestScope {
  ontologyId: string;
  principal: string;
  actionApiName: string;
  idempotencyKey: string;
}

export interface ActionCanonicalRequest {
  ontologyId: string;
  ontologyVersionId: string | undefined;
  actionTypeId: string;
  actionTypeHash: string;
  principal: string;
  parameters: Record<string, unknown>;
  expectedObjectVersions: Record<string, number> | undefined;
  operation: 'apply';
}

export interface ActionRequestIdentity {
  scope: ActionRequestScope;
  canonicalRequest: ActionCanonicalRequest;
  requestHash: string;
  hashVersion: number;
}

/**
 * Build the canonical identity for an apply request.
 * The hash covers every field that matters for correctness.
 * Callers must not hash a subset; use this module.
 */
export function buildActionRequestIdentity(
  scope: ActionRequestScope,
  req: Omit<ActionCanonicalRequest, 'operation'>,
): ActionRequestIdentity {
  const canonicalRequest: ActionCanonicalRequest = {
    ontologyId: req.ontologyId,
    ontologyVersionId: req.ontologyVersionId,
    actionTypeId: req.actionTypeId,
    actionTypeHash: req.actionTypeHash,
    principal: req.principal,
    parameters: req.parameters,
    expectedObjectVersions: req.expectedObjectVersions,
    operation: 'apply',
  };
  return {
    scope,
    canonicalRequest,
    requestHash: hashCanonical(canonicalRequest),
    hashVersion: HASH_VERSION,
  };
}

/** Serialize the canonical request for storage/comparison (ordered keys). */
export function serializeCanonicalRequest(req: ActionCanonicalRequest): string {
  return canonicalizeJson(req);
}
