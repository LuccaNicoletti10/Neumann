/**
 * external-content-exporter — src/core/tagStore.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: ARMAZENAMENTO LOCAL — a tag
 * recebida é armazenada no sistema externo (memória do electronic device ou
 * cache do browser) em uma fila de tags pendentes, e o conteúdo externo fica
 * armazenado sob um label no cache/diretório associado à tagging interface;
 * suporta as combinações de armazenamento externo, interno ou ambos. Nenhum
 * texto dos claims é reproduzido; apenas a funcionalidade é reimplementada de
 * forma original.
 */

import { CoreError } from './types.js';
import type { ContentCacheLike } from './content.js';
import type { ExternalContent, StorageCombination, Tag } from './types.js';

/** Locais de armazenamento externo (sistema fora do internal database). */
export type ExternalStorageLocation = 'device-memory' | 'browser-cache';

/** Cache local: label → conteúdo externo armazenado. */
export interface ContentCache extends ContentCacheLike {
  storeContent(label: string, content: ExternalContent): void;
  getContent(label: string): ExternalContent | undefined;
  labels(): string[];
  remove(label: string): boolean;
}

/**
 * Armazenamento local do sistema externo: fila de tags pendentes de exportação
 * e cache de conteúdos sob label. O conteúdo e as tags podem permanecer no
 * externo e ser exportados DEPOIS (quando o device conectar/logar).
 */
export interface TagStore {
  /** Local externo onde as tags são mantidas (memória ou cache do browser). */
  location: ExternalStorageLocation;
  /** Armazena a tag recebida na fila de pendentes do sistema externo. */
  saveTag(tag: Tag): void;
  /** Fila de tags pendentes de exportação (ordem de criação). */
  pendingQueue(): Tag[];
  /** Remove a tag da fila (após exportação bem-sucedida). */
  markExported(tagId: string): boolean;
  getTag(tagId: string): Tag | undefined;
  /** Cache de conteúdo externo sob label. */
  contentCache: ContentCache;
  /** Rastreia onde cada tag está armazenada (externo/interno/ambos). */
  setStorage(tagId: string, storage: StorageCombination): void;
  storageOf(tagId: string): StorageCombination;
}

export interface TagStoreDeps {
  location?: ExternalStorageLocation;
}

/** Cria o armazenamento local (default: memória do electronic device). */
export function createTagStore(deps: TagStoreDeps = {}): TagStore {
  const pending: Tag[] = [];
  const contents = new Map<string, ExternalContent>();
  const storageByTag = new Map<string, StorageCombination>();

  const contentCache: ContentCache = {
    storeContent(label: string, content: ExternalContent): void {
      contents.set(label, { ...content });
    },
    getContent(label: string): ExternalContent | undefined {
      const found = contents.get(label);
      return found === undefined ? undefined : { ...found };
    },
    labels(): string[] {
      return [...contents.keys()];
    },
    remove(label: string): boolean {
      return contents.delete(label);
    },
  };

  return {
    location: deps.location ?? 'device-memory',
    saveTag(tag: Tag): void {
      if (pending.some((candidate) => candidate.id === tag.id)) {
        throw new CoreError('DUPLICATE_TAG', `tag já armazenada: ${tag.id}`);
      }
      pending.push({ ...tag, selection: { ...tag.selection } });
      storageByTag.set(tag.id, 'external');
    },
    pendingQueue(): Tag[] {
      return pending.map((tag) => ({ ...tag, selection: { ...tag.selection } }));
    },
    markExported(tagId: string): boolean {
      const index = pending.findIndex((tag) => tag.id === tagId);
      if (index < 0) return false;
      const previous = storageByTag.get(tagId) ?? 'external';
      pending.splice(index, 1);
      // Após exportar, a tag passa a existir também no interno.
      storageByTag.set(tagId, previous === 'external' ? 'internal' : 'both');
      return true;
    },
    getTag(tagId: string): Tag | undefined {
      const found = pending.find((tag) => tag.id === tagId);
      return found === undefined ? undefined : { ...found, selection: { ...found.selection } };
    },
    contentCache,
    setStorage(tagId: string, storage: StorageCombination): void {
      storageByTag.set(tagId, storage);
    },
    storageOf(tagId: string): StorageCombination {
      return storageByTag.get(tagId) ?? 'external';
    },
  };
}
