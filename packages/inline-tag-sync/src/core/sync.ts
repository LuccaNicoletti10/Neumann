/**
 * inline-tag-sync — src/core/sync.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * SINCRONIZAÇÃO ENTRE PLATAFORMAS — aplicação de "second document tags" pela
 * object-based interface (ATUALIZA o data object E o documento correspondente);
 * re-edição sem deslocamento (carrega o documento a partir do data object,
 * identifica as LOCALIZAÇÕES ABSOLUTAS das tags, remove todas as tags, edita o
 * texto e re-aplica as tags nas localizações absolutas); sincronização final
 * das edições com o data object; e colaboração (comentários/motivos de edição
 * e histórico de revisões). Nenhum texto dos claims é reproduzido; apenas a
 * funcionalidade é reimplementada de forma original.
 */

import { COMMENTS_PROPERTY, generateDataObject, parseTagRefs, REVISIONS_PROPERTY, tagRefsFromDocument } from './dataObject.js';
import type { DataObjectDeps } from './dataObject.js';
import { getField, recordRevision, setFieldText } from './document.js';
import type { ObjectStore } from './objectStore.js';
import { applyTag } from './tagging.js';
import type { TaggingDeps } from './tagging.js';
import type {
  Clock,
  DataObject,
  DataObjectTagRef,
  Document,
  DocumentFieldId,
  DocumentTag,
  EditComment,
  IdGenerator,
  Revision,
} from './types.js';
import { createIdGenerator, defaultClock } from './types.js';

export interface SyncDeps extends TaggingDeps, DataObjectDeps {
  newCommentId?: IdGenerator;
}

export interface SecondTagInput {
  field: DocumentFieldId;
  start: number;
  end: number;
  objectId: string;
  propertyKey: string;
  userId?: string;
}

/**
 * Aplica uma "second document tag" pela OBJECT-BASED INTERFACE: a tag é
 * aplicada ao documento (origem 'object-based') e o data object correspondente
 * é ATUALIZADO em seguida — documento e data object permanecem sempre com
 * todas as tags (sincronização entre plataformas).
 */
export function applySecondTag(
  doc: Document,
  input: SecondTagInput,
  store: ObjectStore,
  deps: SyncDeps = {},
): { tag: DocumentTag; dataObject: DataObject } {
  const dataObject = store.findByProperty('documentId', doc.id);
  if (dataObject === undefined) {
    throw new Error(
      `nenhum data object encontrado para o documento "${doc.id}"; ` +
        'gere o data object antes de aplicar second tags',
    );
  }
  const tag = applyTag(doc, { ...input }, 'object-based', store, deps);
  const updated = generateDataObject(doc, store, deps);
  return { tag, dataObject: updated };
}

/** Localização absoluta de uma tag identificada no carregamento. */
export type AbsoluteTagLocation = DataObjectTagRef;

/**
 * Sessão de re-edição: documento carregado a partir do data object, SEM tags
 * (todas removidas para permitir editar o texto livremente), mais as
 * localizações absolutas identificadas para re-aplicação posterior.
 */
export interface EditingSession {
  dataObjectId: string;
  document: Document;
  absoluteLocations: AbsoluteTagLocation[];
}

/**
 * Carrega o documento a partir do data object para re-edição: identifica as
 * LOCALIZAÇÕES ABSOLUTAS das tags e REMOVE todas as tags do documento, de modo
 * que o texto pode ser editado sem deslocar tags (elas serão re-aplicadas nas
 * mesmas localizações absolutas ao finalizar).
 */
export function reloadDocumentForEditing(
  dataObjectId: string,
  store: ObjectStore,
  deps: SyncDeps = {},
): EditingSession {
  const dataObject = store.getObject(dataObjectId);
  const documentId = dataObject.properties['documentId'];
  if (documentId === undefined) {
    throw new Error(
      `o objeto "${dataObjectId}" não é um data object de documento (sem "documentId")`,
    );
  }
  // Identifica as localizações absolutas das tags carregadas no data object.
  const absoluteLocations = parseTagRefs(dataObject).sort(
    (a, b) =>
      a.field.localeCompare(b.field) || a.start - b.start || a.tagId.localeCompare(b.tagId),
  );
  const makeField = (fieldId: DocumentFieldId, label: string): { id: DocumentFieldId; label: string; text: string } => ({
    id: fieldId,
    label,
    text: dataObject.properties[fieldId] ?? '',
  });
  const document: Document = {
    id: documentId,
    fields: {
      title: makeField('title', 'Título'),
      summary: makeField('summary', 'Resumo'),
      note: makeField('note', 'Anotação'),
    },
    tags: [], // todas as tags removidas durante a sessão de edição
    // Colaboração preservada: comentários e histórico viajam com o data object.
    comments: JSON.parse(dataObject.properties[COMMENTS_PROPERTY] ?? '[]') as EditComment[],
    revisions: JSON.parse(dataObject.properties[REVISIONS_PROPERTY] ?? '[]') as Revision[],
    createdBy: dataObject.createdBy,
    createdAt: dataObject.createdAt,
  };
  recordRevision(
    document,
    'reload',
    `documento recarregado do data object "${dataObjectId}"; ` +
      `${absoluteLocations.length} tag(s) removida(s) para edição sem deslocamento`,
    'system',
    deps,
  );
  return { dataObjectId, document, absoluteLocations };
}

