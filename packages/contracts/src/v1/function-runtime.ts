/**
 * contracts — src/v1/function-runtime.ts
 * Durable FunctionRuntime (ADR-0019) plus the legacy in-process FunctionRegistry
 * used only by the CLI demo. Production authority is FunctionRuntime.
 */

import type { FunctionTypeId, ObjectTypeId } from './ontology.js';

export type FunctionId = FunctionTypeId;
export type FunctionVersion = string;

export type FunctionOutputKind = 'score' | 'metrics' | 'flags' | 'json';

/** Snapshot de objeto passado à function — só leitura. */
export interface FunctionObjectInput {
  objectTypeId: ObjectTypeId;
  primaryKey?: string;
  properties: Record<string, unknown>;
}

export interface FunctionDef {
  id: FunctionId;
  /** Nome estável na API (ex.: scoreRecord). */
  apiName: string;
  displayName: string;
  description?: string;
  /** Versão imutável (ex.: "1", "2"). Re-register da mesma versão é rejeitado. */
  version: FunctionVersion;
  inputObjectTypeIds: ObjectTypeId[];
  outputKind: FunctionOutputKind;
  /** Sempre true — kernel recusa impl que muta inputs. */
  pure: true;
}

export type FunctionImpl = (
  objects: readonly FunctionObjectInput[],
  params?: Readonly<Record<string, unknown>>,
) => unknown;

export interface FunctionInvokeRequest {
  functionId: FunctionId | string;
  version?: FunctionVersion;
  objects: FunctionObjectInput[];
  params?: Record<string, unknown>;
}

export interface FunctionInvokeResult {
  functionId: FunctionId;
  apiName: string;
  version: FunctionVersion;
  outputKind: FunctionOutputKind;
  result: unknown;
}

export interface FunctionRegistry {
  register(def: Omit<FunctionDef, 'pure'> & { pure?: true }, impl: FunctionImpl): FunctionDef;
  get(idOrApiName: string, version?: FunctionVersion): FunctionDef | undefined;
  list(): FunctionDef[];
  listVersions(idOrApiName: string): FunctionDef[];
  invoke(req: FunctionInvokeRequest): FunctionInvokeResult;
}

export function buildGoldenFunctionDef(): FunctionDef {
  return {
    id: 'fn.scoreRecord',
    apiName: 'scoreRecord',
    displayName: 'scoreRecord',
    description: 'Score genérico de completude + magnitude numérica',
    version: '1',
    inputObjectTypeIds: ['ot.record'],
    outputKind: 'score',
    pure: true,
  };
}

export function assertFunctionDef(d: FunctionDef): void {
  if (!d.id) throw new Error('FunctionDef: id obrigatório');
  if (!d.apiName) throw new Error('FunctionDef: apiName obrigatório');
  if (!d.version) throw new Error('FunctionDef: version obrigatório');
  if (!d.inputObjectTypeIds?.length) {
    throw new Error('FunctionDef: inputObjectTypeIds obrigatório');
  }
  if (d.pure !== true) throw new Error('FunctionDef: pure deve ser true');
}

export const FUNCTION_SHA256 = /^[a-f0-9]{64}$/;

export interface FunctionExecutionPin {
  ontologyId: string;
  ontologyVersionId: string;
  functionId: string;
  functionVersion: number;
  artifactHash: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
}

export type FunctionExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DENIED'
  | 'CANCELLED';

export const FUNCTION_TERMINAL_STATUSES: readonly FunctionExecutionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'DENIED',
  'CANCELLED',
];

export type FunctionFailureCode =
  | 'TIMEOUT'
  | 'MEMORY_LIMIT'
  | 'FORBIDDEN_API'
  | 'EXECUTION_ERROR'
  | 'OUTPUT_LIMIT'
  | 'CANCELLED'
  | 'DENIED'
  | 'FUNCTION_IDEMPOTENCY_CONFLICT'
  | 'INVALID_PARAMETERS'
  | 'INVALID_OUTPUT'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'FUNCTION_SNAPSHOT_UNAVAILABLE';

export interface FunctionObjectRef {
  objectTypeId: string;
  primaryKey: string;
}

export interface FunctionActionInvocation {
  step: string;
  actionApiName: string;
  parameters: Record<string, unknown>;
  expectedObjectVersions?: Record<string, number>;
  executionId?: string;
}

export interface FunctionTypedError {
  code: FunctionFailureCode;
  message: string;
}

export interface FunctionExecution {
  executionId: string;
  pin: FunctionExecutionPin;
  principal: string;
  parameters: Record<string, unknown>;
  parametersHash: string;
  objectRefs: FunctionObjectRef[];
  objectSnapshot: FunctionObjectInput[];
  readAsOf: string;
  /**
   * History sequence watermark (ADR-0021). asOf uses seq <= readSeq.
   * readAsOf remains the sandbox clock pin (ADR-0020).
   */
  readSeq: number;
  policyGeneration: number;
  idempotencyKey?: string;
  requestHash?: string;
  status: FunctionExecutionStatus;
  result?: unknown;
  error?: FunctionTypedError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  attempt: number;
}

export interface FunctionCreateRequest {
  ontologyId: string;
  functionId: string;
  principal: string;
  parameters?: Record<string, unknown>;
  objectRefs?: FunctionObjectRef[];
  ontologyVersionId?: string;
  idempotencyKey?: string;
}

export interface FunctionArtifact {
  artifactHash: string;
  bytes: Uint8Array;
  createdAt: string;
  createdBy: string;
}

export interface FunctionArtifactStore {
  publish(bytes: Uint8Array, createdBy: string): Promise<FunctionArtifact>;
  get(artifactHash: string): Promise<FunctionArtifact>;
}

export interface FunctionDefinitionResolver {
  pin(input: {
    ontologyId: string;
    functionId: string;
    ontologyVersionId?: string;
  }): Promise<FunctionExecutionPin>;
}

export interface FunctionRuntime {
  create(req: FunctionCreateRequest): Promise<FunctionExecution>;
  get(executionId: string, principal: string): Promise<FunctionExecution | undefined>;
  cancel(executionId: string, principal: string): Promise<FunctionExecution>;
  runOnce(executionId: string, workerId: string, signal?: AbortSignal): Promise<FunctionExecution>;
}

export function assertFunctionExecutionPin(value: unknown): asserts value is FunctionExecutionPin {
  if (!value || typeof value !== 'object') throw new Error('FunctionExecutionPin required');
  const rec = value as Record<string, unknown>;
  for (const key of [
    'ontologyId',
    'ontologyVersionId',
    'functionId',
    'artifactHash',
    'inputSchemaHash',
    'outputSchemaHash',
  ]) {
    if (typeof rec[key] !== 'string' || String(rec[key]).length === 0) {
      throw new Error(`FunctionExecutionPin.${key} required`);
    }
  }
  if (!FUNCTION_SHA256.test(String(rec.artifactHash))) {
    throw new Error('FunctionExecutionPin.artifactHash must be SHA-256 hex');
  }
  if (typeof rec.functionVersion !== 'number' || rec.functionVersion < 1) {
    throw new Error('FunctionExecutionPin.functionVersion required');
  }
}

export function isFunctionTerminal(status: FunctionExecutionStatus): boolean {
  return (FUNCTION_TERMINAL_STATUSES as readonly string[]).includes(status);
}
