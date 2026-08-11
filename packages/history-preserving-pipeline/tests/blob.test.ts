/**
 * history-preserving-pipeline — tests/blob.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FsBlobStore, MemoryBlobStore } from '../src/core/blob-store.js';
import { hashBytes } from '../src/core/hash.js';

describe('BlobStore', () => {
  it('MemoryBlobStore é content-addressed e deduplica', () => {
    const store = new MemoryBlobStore();
    const a = store.put(Buffer.from('hello'));
    const b = store.put(Buffer.from('hello'));
    expect(a.contentHash).toBe(hashBytes(Buffer.from('hello')));
    expect(a.contentRef).toBe(`sha256/${a.contentHash}`);
    expect(b.contentHash).toBe(a.contentHash);
    expect(store.get(a.contentHash)?.bytes.toString()).toBe('hello');
  });

  it('FsBlobStore persiste sob diretório', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hpp-blob-'));
    try {
      const store = new FsBlobStore(dir);
      const c = store.put(Buffer.from('fs-data'), 'text/plain');
      expect(store.has(c.contentHash)).toBe(true);
      const again = new FsBlobStore(dir);
      expect(again.get(c.contentHash)?.bytes.toString()).toBe('fs-data');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
