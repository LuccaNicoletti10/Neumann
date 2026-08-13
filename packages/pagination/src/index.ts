/**
 * pagination — opaque page tokens.
 *
 * Adapted from OpenFoundry packages/pagination (Apache-2.0).
 * Materially modified for Node Buffer base64url (no browser btoa dependency).
 *
 * Copyright 2024 OpenFoundry Contributors — Apache-2.0
 * Copyright contributors to the NEUMANN project
 */

export type PageToken = string & { readonly __brand: 'PageToken' };

export interface PageCursor {
  offset: number;
  lastId?: string;
  sortValues?: unknown[];
  /** Keyset: last order-by value (stringified). */
  o?: string | null;
  /** Keyset: last primary key. */
  k?: string;
  /** Fingerprint of the compiled query + orderBy (reject token reuse). */
  h?: string;
  /** Keyset: 1 when the cursor sits in the NULLS LAST region of the order-by. */
  nr?: number;
}

export function encodePageToken(cursor: PageCursor): PageToken {
  if (cursor.offset < 0) {
    throw new TypeError(`PageCursor offset must be non-negative, got ${cursor.offset}`);
  }
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8').toString('base64url') as PageToken;
}

export function decodePageToken(token: string): PageCursor {
  if (!token) throw new Error('Page token must not be empty');
  let json: string;
  try {
    json = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error(`Invalid page token: unable to decode "${token}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid page token: decoded value is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid page token: decoded value must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const hasKeyset = typeof obj.k === 'string';
  const offsetOk =
    typeof obj.offset === 'number' && Number.isFinite(obj.offset) && obj.offset >= 0;
  if (!offsetOk && !hasKeyset) {
    throw new Error('Invalid page token: offset must be a non-negative number');
  }
  return {
    offset: offsetOk ? (obj.offset as number) : 0,
    lastId: typeof obj.lastId === 'string' ? obj.lastId : undefined,
    sortValues: Array.isArray(obj.sortValues) ? obj.sortValues : undefined,
    o: obj.o === null || typeof obj.o === 'string' ? (obj.o as string | null) : undefined,
    k: typeof obj.k === 'string' ? obj.k : undefined,
    h: typeof obj.h === 'string' ? obj.h : undefined,
    nr: obj.nr === 1 ? 1 : undefined,
  };
}

export interface PageRequest {
  pageSize?: number;
  pageToken?: string;
}

export interface PageResponse<T> {
  data: T[];
  nextPageToken?: PageToken;
}

export function clampPageSize(requested: number | undefined, defaults = { default: 100, max: 1000 }): number {
  const n = requested ?? defaults.default;
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('pageSize must be a positive integer');
  }
  return Math.min(Math.floor(n), defaults.max);
}

export function paginateArray<T>(
  items: readonly T[],
  req: PageRequest,
  opts?: { defaultPageSize?: number; maxPageSize?: number; idOf?: (item: T) => string },
): PageResponse<T> {
  const pageSize = clampPageSize(req.pageSize, {
    default: opts?.defaultPageSize ?? 100,
    max: opts?.maxPageSize ?? 1000,
  });
  const offset = req.pageToken ? decodePageToken(req.pageToken).offset : 0;
  const slice = items.slice(offset, offset + pageSize);
  const next = offset + pageSize;
  const last = slice[slice.length - 1];
  return {
    data: [...slice],
    nextPageToken:
      next < items.length
        ? encodePageToken({
            offset: next,
            lastId: last && opts?.idOf ? opts.idOf(last) : undefined,
          })
        : undefined,
  };
}
