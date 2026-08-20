/**
 * ingestion-runtime — catalog contract on PostgreSQL (survives reconnect).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator, tryOpenIsolatedPg } from 'object-platform';

import {
  createPgConnectorRegistrationRepository,
  createPgMappingVersionRepository,
} from '../src/index.js';
import { runCatalogContract } from './catalog-contract.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('catalog contract (postgres)', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('survives reconnect without reseed', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const connectors = createPgConnectorRegistrationRepository({ sql: db.sql });
    const mappings = createPgMappingVersionRepository({ sql: db.sql, clock, nextId });
    await runCatalogContract({ connectors, mappings, now: clock() });

    const sql = db.reconnect();
    const reopenedC = createPgConnectorRegistrationRepository({ sql });
    const reopenedM = createPgMappingVersionRepository({
      sql,
      clock,
      nextId: createIdGenerator(),
    });
    const connector = await reopenedC.get('wh-1');
    expect(connector?.enabled).toBe(false);
    expect(JSON.stringify(connector?.config)).not.toMatch(/secret/i);
    const latest = await reopenedM.getLatest('map-1');
    expect(latest?.versionNumber).toBe(2);
  });
});
