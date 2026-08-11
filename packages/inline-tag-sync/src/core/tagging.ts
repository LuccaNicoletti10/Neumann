/**
 * inline-tag-sync — src/core/tagging.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * IN-LINE TAGGING INTERFACE — aplicação de "first document tags" in-line com o
 * user input: fluxo selecionar trecho → buscar objetos relacionados → escolher
 * objeto → escolher PROPRIEDADE como tag; atalho "@" durante a digitação que
 * SUBSTITUI o user input pela tag selecionada (ex.: "@John Doe" vira
 * "Email: johndoe@email.com"); e criação de NOVO objeto/tag para o trecho.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import { getField, readRange, recordRevision } from './document.js';
import type { DocumentDeps } from './document.js';
import type { ObjectStore } from './objectStore.js';
import type {
  DataObject,
  Document,
  DocumentFieldId,
  DocumentTag,
  IdGenerator,
  SearchResult,
  TagOrigin,
} from './types.js';
import { capitalize, createIdGenerator, defaultClock } from './types.js';

export interface TaggingDeps extends DocumentDeps {
  newTagId?: IdGenerator;
}

const defaultTagIds = createIdGenerator('tag');

export interface ApplyTagInput {
  field: DocumentFieldId;
  start: number;
  end: number;
  objectId: string;
  propertyKey: string;
  userId?: string;
}

/** Verifica se dois intervalos [start, end) se sobrepõem. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Aplica uma tag a um trecho do documento, vinculando-o a uma propriedade de
 * um objeto do object store. Usada tanto pela interface in-line (first tags)
 * quanto pela object-based (second tags, em sync.ts).
 */
export function applyTag(
  doc: Document,
  input: ApplyTagInput,
  origin: TagOrigin,
  store: ObjectStore,
  deps: TaggingDeps = {},
): DocumentTag {
  const userId = input.userId ?? 'system';
  const selected = readRange(doc, input.field, input.start, input.end);
  if (selected.length === 0) {
    throw new Error('o trecho selecionado não pode ser vazio');
  }
  const object = store.getObject(input.objectId);
  const value = object.properties[input.propertyKey];
  if (value === undefined) {
    throw new Error(
      `o objeto "${input.objectId}" não possui a propriedade "${input.propertyKey}"`,
    );
  }
  for (const existing of doc.tags) {
    if (
      existing.field === input.field &&
      overlaps(existing.start, existing.end, input.start, input.end)
    ) {
      throw new Error(
        `o trecho [${input.start}, ${input.end}) sobrepõe a tag "${existing.id}" ` +
          `[${existing.start}, ${existing.end}) no campo ${input.field}`,
      );
    }
  }
  const newTagId = deps.newTagId ?? defaultTagIds;
  const clock = deps.clock ?? defaultClock;
  const tag: DocumentTag = {
    id: newTagId(),
    documentId: doc.id,
    field: input.field,
    start: input.start,
    end: input.end,
    objectId: object.id,
    propertyKey: input.propertyKey,
    label: `${capitalize(input.propertyKey)}: ${value}`,
    origin,
    userId,
    createdAt: clock(),
  };
  doc.tags.push(tag);
  recordRevision(
    doc,
    'tag',
    `tag ${tag.id} (${origin}) aplicada a ${input.field}[${input.start}, ${input.end}) ` +
      `→ ${object.type}/${input.propertyKey}`,
    userId,
    deps,
  );
  return tag;
}

/** Aplica uma "first document tag" pela in-line tagging interface. */
export function applyFirstTag(
  doc: Document,
  input: ApplyTagInput,
  store: ObjectStore,
  deps: TaggingDeps = {},
): DocumentTag {
  return applyTag(doc, input, 'inline', store, deps);
}

/**
 * Busca objetos relacionados ao trecho selecionado: o texto do trecho é
 * comparado com as propriedades dos objetos do object store.
 */
export function searchForSelection(
  doc: Document,
  field: DocumentFieldId,
  start: number,
  end: number,
  store: ObjectStore,
): SearchResult[] {
  const selected = readRange(doc, field, start, end);
  return store.searchObjects(selected);
}

/** Ocorrência do atalho "@": posição do "@", fim do input e texto consultado. */
export interface ShortcutMatch {
  at: number;
  end: number;
  query: string;
}

