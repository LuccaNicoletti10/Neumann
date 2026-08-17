/**
 * policy-engine — src/core/principal-cache.ts
 * Cache isolado por principal — miss de A não serve hit de B (canal cache).
 */

export interface PrincipalCache {
  get(principal: string, key: string): unknown;
  set(principal: string, key: string, value: unknown): void;
  has(principal: string, key: string): boolean;
}

function slot(principal: string, key: string): string {
  return `${principal}\u001f${key}`;
}

export function createPrincipalCache(): PrincipalCache {
  const store = new Map<string, unknown>();
  return {
    get(principal, key) {
      return store.get(slot(principal, key));
    },
    set(principal, key, value) {
      store.set(slot(principal, key), value);
    },
    has(principal, key) {
      return store.has(slot(principal, key));
    },
  };
}
