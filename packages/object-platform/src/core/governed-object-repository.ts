/**
 * object-platform — src/core/governed-object-repository.ts
 *
 * PEÇA 1 (ontologia executável) + PEÇA 3 (imutabilidade de objetos).
 *
 * Decorator sobre qualquer ObjectRepository que:
 *   1. VALIDA toda escrita contra a OntologyVersion comitada
 *      (tipo existe, propriedades declaradas, baseType confere, validators passam).
 *      A ontologia deixa de ser descritiva e vira LEI.
 *   2. GRAVA snapshot em platform_object_history a cada mutação
 *      (estado PÓS-mutação: create v1, update v2, delete deleted=true),
 *      no MESMO SqlClient — portanto na mesma transação via bind(tx).
 *      asOf(t) devolve o mundo vigente em t, não o contexto pré-decisão.
 *
 * Uso (context.ts):
 *   const raw = createPgObjectRepository({ sql: client, clock, nextId });
 *   const objects = createGovernedObjectRepository({
 *     inner: raw,
 *     resolveVersion: (oid, vid) =>
 *       vid ? ontology.getVersion(vid) : ontology.getLatestVersion(oid),
 *     history: createPgObjectHistoryStore({ sql: client, nextId }),
 *     principal: () => currentPrincipal,   // opcional
 *     mode: 'enforce',                     // 'warn' para migração
 *   });
 */

import type {
  CreateObjectInput,
  DeleteObjectInput,
  ObjectRecord,
  ObjectRepository,
  OntologyId,
  OntologyVersion,
  OntologyVersionId,
  PropertyTypeDef,
  UpdateObjectInput,
} from 'contracts';

import type { ObjectHistoryStore } from './object-history-store.js';

export type GovernanceMode = 'enforce' | 'warn';

export interface GovernedRepositoryOptions {
  inner: ObjectRepository;
  /** Resolve a versão da ontologia contra a qual validar. */
  resolveVersion: (
    ontologyId: OntologyId,
    ontologyVersionId?: OntologyVersionId,
  ) => Promise<OntologyVersion | undefined>;
  /** Snapshot de histórico. Se omitido, só valida (não recomendado). */
  history?: ObjectHistoryStore;
  /** Principal atual para o snapshot (quem causou a mutação). */
  principal?: () => string | undefined;
  /** enforce = rejeita escrita inválida; warn = loga e deixa passar. */
  mode?: GovernanceMode;
  /** Permitir escrita quando a ontologia não tem versão comitada. Default: false. */
  allowUncommittedOntology?: boolean;
  /** Cache TTL da versão resolvida, em ms. Default 5000. 0 = sem cache. */
  versionCacheTtlMs?: number;
  warn?: (message: string) => void;
}

export class OntologyValidationError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`ontology validation failed: ${violations.join('; ')}`);
    this.name = 'OntologyValidationError';
    this.violations = violations;
  }
}

/* ------------------------------------------------------------------ */
/* validação                                                           */
/* ------------------------------------------------------------------ */

