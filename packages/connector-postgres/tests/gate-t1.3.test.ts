/**
 * connector-postgres — tests/gate-t1.3.test.ts
 * Gate T1.3: matar no evento 10.000, reiniciar, continuar sem dupes/skips.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryCheckpointStore, runSnapshot } from 'connector-sdk';
import type { ObjectRef } from 'contracts';

import { makeClient, makeConnector } from './helpers.js';

const OBJ: ObjectRef = { sourceSystem: 'crm', objectName: 'people' };
const TOTAL = 15_000;
const ABORT_AT = 10_000;

describe('Gate T1.3', () => {
  it('abort @ 10_000 → restart do checkpoint → 15_000 unique sem duplicatas', async () => {
    const client = makeClient(TOTAL);
    const store = createMemoryCheckpointStore();

    const phase1 = await runSnapshot({
      connector: makeConnector(client, {
        connectorId: 'pg-t13',
        pageSize: 1000,
      }),
      store,
      object: OBJ,
      abortAfter: ABORT_AT,
      persistEvery: 500,
    });

    expect(phase1.aborted).toBe(true);
    expect(phase1.events).toHaveLength(ABORT_AT);
    expect(phase1.checkpoint.token.length).toBeGreaterThan(0);

    const phase2 = await runSnapshot({
      connector: makeConnector(client, {
        connectorId: 'pg-t13',
        pageSize: 1000,
        initialCursorToken: phase1.checkpoint.token,
      }),
      store,
      object: OBJ,
      persistEvery: 500,
    });

    expect(phase2.aborted).toBe(false);
    expect(phase2.events).toHaveLength(TOTAL - ABORT_AT);

    const combined = [...phase1.events, ...phase2.events];
    expect(combined).toHaveLength(TOTAL);

    const seen = new Set<string>();
    for (const e of combined) {
      expect(seen.has(e.source_primary_key)).toBe(false);
      seen.add(e.source_primary_key);
    }
    expect(seen.size).toBe(TOTAL);

    // sequência contínua 1..15000
    const pks = combined.map((e) => Number(e.source_primary_key));
    expect(pks[0]).toBe(1);
    expect(pks[ABORT_AT - 1]).toBe(ABORT_AT);
    expect(pks[ABORT_AT]).toBe(ABORT_AT + 1);
    expect(pks[TOTAL - 1]).toBe(TOTAL);
  }, 60_000);
});
