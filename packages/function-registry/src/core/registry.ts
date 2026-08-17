/**
 * function-registry — src/core/registry.ts
 * Registro versionado de functions puras (Passo 23).
 */

import {
  assertFunctionDef,
  type FunctionDef,
  type FunctionImpl,
  type FunctionInvokeRequest,
  type FunctionInvokeResult,
  type FunctionRegistry,
  type FunctionVersion,
} from 'contracts';

import { aggregateMetrics, deriveFlags, scoreRecord } from './builtins.js';
import { invokePure } from './purity.js';

export interface CreateFunctionRegistryOptions {
  /** Default true — registra scoreRecord / aggregateMetrics / deriveFlags @ v1. */
  builtins?: boolean;
}

type Slot = { def: FunctionDef; impl: FunctionImpl };

function versionNewer(a: FunctionVersion, b: FunctionVersion): boolean {
  return a.localeCompare(b, undefined, { numeric: true }) > 0;
}

function keyOf(id: string, version: FunctionVersion): string {
  return `${id}@${version}`;
}

export function createFunctionRegistry(
  opts: CreateFunctionRegistryOptions = {},
): FunctionRegistry {
  const byKey = new Map<string, Slot>();
  const latest = new Map<string, FunctionVersion>();
  const alias = new Map<string, string>(); // apiName → id

  const registry: FunctionRegistry = {
    register(input, impl) {
      const def: FunctionDef = { ...input, pure: true };
      assertFunctionDef(def);
      const k = keyOf(def.id, def.version);
      if (byKey.has(k)) {
        throw new Error(`FunctionDef ${def.id}@${def.version} já registrado (versão imutável)`);
      }
      const existingId = alias.get(def.apiName);
      if (existingId && existingId !== def.id) {
        throw new Error(`apiName ${def.apiName} já pertence a ${existingId}`);
      }
      byKey.set(k, { def, impl });
      alias.set(def.apiName, def.id);
      alias.set(def.id, def.id);
      const prev = latest.get(def.id);
      if (!prev || versionNewer(def.version, prev)) {
        latest.set(def.id, def.version);
      }
      return { ...def, inputObjectTypeIds: [...def.inputObjectTypeIds] };
    },

    get(idOrApiName, version) {
      const id = alias.get(idOrApiName) ?? idOrApiName;
      const v = version ?? latest.get(id);
      if (!v) return undefined;
      const slot = byKey.get(keyOf(id, v));
      return slot ? { ...slot.def, inputObjectTypeIds: [...slot.def.inputObjectTypeIds] } : undefined;
    },

    list() {
      const rows: FunctionDef[] = [];
      for (const [id, version] of [...latest.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const slot = byKey.get(keyOf(id, version));
        if (slot) rows.push({ ...slot.def, inputObjectTypeIds: [...slot.def.inputObjectTypeIds] });
      }
      return rows;
    },

    listVersions(idOrApiName) {
      const id = alias.get(idOrApiName) ?? idOrApiName;
      const rows: FunctionDef[] = [];
      for (const slot of byKey.values()) {
        if (slot.def.id === id) {
          rows.push({ ...slot.def, inputObjectTypeIds: [...slot.def.inputObjectTypeIds] });
        }
      }
      rows.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
      return rows;
    },

    invoke(req: FunctionInvokeRequest): FunctionInvokeResult {
      const id = alias.get(req.functionId) ?? req.functionId;
      const version = req.version ?? latest.get(id);
      if (!version) throw new Error(`Function não registrada: ${req.functionId}`);
      const slot = byKey.get(keyOf(id, version));
      if (!slot) throw new Error(`Function versão não encontrada: ${id}@${version}`);
      if (slot.def.inputObjectTypeIds.length) {
        for (const o of req.objects) {
          if (!slot.def.inputObjectTypeIds.includes(o.objectTypeId)) {
            throw new Error(
              `Function ${slot.def.apiName}: objectType ${o.objectTypeId} não está em inputObjectTypeIds`,
            );
          }
        }
      }
      const result = invokePure(slot.impl, req.objects, req.params);
      return {
        functionId: slot.def.id,
        apiName: slot.def.apiName,
        version: slot.def.version,
        outputKind: slot.def.outputKind,
        result,
      };
    },
  };

  if (opts.builtins !== false) {
    registerBuiltins(registry);
  }
  return registry;
}

export function registerBuiltins(registry: FunctionRegistry): void {
  const types = ['ot.record', 'ot.customer', 'ot.entity'];
  registry.register(
    {
      id: 'fn.scoreRecord',
      apiName: 'scoreRecord',
      displayName: 'scoreRecord',
      description: 'Score de completude + magnitude numérica',
      version: '1',
      inputObjectTypeIds: types,
      outputKind: 'score',
    },
    scoreRecord,
  );
  registry.register(
    {
      id: 'fn.aggregateMetrics',
      apiName: 'aggregateMetrics',
      displayName: 'aggregateMetrics',
      description: 'count/sum/avg/min/max de uma property numérica',
      version: '1',
      inputObjectTypeIds: types,
      outputKind: 'metrics',
    },
    aggregateMetrics,
  );
  registry.register(
    {
      id: 'fn.deriveFlags',
      apiName: 'deriveFlags',
      displayName: 'deriveFlags',
      description: 'Flags empty / hasNumeric / aboveThreshold',
      version: '1',
      inputObjectTypeIds: types,
      outputKind: 'flags',
    },
    deriveFlags,
  );
}