/**
 * Edita um campo do documento da sessão (texto livre, sem deslocar tags).
 * Atalho conveniente sobre setFieldText para o fluxo de re-edição.
 */
export function editSessionField(
  session: EditingSession,
  fieldId: DocumentFieldId,
  text: string,
  userId = 'system',
  deps: SyncDeps = {},
): void {
  setFieldText(session.document, fieldId, text, userId, deps);
}

/**
 * Finaliza a re-edição: RE-APLICA todas as tags nas LOCALIZAÇÕES ABSOLUTAS
 * identificadas no carregamento (independentemente das edições feitas no
 * texto) e sincroniza as edições com o data object na segunda plataforma.
 */
export function synchronizeEdits(
  session: EditingSession,
  store: ObjectStore,
  deps: SyncDeps = {},
): { document: Document; dataObject: DataObject } {
  const clock = deps.clock ?? defaultClock;
  const doc = session.document;
  for (const location of session.absoluteLocations) {
    const text = getField(doc, location.field).text;
    if (location.start > text.length) {
      throw new Error(
        `localização absoluta da tag "${location.tagId}" fora do texto editado ` +
          `(${location.field}@${location.start} > ${text.length})`,
      );
    }
    const end = Math.min(location.end, text.length);
    const tag: DocumentTag = {
      id: location.tagId,
      documentId: doc.id,
      field: location.field,
      start: location.start,
      end,
      objectId: location.objectId,
      propertyKey: location.propertyKey,
      label: location.label,
      origin: location.origin,
      userId: location.userId,
      createdAt: clock(),
    };
    doc.tags.push(tag);
  }
  recordRevision(
    doc,
    'sync',
    `${session.absoluteLocations.length} tag(s) re-aplicada(s) nas localizações ` +
      `absolutas; edições sincronizadas com o data object "${session.dataObjectId}"`,
    'system',
    deps,
  );
  const dataObject = generateDataObject(doc, store, deps);
  return { document: doc, dataObject };
}

const defaultCommentIds = createIdGenerator('cmt');

/**
 * Registra um comentário/motivo de edição associado ao documento (ex.:
 * "aprovado para publicação"), com userId e instante (colaboração).
 */
export function addEditComment(
  doc: Document,
  userId: string,
  text: string,
  deps: SyncDeps = {},
): EditComment {
  if (text.trim().length === 0) {
    throw new Error('o comentário não pode ser vazio');
  }
  const clock = deps.clock ?? defaultClock;
  const newCommentId = deps.newCommentId ?? defaultCommentIds;
  const comment: EditComment = {
    id: newCommentId(),
    documentId: doc.id,
    userId,
    text,
    at: clock(),
  };
  doc.comments.push(comment);
  recordRevision(doc, 'comment', `comentário de ${userId}: "${text}"`, userId, deps);
  return comment;
}

/** Histórico de revisões do documento (ordem de registro). */
export function revisionHistory(doc: Document): Revision[] {
  return [...doc.revisions];
}

/**
 * Conferência de sincronização: devolve true quando o data object carrega
 * exatamente as mesmas tags (id, campo e offsets) do documento.
 */
export function isSynchronized(doc: Document, store: ObjectStore): boolean {
  const dataObject = store.findByProperty('documentId', doc.id);
  if (dataObject === undefined) return false;
  const refs = parseTagRefs(dataObject);
  const docRefs = tagRefsFromDocument(doc);
  if (refs.length !== docRefs.length) return false;
  const key = (r: DataObjectTagRef): string =>
    `${r.tagId}|${r.field}|${r.start}|${r.end}|${r.objectId}|${r.propertyKey}|${r.origin}`;
  const a = refs.map(key).sort();
  const b = docRefs.map(key).sort();
  return a.every((value, index) => value === b[index]);
}
