/**
 * connector-sdk — tests/writeback.test.ts
 * Passo 25: write-path + inverse map + fonte muda → object properties convergem.
 */

import { describe, expect, it } from 'vitest';

import type { PropertyMapping } from 'contracts';

import { assertConnectorShape } from '../src/core/validate.js';
import {
  propertiesToSourceFields,
  sourceFieldsToProperties,
} from '../src/core/inverse-map.js';
import { createMemoryWriteBackConnector } from '../src/core/memory-writeback.js';
import { asConnectorV2 } from '../src/core/as-v2.js';
import { runWritebackDemo } from '../src/cli.js';

const mappings: PropertyMapping[] = [
  { sourceField: 'order_status', propertyTypeId: 'status' },
  { sourceField: 'amt', propertyTypeId: 'amount', transform: 'number' },
];

describe('Passo 25 — connector write-path', () => {
  it('inverse map is reversible', () => {
    const props = { status: 'approved', amount: 42 };
    const fields = propertiesToSourceFields(props, mappings);
    expect(fields).toEqual({ order_status: 'approved', amt: 42 });
    expect(sourceFieldsToProperties(fields, mappings)).toEqual(props);
  });

  it('writeBack mutates source; snapshot sees new state; idempotencyKey is stable', async () => {
    const src = createMemoryWriteBackConnector({
      records: { 'SO-1': { order_status: 'pending', amt: 150 } },
    });
    assertConnectorShape(src);
    expect(src.capabilities).toContain('writeback');

    const first = await src.writeBack!({
      object: { sourceSystem: 'ext', objectName: 'orders' },
      primaryKey: 'SO-1',
      operation: 'update_order_status',
      fields: propertiesToSourceFields({ status: 'approved', amount: 150 }, mappings),
      idempotencyKey: 'neumann:aex-1',
    });
    expect(first.ok).toBe(true);
    expect(first.record?.order_status).toBe('approved');
    expect(src.getRecord('SO-1')?.order_status).toBe('approved');

    const again = await src.writeBack!({
      object: { sourceSystem: 'ext', objectName: 'orders' },
      primaryKey: 'SO-1',
      operation: 'update_order_status',
      fields: { order_status: 'hacked' },
      idempotencyKey: 'neumann:aex-1',
    });
    expect(again.record?.order_status).toBe('approved');

    const events = [];
    for await (const ev of src.snapshot({ sourceSystem: 'ext', objectName: 'orders' })) {
      events.push(ev);
    }
    expect(events.some((e) => e.payload.order_status === 'approved')).toBe(true);

    const converged = sourceFieldsToProperties(src.getRecord('SO-1') ?? {}, mappings);
    expect(converged.status).toBe('approved');

    const v2 = asConnectorV2(src);
    expect(typeof v2.writeBack).toBe('function');
  });

  it('cli writeback demo', async () => {
    const lines: string[] = [];
    const code = await runWritebackDemo((m) => lines.push(m));
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
