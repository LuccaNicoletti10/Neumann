/**
 * delta-storage — src/core/zero-copy.ts
 * Cache content-addressed: leitura retorna o mesmo Buffer (sem cópia).
 * US 9,367,463 / US 9,652,291 — zero-copy / shared cache.
 */

import { hashBytes } from './hash.js';

export interface ZeroCopyCache {
  /** Guarda bytes; se hash já existe, retorna o buffer existente (mesma ref). */
  put(bytes: Buffer): { hash: string; bytes: Buffer };
  /** Retorna a mesma referência armazenada (zero-copy). */
  get(hash: string): Buffer | undefined;
  has(hash: string): boolean;
  size(): number;
}

export function createZeroCopyCache(): ZeroCopyCache {
  const store = new Map<string, Buffer>();

  return {
    put(bytes: Buffer): { hash: string; bytes: Buffer } {
      const hash = hashBytes(bytes);
      const existing = store.get(hash);
      if (existing) {
        return { hash, bytes: existing };
      }
      // Guarda a referência fornecida (não clona) — leitor compartilhado.
      store.set(hash, bytes);
      return { hash, bytes };
    },

    get(hash: string): Buffer | undefined {
      return store.get(hash);
    },

    has(hash: string): boolean {
      return store.has(hash);
    },

    size(): number {
      return store.size;
    },
  };
}