/**
 * Faz o parse do atalho "@" digitado em um campo: usa o ÚLTIMO "@" e toma como
 * consulta todo o texto não vazio que o segue até o fim do campo (permite
 * consultas com espaços, como "@John Doe").
 */
export function parseShortcut(text: string): ShortcutMatch | null {
  const at = text.lastIndexOf('@');
  if (at < 0) return null;
  const query = text.slice(at + 1).trim();
  if (query.length === 0) return null;
  return { at, end: text.length, query };
}

export interface ShortcutSelection {
  objectId: string;
  propertyKey: string;
  userId?: string;
}

export interface ShortcutResult {
  tag: DocumentTag;
  match: ShortcutMatch;
  /** Texto do campo após a substituição do user input pela tag. */
  text: string;
}

/**
 * Atalho "@" durante a digitação: localiza o user input "@texto" no campo,
 * SUBSTITUI esse input pelo rótulo da tag (ícone + texto destacado, ex.:
 * "Email: johndoe@email.com") e aplica a tag ao trecho substituído.
 */
export function applyTagShortcut(
  doc: Document,
  fieldId: DocumentFieldId,
  selection: ShortcutSelection,
  store: ObjectStore,
  deps: TaggingDeps = {},
): ShortcutResult {
  const userId = selection.userId ?? 'system';
  const field = getField(doc, fieldId);
  const match = parseShortcut(field.text);
  if (match === null) {
    throw new Error(`nenhum atalho "@" pendente no campo ${fieldId}`);
  }
  const object: DataObject = store.getObject(selection.objectId);
  const value = object.properties[selection.propertyKey];
  if (value === undefined) {
    throw new Error(
      `o objeto "${selection.objectId}" não possui a propriedade "${selection.propertyKey}"`,
    );
  }
  // Replacing: o user input "@query" é substituído pelo texto da tag.
  const replacement = `${capitalize(selection.propertyKey)}: ${value}`;
  field.text = field.text.slice(0, match.at) + replacement + field.text.slice(match.end);
  recordRevision(
    doc,
    'shortcut',
    `user input "@${match.query}" substituído pela tag "${replacement}" em ${fieldId}`,
    userId,
    deps,
  );
  const tag = applyTag(
    doc,
    {
      field: fieldId,
      start: match.at,
      end: match.at + replacement.length,
      objectId: selection.objectId,
      propertyKey: selection.propertyKey,
      userId,
    },
    'inline',
    store,
    deps,
  );
  return { tag, match, text: field.text };
}

export interface CreateNewObjectInput {
  field: DocumentFieldId;
  start: number;
  end: number;
  /** Tipo do novo objeto (ex.: "Person"). */
  type: string;
  /** Propriedade que receberá o texto do trecho (default: "name"). */
  propertyKey?: string;
  userId?: string;
}

/**
 * Alternativa do fluxo in-line: cria um NOVO objeto/tag para o trecho
 * ("Create New Object for X") e já aplica a tag ao trecho selecionado.
 */
export function createNewObjectFor(
  doc: Document,
  input: CreateNewObjectInput,
  store: ObjectStore,
  deps: TaggingDeps = {},
): { object: DataObject; tag: DocumentTag } {
  const userId = input.userId ?? 'system';
  const selected = readRange(doc, input.field, input.start, input.end);
  if (selected.length === 0) {
    throw new Error('o trecho selecionado não pode ser vazio');
  }
  const propertyKey = input.propertyKey ?? 'name';
  const object = store.createObject({
    type: input.type,
    properties: { [propertyKey]: selected },
    createdBy: userId,
  });
  const tag = applyTag(
    doc,
    {
      field: input.field,
      start: input.start,
      end: input.end,
      objectId: object.id,
      propertyKey,
      userId,
    },
    'inline',
    store,
    deps,
  );
  return { object, tag };
}

/** Lista todas as tags do documento (ordem estável: campo, início, id). */
export function listTags(doc: Document): DocumentTag[] {
  return [...doc.tags].sort(
    (a, b) =>
      a.field.localeCompare(b.field) || a.start - b.start || a.id.localeCompare(b.id),
  );
}

/** Lista as tags de um campo específico, ordenadas pelo offset inicial. */
export function tagsInField(doc: Document, fieldId: DocumentFieldId): DocumentTag[] {
  return listTags(doc).filter((tag) => tag.field === fieldId);
}
