/**
 * inline-tag-sync — src/core/dataObject.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * GERAÇÃO DO DATA OBJECT — a partir das tags do documento (object-based data
 * modeling framework), gera/atualiza o data object na segunda plataforma
 * (object store), carregando as first tags com suas localizações absolutas, e
 * produz a "object view" do documento exibida ao salvar. Nenhum texto dos
 * claims é reproduzido; apenas a funcionalidade é reimplementada de forma
 * original.
 */

import { getField } from './document.js';
import type { ObjectStore } from './objectStore.js';
import { objectLabel } from './objectStore.js';
import type {
  Clock,
  DataObject,
  DataObjectTagRef,
  Document,
  DocumentFieldId,
  IdGenerator,
  TagOrigin,
} from './types.js';
import { createIdGenerator } from './types.js';

/** Tipo reservado aos data objects gerados a partir de documentos. */
export const DATA_OBJECT_TYPE = 'Document';

/** Propriedade que guarda as tags serializadas dentro do data object. */
export const TAGS_PROPERTY = 'tags';

/** Propriedade que guarda o histórico de revisões serializado. */
export const REVISIONS_PROPERTY = 'revisions';

/** Propriedade que guarda os comentários de edição serializados. */
export const COMMENTS_PROPERTY = 'comments';

export interface DataObjectDeps {
  clock?: Clock;
  newDataObjectId?: IdGenerator;
}

const defaultDataObjectIds = createIdGenerator('dobj');

/** Converte as tags do documento em referências carregadas no data object. */
export function tagRefsFromDocument(doc: Document): DataObjectTagRef[] {
  return doc.tags.map((tag) => ({
    tagId: tag.id,
    field: tag.field,
    start: tag.start,
    end: tag.end,
    objectId: tag.objectId,
    propertyKey: tag.propertyKey,
    label: tag.label,
    origin: tag.origin,
    userId: tag.userId,
  }));
}

/** Faz o parse das referências de tag armazenadas em um data object. */
export function parseTagRefs(dataObject: DataObject): DataObjectTagRef[] {
  const raw = dataObject.properties[TAGS_PROPERTY];
  if (raw === undefined || raw === '') return [];
  return JSON.parse(raw) as DataObjectTagRef[];
}

/**
 * Gera o data object do documento baseado em suas tags e o cria/atualiza na
 * segunda plataforma (object store). Se já existir um data object para o
 * documento, ele é ATUALIZADO (documento e data object sempre com todas as
 * tags); caso contrário, um novo é criado.
 */
export function generateDataObject(
  doc: Document,
  store: ObjectStore,
  deps: DataObjectDeps = {},
): DataObject {
  const properties: Record<string, string> = {
    documentId: doc.id,
    title: getField(doc, 'title').text,
    summary: getField(doc, 'summary').text,
    note: getField(doc, 'note').text,
    [TAGS_PROPERTY]: JSON.stringify(tagRefsFromDocument(doc)),
    [REVISIONS_PROPERTY]: JSON.stringify(doc.revisions),
    [COMMENTS_PROPERTY]: JSON.stringify(doc.comments),
  };
  const existing = store.findByProperty('documentId', doc.id);
  if (existing !== undefined) {
    return store.replaceProperties(existing.id, properties);
  }
  const newDataObjectId = deps.newDataObjectId ?? defaultDataObjectIds;
  return store.createObject({
    id: newDataObjectId(),
    type: DATA_OBJECT_TYPE,
    properties,
    createdBy: doc.createdBy,
  });
}

/** Entrada da "object view": trecho tagueado + objeto/propriedade vinculados. */
export interface ObjectViewEntry {
  tagId: string;
  field: DocumentFieldId;
  start: number;
  end: number;
  text: string;
  objectId: string;
  objectType: string;
  objectLabel: string;
  propertyKey: string;
  propertyValue: string;
  label: string;
  origin: TagOrigin;
  userId: string;
}

/** "Object view" do documento, exibida ao salvar o data object. */
export interface ObjectView {
  documentId: string;
  dataObjectId: string;
  title: string;
  entries: ObjectViewEntry[];
}

/**
 * Gera a object view do documento: para cada tag, resolve o trecho de texto e
 * o objeto/propriedade vinculados no object store.
 */
export function generateObjectView(
  doc: Document,
  store: ObjectStore,
  deps: DataObjectDeps = {},
): ObjectView {
  const dataObject = generateDataObject(doc, store, deps);
  const entries: ObjectViewEntry[] = doc.tags.map((tag) => {
    const object = store.getObject(tag.objectId);
    return {
      tagId: tag.id,
      field: tag.field,
      start: tag.start,
      end: tag.end,
      text: getField(doc, tag.field).text.slice(tag.start, tag.end),
      objectId: object.id,
      objectType: object.type,
      objectLabel: objectLabel(object),
      propertyKey: tag.propertyKey,
      propertyValue: object.properties[tag.propertyKey] ?? '',
      label: tag.label,
      origin: tag.origin,
      userId: tag.userId,
    };
  });
  return {
    documentId: doc.id,
    dataObjectId: dataObject.id,
    title: getField(doc, 'title').text,
    entries,
  };
}