function isIsoDatetime(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function checkBaseType(def: PropertyTypeDef, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (def.baseType) {
    case 'string':
      return typeof value === 'string' ? null : `expected string`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `expected number`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `expected boolean`;
    case 'datetime':
      return isIsoDatetime(value) ? null : `expected ISO datetime string`;
    case 'object_ref':
      return typeof value === 'string' ? null : `expected object primary key (string)`;
    case 'struct':
      return typeof value === 'object' ? null : `expected struct object`;
    default:
      return null;
  }
}

function runValidators(def: PropertyTypeDef, value: unknown): string[] {
  const errors: string[] = [];
  for (const v of def.validators ?? []) {
    if (v.kind === 'required') {
      if (value === null || value === undefined || value === '') {
        errors.push(`required`);
      }
    } else if (v.kind === 'regex') {
      if (value !== null && value !== undefined) {
        if (typeof value !== 'string' || !new RegExp(v.pattern).test(value)) {
          errors.push(`does not match /${v.pattern}/`);
        }
      }
    } else if (v.kind === 'set') {
      if (value !== null && value !== undefined && !v.values.includes(String(value))) {
        errors.push(`not in [${v.values.join(', ')}]`);
      }
    }
  }
  return errors;
}

/**
 * Valida um conjunto de propriedades contra a versão da ontologia.
 * `full = true` (create / update replace): checa required de TODAS as
 * propriedades do tipo. `full = false` (update merge): só as presentes.
 */
export function validateProperties(
  version: OntologyVersion,
  objectTypeId: string,
  properties: Record<string, unknown>,
  full: boolean,
): string[] {
  const violations: string[] = [];
  const objectType = version.objectTypes[objectTypeId];
  if (!objectType) {
    return [`object type "${objectTypeId}" is not declared in ontology version ${version.id}`];
  }
  const declared = new Set(objectType.propertyTypeIds);

  for (const [key, value] of Object.entries(properties)) {
    if (!declared.has(key)) {
      violations.push(`property "${key}" is not declared on "${objectTypeId}"`);
      continue;
    }
    const def = version.propertyTypes[key];
    if (!def) {
      violations.push(`property type "${key}" missing from ontology version (registry inconsistency)`);
      continue;
    }
    const typeError = checkBaseType(def, value);
    if (typeError) violations.push(`property "${key}": ${typeError}`);
    for (const e of runValidators(def, value)) {
      violations.push(`property "${key}": ${e}`);
    }
  }

  if (full) {
    for (const pid of objectType.propertyTypeIds) {
      const def = version.propertyTypes[pid];
      const isRequired = def?.validators?.some((v) => v.kind === 'required');
      if (isRequired && (properties[pid] === undefined || properties[pid] === null || properties[pid] === '')) {
        violations.push(`property "${pid}": required`);
      }
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* decorator                                                           */
/* ------------------------------------------------------------------ */

export function createGovernedObjectRepository(
  opts: GovernedRepositoryOptions,
): ObjectRepository {
  const {
    inner,
    resolveVersion,
    history,
    principal,
    mode = 'enforce',
    allowUncommittedOntology = false,
    versionCacheTtlMs = 5000,
  } = opts;
  const warn = opts.warn ?? ((m: string) => console.warn(`[ontology-guard] ${m}`));

  const cache = new Map<string, { version: OntologyVersion | undefined; at: number }>();

  async function versionFor(
    ontologyId: OntologyId,
    ontologyVersionId?: OntologyVersionId,
  ): Promise<OntologyVersion | undefined> {
    const key = `${ontologyId}::${ontologyVersionId ?? 'latest'}`;
    if (versionCacheTtlMs > 0) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < versionCacheTtlMs) return hit.version;
    }
    const version = await resolveVersion(ontologyId, ontologyVersionId);
    cache.set(key, { version, at: Date.now() });
    return version;
  }

  function handle(violations: string[]): void {
    if (violations.length === 0) return;
    if (mode === 'enforce') throw new OntologyValidationError(violations);
    for (const v of violations) warn(v);
  }

  async function guard(
    ontologyId: OntologyId,
    ontologyVersionId: OntologyVersionId | undefined,
    objectTypeId: string,
    properties: Record<string, unknown>,
    full: boolean,
  ): Promise<OntologyVersionId | undefined> {
    const version = await versionFor(ontologyId, ontologyVersionId);
    if (!version) {
      if (allowUncommittedOntology) {
        warn(`ontology "${ontologyId}" has no committed version — write allowed by config`);
        return undefined;
      }
      handle([`ontology "${ontologyId}" has no committed version; commit before writing objects`]);
      return undefined;
    }
    handle(validateProperties(version, objectTypeId, properties, full));
    return version.id;
  }

  async function snapshot(
    record: ObjectRecord,
    operation: 'create' | 'update' | 'delete',
  ): Promise<void> {
    if (!history) return;
    await history.append({
      objectId: record.id,
      ontologyId: record.ontologyId,
      ontologyVersionId: record.ontologyVersionId,
      objectTypeId: record.objectTypeId,
      primaryKey: record.primaryKey,
      version: record.version,
      properties: record.properties,
      deleted: record.deleted,
      source: record.source,
      principal: principal?.(),
      operation,
      provenance: record.provenance,
    });
  }

  return {
    async create(input: CreateObjectInput) {
      const versionId = await guard(
        input.ontologyId,
        input.ontologyVersionId,
        input.objectTypeId,
        input.properties ?? {},
        true,
      );
      const record = await inner.create({
        ...input,
        ontologyVersionId: input.ontologyVersionId ?? versionId,
      });
      await snapshot(record, 'create');
      return record;
    },

    get: (o, t, pk) => inner.get(o, t, pk),
    getById: (id) => inner.getById(id),
    list: (o, t, opts2) => inner.list(o, t, opts2),

    async update(ontologyId, objectTypeId, primaryKey, input: UpdateObjectInput) {
      const pre = await inner.get(ontologyId, objectTypeId, primaryKey);
      // merge: valida o estado RESULTANTE (pre + patch); replace: valida o novo estado.
      const toValidate =
        input.mode === 'replace'
          ? input.properties
          : { ...(pre?.properties ?? {}), ...input.properties };
      await guard(ontologyId, pre?.ontologyVersionId, objectTypeId, toValidate, true);
      const post = await inner.update(ontologyId, objectTypeId, primaryKey, input);
      await snapshot(post, 'update');
      return post;
    },

    async delete(ontologyId, objectTypeId, primaryKey, input?: DeleteObjectInput) {
      const pre = await inner.get(ontologyId, objectTypeId, primaryKey);
      const ok = await inner.delete(ontologyId, objectTypeId, primaryKey, input);
      if (ok && pre) {
        await snapshot(
          {
            ...pre,
            deleted: true,
            version: pre.version + 1,
          },
          'delete',
        );
      }
      return ok;
    },
  };
}
