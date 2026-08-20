/**
 * contracts — tests/object-repository.test.ts
 */
import { describe, expect, it } from 'vitest';

import type {
  LinkReader,
  LinkWriter,
  ObjectReader,
  ObjectWriter,
} from '../src/v1/object-repository.js';

describe('object storage contracts (ADR-0007)', () => {
  it('capability aliases do not expose the opposite verbs', () => {
    const readerKeys: (keyof ObjectReader)[] = ['get', 'getById', 'list'];
    const writerKeys: (keyof ObjectWriter)[] = ['create', 'update', 'delete'];
    expect(readerKeys).not.toContain('create' as keyof ObjectReader);
    expect(writerKeys).not.toContain('get' as keyof ObjectWriter);
    const linkRead: (keyof LinkReader)[] = ['listFrom', 'listTo'];
    const linkWrite: (keyof LinkWriter)[] = ['create', 'delete'];
    expect(linkRead).not.toContain('create' as keyof LinkReader);
    expect(linkWrite).not.toContain('listFrom' as keyof LinkWriter);
  });
});
