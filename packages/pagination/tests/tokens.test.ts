/**
 * pagination — tests/tokens.test.ts
 */
import { describe, expect, it } from 'vitest';

import { decodePageToken, encodePageToken, paginateArray } from '../src/index.js';

describe('pagination', () => {
  it('round-trips opaque tokens', () => {
    const token = encodePageToken({ offset: 10, lastId: 'x' });
    expect(token).not.toContain('{');
    expect(decodePageToken(token)).toEqual({
      offset: 10,
      lastId: 'x',
      sortValues: undefined,
      o: undefined,
      k: undefined,
      h: undefined,
    });
  });

  it('round-trips keyset tokens', () => {
    const token = encodePageToken({ offset: 0, o: 'open', k: 'a', h: 'abc123' });
    expect(decodePageToken(token)).toMatchObject({ o: 'open', k: 'a', h: 'abc123' });
  });

  it('rejects malformed tokens', () => {
    expect(() => decodePageToken('%%%')).toThrow(/Invalid page token/);
  });

  it('paginates arrays', () => {
    const page = paginateArray([1, 2, 3, 4, 5], { pageSize: 2 });
    expect(page.data).toEqual([1, 2]);
    expect(page.nextPageToken).toBeTruthy();
    const page2 = paginateArray([1, 2, 3, 4, 5], {
      pageSize: 2,
      pageToken: page.nextPageToken,
    });
    expect(page2.data).toEqual([3, 4]);
  });
});
