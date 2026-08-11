/**
 * inline-tag-sync — src/core/document.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * MODELO DO DOCUMENTO — criação do documento com os campos editáveis title,
 * summary e note, operações de edição de user input (inserir/remover texto com
 * offsets absolutos), leitura de trecho por offsets e registro de revisões com
 * userId. Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import type {
  Clock,
  Document,
  DocumentField,
  DocumentFieldId,
  IdGenerator,
  RevisionAction,
} from './types.js';
import { createIdGenerator, defaultClock } from './types.js';

/** Rótulos pt-BR dos campos editáveis. */
export const FIELD_LABELS: Record<DocumentFieldId, string> = {
  title: 'Título',
  summary: 'Resumo',
  note: 'Anotação',
};

/** Ordem fixa dos campos do documento. */
export const DOCUMENT_FIELD_IDS: readonly DocumentFieldId[] = ['title', 'summary', 'note'];

/** Guarda de runtime para identificadores de campo. */
export function isDocumentFieldId(value: unknown): value is DocumentFieldId {
  return value === 'title' || value === 'summary' || value === 'note';
}

export interface DocumentDeps {
  clock?: Clock;
  newRevisionId?: IdGenerator;
}

const defaultRevisionIds = createIdGenerator('rev');

/** Registra uma entrada no histórico de revisões do documento. */
export function recordRevision(
  doc: Document,
  action: RevisionAction,
  detail: string,
  userId: string,
  deps: DocumentDeps = {},
): void {
  const clock = deps.clock ?? defaultClock;
  const newRevisionId = deps.newRevisionId ?? defaultRevisionIds;
  doc.revisions.push({
    id: newRevisionId(),
    documentId: doc.id,
    userId,
    action,
    detail,
    at: clock(),
  });
}

export interface CreateDocumentInput {
  id?: string;
  title?: string;
  summary?: string;
  note?: string;
  userId?: string;
}

export interface CreateDocumentDeps extends DocumentDeps {
  newDocumentId?: IdGenerator;
}

const defaultDocumentIds = createIdGenerator('doc');

/** Cria um documento com os três campos de texto editáveis. */
export function createDocument(
  input: CreateDocumentInput = {},
  deps: CreateDocumentDeps = {},
): Document {
  const clock = deps.clock ?? defaultClock;
  const newDocumentId = deps.newDocumentId ?? defaultDocumentIds;
  const id = input.id ?? newDocumentId();
  const userId = input.userId ?? 'system';
  const makeField = (fieldId: DocumentFieldId, text: string): DocumentField => ({
    id: fieldId,
    label: FIELD_LABELS[fieldId],
    text,
  });
  const doc: Document = {
    id,
    fields: {
      title: makeField('title', input.title ?? ''),
      summary: makeField('summary', input.summary ?? ''),
      note: makeField('note', input.note ?? ''),
    },
    tags: [],
    comments: [],
    revisions: [],
    createdBy: userId,
    createdAt: clock(),
  };
  recordRevision(doc, 'create', `documento "${id}" criado`, userId, deps);
  return doc;
}

/** Devolve o campo do documento ou falha se o identificador for inválido. */
export function getField(doc: Document, fieldId: DocumentFieldId): DocumentField {
  const field = doc.fields[fieldId];
  if (field === undefined) {
    throw new Error(`campo desconhecido: "${String(fieldId)}"`);
  }
  return field;
}

/** Lê o trecho [start, end) de um campo (offsets absolutos). */
export function readRange(
  doc: Document,
  fieldId: DocumentFieldId,
  start: number,
  end: number,
): string {
  const text = getField(doc, fieldId).text;
  assertRange(text, start, end);
  return text.slice(start, end);
}

function assertRange(text: string, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error('offsets devem ser inteiros');
  }
  if (start < 0 || end < start || end > text.length) {
    throw new Error(
      `intervalo inválido [${start}, ${end}) para texto de ${text.length} caracteres`,
    );
  }
}

/** Insere user input (texto) em um campo, no offset absoluto indicado. */
export function insertText(
  doc: Document,
  fieldId: DocumentFieldId,
  offset: number,
  text: string,
  userId = 'system',
  deps: DocumentDeps = {},
): Document {
  const field = getField(doc, fieldId);
  if (!Number.isInteger(offset) || offset < 0 || offset > field.text.length) {
    throw new Error(
      `offset de inserção inválido ${offset} para campo de ${field.text.length} caracteres`,
    );
  }
  field.text = field.text.slice(0, offset) + text + field.text.slice(offset);
  recordRevision(
    doc,
    'edit',
    `inserido "${text}" em ${fieldId}@${offset}`,
    userId,
    deps,
  );
  return doc;
}

/** Remove o trecho [start, end) de um campo. */
export function removeText(
  doc: Document,
  fieldId: DocumentFieldId,
  start: number,
  end: number,
  userId = 'system',
  deps: DocumentDeps = {},
): Document {
  const field = getField(doc, fieldId);
  assertRange(field.text, start, end);
  const removed = field.text.slice(start, end);
  field.text = field.text.slice(0, start) + field.text.slice(end);
  recordRevision(
    doc,
    'edit',
    `removido "${removed}" de ${fieldId}@[${start}, ${end})`,
    userId,
    deps,
  );
  return doc;
}

/** Substitui integralmente o texto de um campo (usado na re-edição). */
export function setFieldText(
  doc: Document,
  fieldId: DocumentFieldId,
  text: string,
  userId = 'system',
  deps: DocumentDeps = {},
): Document {
  const field = getField(doc, fieldId);
  field.text = text;
  recordRevision(doc, 'edit', `campo ${fieldId} redefinido`, userId, deps);
  return doc;
}
