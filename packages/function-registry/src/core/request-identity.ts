import { hashCanonical } from 'object-platform';

import type { FunctionCreateRequest, FunctionExecutionPin, FunctionObjectRef } from 'contracts';

export function hashFunctionParameters(parameters: Record<string, unknown>): string {
  return hashCanonical(parameters);
}

export function hashFunctionSchema(schema: Record<string, unknown> | undefined): string {
  return hashCanonical(schema ?? {});
}

export function buildFunctionRequestHash(input: {
  pin: FunctionExecutionPin;
  principal: string;
  parameters: Record<string, unknown>;
  objectRefs: FunctionObjectRef[];
}): string {
  // WHY: readAsOf is an execution timestamp, not request identity; including it
  // would make an identical retry conflict after the clock advances.
  return hashCanonical({
    pin: input.pin,
    principal: input.principal,
    parameters: input.parameters,
    objectRefs: input.objectRefs,
  });
}

export function functionIdempotencyScope(req: FunctionCreateRequest): {
  ontologyId: string;
  principal: string;
  functionId: string;
  idempotencyKey: string;
} | undefined {
  if (!req.idempotencyKey) return undefined;
  return {
    ontologyId: req.ontologyId,
    principal: req.principal,
    functionId: req.functionId,
    idempotencyKey: req.idempotencyKey,
  };
}
