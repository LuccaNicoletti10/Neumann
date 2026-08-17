import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { runConnectorAcceptanceTests } from '../src/index.js';
import { createCsvConnector } from 'connector-csv';
import { createHttpConnector } from 'connector-http';
import { createWebhookConnector } from 'connector-webhook';
import { asConnectorV2 } from 'connector-sdk';
import { createPostgresConnector, createMemorySqlClient } from 'connector-postgres';

describe('CAT', () => {
  it('csv connector passes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cat-csv-'));
    const path = join(dir, 'data.csv');
    writeFileSync(path, 'id,name\n1,a\n2,b\n');
    const r = await runConnectorAcceptanceTests(createCsvConnector({ path }));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('http connector passes with mock fetch', async () => {
    const r = await runConnectorAcceptanceTests(
      createHttpConnector({
        url: 'http://example.test/items',
        fetchImpl: async () =>
          new Response(JSON.stringify([{ id: '1' }, { id: '2' }]), { status: 200 }),
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('webhook connector passes', async () => {
    const r = await runConnectorAcceptanceTests(
      createWebhookConnector({ secret: 's', events: [{ id: 'e1' }, { id: 'e2' }] }),
    );
    expect(r.ok).toBe(true);
  });

  it('postgres connector v2 passes CAT', async () => {
    const client = createMemorySqlClient([
      {
        id: '1',
        name: 'A',
        email: 'a@x',
        updated_at: '2024-01-01T00:00:01.000Z',
        deleted_at: null,
      },
      {
        id: '2',
        name: 'B',
        email: 'b@x',
        updated_at: '2024-01-01T00:00:02.000Z',
        deleted_at: null,
      },
    ]);
    const v1 = createPostgresConnector({
      connectorId: 'pg-cat',
      sourceSystem: 'crm',
      tables: [{ name: 'people', primaryKey: 'id' }],
      client,
    });
    const r = await runConnectorAcceptanceTests(asConnectorV2(v1, '2.0.0'));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
