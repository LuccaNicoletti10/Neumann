/**
 * delta-storage — tests/gates.test.ts
 * Gates Passo 9: byte-for-byte, compactação estável, checksum, zero-copy.
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createDeltaTree } from '../src/core/tree.js';
import { DeltaCorruptError } from '../src/core/types.js';
import { createZeroCopyCache } from '../src/core/zero-copy.js';

function tree() {
  return createDeltaTree({
    fanout: 3,
    maxLevel: 2,
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

function seed(n: number) {
  const t = tree();
  const item = t.createItem('doc', { v: 0, tag: 'a' });
  for (let i = 1; i <= n; i++) {
    t.appendState(item.id, { v: i, tag: i % 2 === 0 ? 'b' : 'a' });
  }
  return { t, item };
}

describe('Passo 9 gates', () => {
  it('reconstrução byte-for-byte bate com replay linear', () => {
    const { t, item } = seed(9);
    for (let target = 0; target <= 9; target++) {
      const a = t.reconstruct(item.id, target);
      const b = t.reconstructLinear(item.id, target);
      expect(a.bytes.equals(b.bytes)).toBe(true);
      expect(a.checksum).toBe(b.checksum);
    }
  });

  it('compactação gera Combined e não altera resultado', () => {
    const { t, item } = seed(9);
    const before = t.listCombined(item.id);
    expect(before.some((c) => c.level === 1 && c.startUpdate === 1 && c.endUpdate === 3)).toBe(
      true,
    );
    // compact idempotente — não duplica
    const extra = t.compact(item.id);
    expect(extra).toHaveLength(0);
    const afterCount = t.listCombined(item.id).length;
    expect(afterCount).toBe(before.length);

    const r1 = t.reconstruct(item.id, 9);
    const r2 = t.reconstructLinear(item.id, 9);
    expect(r1.bytes.equals(r2.bytes)).toBe(true);
  });

  it('minimal set usa combined e menos individuais que o linear', () => {
    const { t, item } = seed(9);
    const set = t.determineMinimalSet(item.id, 9);
    expect(set.combined.length).toBeGreaterThan(0);
    expect(set.individuals.length).toBeLessThan(9);
    const r = t.reconstruct(item.id, 9);
    expect(r.usedCombined).toBeGreaterThan(0);
  });

  it('checksum detecta delta corrompido', () => {
    const { t, item } = seed(3);
    t.corruptIndividual(item.id, 2);
    const d = t.listIndividuals(item.id).find((x) => x.updateNumber === 2)!;
    expect(t.verifyChecksum(d)).toBe(false);
    expect(() => t.reconstructLinear(item.id, 3)).toThrow(DeltaCorruptError);
  });

  it('zero-copy: mesmo Buffer na segunda put/get', () => {
    const cache = createZeroCopyCache();
    const buf = Buffer.from('hello-zero-copy');
    const a = cache.put(buf);
    const b = cache.put(Buffer.from('hello-zero-copy'));
    expect(a.bytes).toBe(b.bytes);
    expect(cache.get(a.hash)).toBe(a.bytes);
  });
});
