/**
 * object-platform — tests/prompt08d-active-link.test.ts
 *
 * Memory oracle for active-link CAS upsert (ADR-0012). Not revive.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryLinkRepository } from '../src/core/link-repository.js';

const inp = {
  ontologyId: 'o',
  linkTypeId: 'lt',
  sourceObjectTypeId: 'src',
  sourcePrimaryKey: 'sp',
  targetObjectTypeId: 'tgt',
  targetPrimaryKey: 'tp',
};

describe('Active link upsert (CAS) — memory, not revive', () => {
  it('expectedVersion on a live link updates provenance and bumps version', async () => {
    const links = createMemoryLinkRepository();
    const created = await links.create({ ...inp, provenance: { observedAt: 't1' } });
    expect(created.deleted).toBe(false);
    expect(created.version).toBe(1);
    const upserted = await links.create({
      ...inp,
      expectedVersion: 1,
      provenance: { observedAt: 't2' },
    });
    expect(upserted.deleted).toBe(false);
    expect(upserted.version).toBe(2);
    expect(upserted.id).toBe(created.id);
    expect(upserted.provenance?.observedAt).toBe('t2');
  });

  it('live link without expectedVersion is already-exists, not an upsert', async () => {
    const links = createMemoryLinkRepository();
    await links.create(inp);
    await expect(links.create({ ...inp, provenance: { observedAt: 't2' } })).rejects.toThrow(
      /already exists/i,
    );
  });

  it('live link with stale expectedVersion throws VERSION_CONFLICT', async () => {
    const links = createMemoryLinkRepository();
    await links.create(inp);
    await expect(links.create({ ...inp, expectedVersion: 99 })).rejects.toThrow(
      /version conflict/i,
    );
  });
});
