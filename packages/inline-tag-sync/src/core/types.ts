/**
 * inline-tag-sync — src/core/types.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * TIPOS DO NÚCLEO — documento com campos de texto editáveis (title, summary,
 * note), tag de documento aplicada a um trecho (offsets absolutos, objeto e
 * propriedade vinculados, origem inline/object-based, userId), data object da
 * segunda plataforma, resultado de busca de objetos, comentário de edição e
 * revisão do histórico. Nenhum texto dos claims é reproduzido; apenas a
 * funcionalidade é reimplementada de forma original.
 */

/** Identificadores dos campos de texto editáveis do documento. */
export type DocumentFieldId = 'title' | 'summary' | 'note';

/** Campo de texto editável do documento; user input é associado a um campo. */
export interface DocumentField {
  id: DocumentFieldId;
  label: string;
  text: string;
}

/** Origem da tag: aplicada pela interface in-line ou pela object-based. */
export type TagOrigin = 'inline' | 'object-based';

/**
 * Tag aplicada a um trecho do documento. `start`/`end` são offsets absolutos
 * dentro do campo; a tag vincula o trecho a uma PROPRIEDADE de um objeto.
 */
export interface DocumentTag {
  id: string;
  documentId: string;
  field: DocumentFieldId;
  start: number;
  end: number;
  objectId: string;
  propertyKey: string;
  /** Rótulo de exibição (ex.: "Email: johndoe@email.com"). */
  label: string;
  origin: TagOrigin;
  userId: string;
  createdAt: string;
}

/** Comentário/motivo associado a uma edição do documento (colaboração). */
export interface EditComment {
  id: string;
  documentId: string;
  userId: string;
  text: string;
  at: string;
}

/** Ações registradas no histórico de revisões do documento. */
export type RevisionAction =
  | 'create'
  | 'edit'
  | 'tag'
  | 'shortcut'
  | 'comment'
  | 'reload'
  | 'sync';

/** Entrada do histórico de revisões (cada edição registra userId e instante). */
export interface Revision {
  id: string;
  documentId: string;
  userId: string;
  action: RevisionAction;
  detail: string;
  at: string;
}

/** Documento da primeira plataforma (campos de texto + tags + colaboração). */
export interface Document {
  id: string;
  fields: Record<DocumentFieldId, DocumentField>;
  tags: DocumentTag[];
  comments: EditComment[];
  revisions: Revision[];
  createdBy: string;
  createdAt: string;
}

/**
 * Objeto da segunda plataforma (object store): tipo + propriedades textuais.
 * Data objects gerados a partir de documentos usam este mesmo formato.
 */
export interface DataObject {
  id: string;
  type: string;
  properties: Record<string, string>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Resultado da busca de objetos por correspondência em propriedades. */
export interface SearchResult {
  objectId: string;
  type: string;
  /** Rótulo de exibição (ex.: "John Doe's Profile", "Local News"). */
  label: string;
  matchedProperty: string;
  matchedValue: string;
}

/**
 * Referência de tag carregada no data object: preserva a localização absoluta
 * (campo + offsets) para re-aplicação sem deslocamento na re-edição.
 */
export interface DataObjectTagRef {
  tagId: string;
  field: DocumentFieldId;
  start: number;
  end: number;
  objectId: string;
  propertyKey: string;
  label: string;
  origin: TagOrigin;
  userId: string;
}

/** Relógio injetável (determinismo: nada de Date.now/new Date direto). */
export type Clock = () => string;

/** Gerador de identificadores injetável. */
export type IdGenerator = () => string;

/** Instante fixo usado pelo relógio padrão (totalmente determinístico). */
export const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';

/** Relógio padrão: sempre o mesmo instante (determinístico). */
export const defaultClock: Clock = () => DEFAULT_TIMESTAMP;

/** Gerador padrão de ids: contador sequencial com prefixo (`doc-1`, `tag-1`...). */
export function createIdGenerator(prefix: string): IdGenerator {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

/** Capitaliza a primeira letra de uma chave de propriedade (exibição). */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
