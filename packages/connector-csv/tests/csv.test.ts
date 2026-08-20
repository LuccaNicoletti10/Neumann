/**
 * connector-csv — read, schema, invalid input, checkpoint.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCsvConnector } from '../src/index.js';

function writeCsv(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'neumann-csv-'));
  const path = join(dir, 'data.csv');
  writeFileSync(path, contents);
  return path;
}

async function collect(connector: ReturnType<typeof createCsvConnector>) {
  const records: Array<{ payload: Record<string, unknown>; checkpoint?: string }> = [];
  const states: unknown[] = [];
  const errors: string[] = [];
  for await (const msg of connector.read({ fullRefresh: true })) {
    if (msg.type === 'RECORD') {
      records.push({
        payload: msg.record.payload as Record<string, unknown>,
        checkpoint: msg.record.checkpoint,
      });
    }
    if (msg.type === 'STATE') states.push(msg.state);
    if (msg.type === 'ERROR') errors.push(msg.message);
  }
  return { records, states, errors };
}

describe('createCsvConnector', () => {
  it('converts header columns into records and checkpoints', async () => {
    const path = writeCsv('id,name,classification\n1,alpha,internal\n2,beta,\n');
    const connector = createCsvConnector({ path, connectorId: 'csv-test' });

    const spec = await connector.spec();
    expect(spec.connectorId).toBe('csv-test');

    const schema = await connector.schema('csv');
    expect(schema.columns.map((c) => c.name)).toEqual(['id', 'name', 'classification']);
    expect(schema.columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);

    const { records, states, errors } = await collect(connector);
    expect(errors).toEqual([]);
    expect(records.map((r) => r.payload)).toEqual([
      { id: '1', name: 'alpha', classification: 'internal' },
      { id: '2', name: 'beta', classification: '' },
    ]);
    expect(records.map((r) => r.checkpoint)).toEqual(['1', '2']);
    expect(states).toHaveLength(1);
  });

  it('check fails on missing file', async () => {
    const connector = createCsvConnector({ path: join(tmpdir(), 'neumann-csv-missing-no-such-file.csv') });
    const check = await connector.check();
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/ENOENT|no such file/i);
  });

  it('header-only CSV yields no records and an empty schema (schema comes from the first data row)', async () => {
    const path = writeCsv('id,name\n');
    const connector = createCsvConnector({ path });
    const schema = await connector.schema('csv');
    expect(schema.columns).toEqual([]);
    const { records, states, errors } = await collect(connector);
    expect(errors).toEqual([]);
    expect(records).toEqual([]);
    expect(states).toHaveLength(1);
  });
});
