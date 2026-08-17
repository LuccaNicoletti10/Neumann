/**
 * contracts — src/v1/function-runtime.ts
 * Function registry (Passo 23). Camada cinética pura: f(objects) → result.
 *
 * Nunca altera estado. Versionada, testável, registrada.
 * Dynamic Ontology patents (Passo 17) — SEMÂNTICA × CINÉTICA.
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
