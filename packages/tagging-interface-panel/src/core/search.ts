/**
 * tagging-interface-panel — src/core/search.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: SEARCH FOR
 * OBJECT FIELD (416) — busca no internal database system objetos já existentes
 * associados à tag (ex.: "Curiosity"), sincroniza o objeto tagueado com o
 * objeto existente (SYNC, exigindo login) e cria object types/property types
 * para entidades já existentes. Nenhum texto dos claims é reproduzido; apenas
 * a funcionalidade é reimplementada de forma original.
 */

import type { OntologyBuilder } from './ontology.js';
import type { SearchResult, TaggedObject } from './types.js';

/** Erro emitido quando uma operação exige login no internal database system. */
export class LoginRequiredError extends Error {
  constructor(action: string) {
    super(`LOGIN_REQUIRED: ${action} exige login no internal database system`);
    this.name = 'LoginRequiredError';
  }
}

/**
 * Fachada do internal database system (injetável): busca e recupera objetos
 * já existentes.
 */
export interface InternalDatabase {
  search(query: string): SearchResult[];
  getObject(objectId: string): SearchResult | undefined;
}

/**
 * Search for object field (416): busca objetos já existentes no internal
 * database system cujo tipo ou propriedades mencionem a consulta (ex.: um
 * object tag "Curiosity" exibe os resultados associados). Busca
 * determinística, em ordem de inserção.
 */
export function searchForObject(db: InternalDatabase, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return db.search(needle);
}

/**
 * SYNC do objeto tagueado com o objeto existente no internal database.
 * EXIGE login: sem `loggedIn`, lança LoginRequiredError.
 */
export function syncTaggedObject(
  db: InternalDatabase,
  tagged: TaggedObject,
  objectId: string,
  deps: { loggedIn: boolean },
): TaggedObject {
  if (!deps.loggedIn) {
    throw new LoginRequiredError('sync de objeto tagueado');
  }
  const existing = db.getObject(objectId);
  if (existing === undefined) {
    throw new Error(`objeto não encontrado no internal database: ${objectId}`);
  }
  return { ...tagged, syncedObjectId: existing.objectId };
}

/**
 * Cria object types e property types na ontologia para entidades já
 * existentes no internal database (a partir dos resultados de busca).
 */
export function createTypesForExisting(
  builder: OntologyBuilder,
  results: readonly SearchResult[],
): OntologyBuilder {
  for (const result of results) {
    builder.addObjectType(result.objectType);
    for (const [propertyName, value] of Object.entries(result.properties)) {
      builder.addPropertyType({
        name: propertyName,
        baseType: inferBaseType(value),
        representativeOf: [result.objectType],
      });
    }
  }
  return builder;
}

/** Base type inferido deterministicamente a partir do valor textual. */
function inferBaseType(value: string): string {
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d*\.\d+$/.test(value)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'string';
}

/**
 * Internal database em memória (determinístico) para demo e testes.
 * A busca casa a consulta com o object type e com os valores das propriedades.
 */
export function createInMemoryDatabase(objects: readonly SearchResult[]): InternalDatabase {
  const byId = new Map(objects.map((o) => [o.objectId, o]));
  return {
    search(query: string): SearchResult[] {
      const needle = query.toLowerCase();
      const results: SearchResult[] = [];
      for (const object of objects) {
        const inType = object.objectType.toLowerCase().includes(needle);
        const inProps = Object.values(object.properties).some((v) =>
          v.toLowerCase().includes(needle),
        );
        if (inType || inProps) results.push(object);
      }
      return results;
    },
    getObject(objectId: string): SearchResult | undefined {
      return byId.get(objectId);
    },
  };
}
