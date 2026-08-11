/**
 * inline-tag-sync — tests/helpers.ts
 * Fixtures compartilhadas dos testes (deps determinísticas, store e documento).
 */
import { createDocument } from '../src/core/document.js';
import { createObjectStore } from '../src/core/objectStore.js';
import type { ObjectStore } from '../src/core/objectStore.js';
import type { SyncDeps } from '../src/core/sync.js';
import type { Document, IdGenerator } from '../src/core/types.js';
import { createIdGenerator } from '../src/core/types.js';

/** Instante fixo usado em todos os testes. */
export const FIXED_NOW = '2024-06-01T12:00:00.000Z';

export interface TestDeps extends SyncDeps {
  newDocumentId: IdGenerator;
}

/** Dependências 100% determinísticas: relógio fixo + contadores sequenciais. */
export function makeDeps(): TestDeps {
  return {
    clock: () => FIXED_NOW,
    newDocumentId: createIdGenerator('doc'),
    newTagId: createIdGenerator('tag'),
    newRevisionId: createIdGenerator('rev'),
    newDataObjectId: createIdGenerator('dobj'),
    newCommentId: createIdGenerator('cmt'),
  };
}

/** Object store semeado com "John Doe's Profile" e "Local News". */
export function makeStore(): ObjectStore {
  const store = createObjectStore({ clock: () => FIXED_NOW });
  store.createObject({
    id: 'obj-john',
    type: 'Person',
    properties: {
      name: "John Doe's Profile",
      email: 'johndoe@email.com',
      role: 'Analista',
    },
    createdBy: 'ana',
  });
  store.createObject({
    id: 'obj-news',
    type: 'Article',
    properties: { title: 'Local News', topic: 'Comunidade' },
    createdBy: 'ana',
  });
  return store;
}

export const DOC_TITLE = 'Relatório semanal';
export const DOC_SUMMARY = 'Cobertura pelo Local News.';
export const DOC_NOTE = 'Contato: John Doe esteve no evento.';

/** Documento de exemplo com os três campos preenchidos. */
export function makeDoc(deps: TestDeps = makeDeps()): Document {
  return createDocument(
    {
      id: 'doc-1',
      title: DOC_TITLE,
      summary: DOC_SUMMARY,
      note: DOC_NOTE,
      userId: 'ana',
    },
    deps,
  );
}

/** Intervalo [start, end) da primeira ocorrência de `needle` em `text`. */
export function rangeOf(text: string, needle: string): { start: number; end: number } {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`"${needle}" não encontrado em "${text}"`);
  return { start, end: start + needle.length };
}
