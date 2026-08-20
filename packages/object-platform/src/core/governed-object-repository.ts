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

import {
  compilePattern,
  type CreateObjectInput,
  type DeleteObjectInput,
  type ObjectRecord,
  type ObjectRepository,
  type OntologyVersion,
  type OntologyVersionId,
  type PropertyTypeDef,
  type UpdateObjectInput,
} from 'contracts';

import { OntologyValidationError, OntologyVersionMismatchError } from './errors.js';
import type { ObjectHistoryStore } from './object-history-store.js';
import type {
  OntologyVersionPolicy,
  PinnedOntologyVersion,
} from './ontology-version-policy.js';


export type GovernanceMode = 'enforce' | 'warn';

export interface GovernedRepositoryOptions {
  inner: ObjectRepository;
  /**
   * Single authority for which OntologyVersion validates each operation.
   * WHY not a resolveVersion callback: every caller answered it differently.
   */
  versionPolicy: OntologyVersionPolicy;
  /** Snapshot de histórico. Se omitido, só valida (não recomendado). */
  history?: ObjectHistoryStore;
  /** Principal atual para o snapshot (quem causou a mutação). */
  principal?: () => string | undefined;
  /** enforce = rejeita escrita inválida; warn = loga e deixa passar. */
  mode?: GovernanceMode;
  warn?: (message: string) => void;
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
        if (typeof value !== 'string') {
          errors.push(`does not match /${v.pattern}/`);
        } else {
          try {
            const re = compilePattern(def.id, v.pattern);
            if (!re.test(value)) errors.push(`does not match /${v.pattern}/`);
          } catch {
            errors.push(`does not match /${v.pattern}/`);
          }
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
    // WHY: null is a value. required (nullable=false) rejects it; absence of
    // required (nullable=true) permits it and skips baseType.
    if (value === null) {
      const isRequired = def.validators?.some((v) => v.kind === 'required') === true;
      if (isRequired) {
        violations.push(`property "${key}": not nullable`);
      }
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
  const { inner, versionPolicy, history, principal, mode = 'enforce' } = opts;
  const warn = opts.warn ?? ((m: string) => console.warn(`[ontology-guard] ${m}`));

  function handle(pinned: PinnedOntologyVersion, violations: string[]): void {
    if (violations.length === 0) return;
    if (mode === 'warn') {
      for (const v of violations) warn(v);
      return;
    }
    if (pinned.divergentRequest) {
      throw new OntologyVersionMismatchError({
        objectVersionId: pinned.version.id,
        requestedVersionId: pinned.divergentRequest,
        incompatibility: violations,
      });
    }
    throw new OntologyValidationError(violations);
  }

  async function snapshot(
    record: ObjectRecord,
    operation: 'create' | 'update' | 'delete',
    migration?: { from?: OntologyVersionId; to?: OntologyVersionId },
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
      fromOntologyVersionId: migration?.from,
      toOntologyVersionId: migration?.to,
    });
  }

  return {
    async create(input: CreateObjectInput) {
      const pinned = await versionPolicy.pin({
        kind: 'create',
        ontologyId: input.ontologyId,
        requested: input.ontologyVersionId,
      });
      handle(
        pinned,
        validateProperties(pinned.version, input.objectTypeId, input.properties ?? {}, true),
      );
      const record = await inner.create({ ...input, ontologyVersionId: pinned.version.id });
      await snapshot(record, 'create');
      return record;
    },

    get: (o, t, pk) => inner.get(o, t, pk),
    getById: (id) => inner.getById(id),
    list: (o, t, opts2) => inner.list(o, t, opts2),
    listAll: (o, opts2) => inner.listAll(o, opts2),

    async update(ontologyId, objectTypeId, primaryKey, input: UpdateObjectInput) {
      const pre = await inner.get(ontologyId, objectTypeId, primaryKey);
      const migrating = input.migrateToOntologyVersionId !== undefined;
      const pinned = migrating
        ? await versionPolicy.pin({
            kind: 'migrate',
            ontologyId,
            from: input.ontologyVersionId ?? pre?.ontologyVersionId ?? '',
            to: input.migrateToOntologyVersionId!,
            stamped: pre?.ontologyVersionId,
          })
        : await versionPolicy.pin({
            kind: 'mutate',
            ontologyId,
            stamped: pre?.ontologyVersionId,
            requested: input.ontologyVersionId,
          });
      // merge: valida o estado RESULTANTE (pre + patch); replace: valida o novo estado.
      const toValidate =
        input.mode === 'replace'
          ? input.properties
          : { ...(pre?.properties ?? {}), ...input.properties };
      handle(pinned, validateProperties(pinned.version, objectTypeId, toValidate, true));
      const post = await inner.update(ontologyId, objectTypeId, primaryKey, {
        ...input,
        migrateToOntologyVersionId: migrating ? pinned.version.id : undefined,
      });
      await snapshot(
        post,
        'update',
        migrating
          ? { from: pre?.ontologyVersionId, to: pinned.version.id }
          : undefined,
      );
      return post;
    },

    async delete(ontologyId, objectTypeId, primaryKey, input?: DeleteObjectInput) {
      const post = await inner.delete(ontologyId, objectTypeId, primaryKey, input);
      if (post) await snapshot(post, 'delete');
      return post;
    },
  };
}
