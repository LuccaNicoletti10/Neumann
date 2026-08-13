/**
 * policy-engine — tests/pg-audit.integration.test.ts
 * Restart + concurrency + redaction durability for PgAuditRepository.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg, createUuidIdGenerator } from 'object-platform';

import { createAuditLog } from '../src/core/audit.js';
import { createPgAuditRepository } from '../src/core/pg-audit-repository.js';
import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from '../src/core/determinism.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PgAuditRepository durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('chain survives restart and continues from previous hash', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextSalt = createDeterministicSalt();
    const audit = createAuditLog({
      clock,
      nextId: createUuidIdGenerator(),
      nextSalt,
      repository: createPgAuditRepository({ sql: db.sql, transaction: db.sql }),
    });

    await audit.begin();
    await audit.append('event-a', { k: '1' });
    await audit.append('event-b', { k: '2' });
    await audit.commit('seal');
    const headBefore = await audit.head();
    expect((await audit.verify()).ok).toBe(true);

    await db.sql.close();
    const sql2 = db.reconnect();
    const audit2 = createAuditLog({
      clock: createDeterministicClock(),
      nextId: createUuidIdGenerator(),
      nextSalt: createDeterministicSalt(),
      repository: createPgAuditRepository({ sql: sql2, transaction: sql2 }),
    });
    expect((await audit2.verify()).ok).toBe(true);
    const headAfter = await audit2.head();
    expect(headAfter?.summaryHash).toBe(headBefore?.summaryHash);
    expect(headAfter?.id).toBe(headBefore?.id);

    const continued = await audit2.append('event-after-restart', { k: '3' });
    expect(continued.previousSummaryHash).toBe(headBefore?.summaryHash);
    expect((await audit2.verify()).ok).toBe(true);
    await sql2.close();
  });

  it('concurrent appends keep a valid chain', async () => {
    if (!db) return;
    const sql = db.reconnect();
    await sql.query('DELETE FROM platform_audit_entries');
    const nextId = createIdGenerator();
    const make = () =>
      createAuditLog({
        clock: createDeterministicClock(),
        nextId,
        nextSalt: createDeterministicSalt(),
        repository: createPgAuditRepository({ sql, transaction: sql }),
      });
    const a = make();
    const b = make();
    await a.begin();
    await Promise.all([a.append('concurrent-1', { w: '1' }), b.append('concurrent-2', { w: '2' })]);
    expect((await a.verify()).ok).toBe(true);
    const listed = await a.list();
    expect(listed.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < listed.length; i += 1) {
      expect(listed[i]?.previousSummaryHash).toBe(listed[i - 1]?.summaryHash);
    }
    await sql.close();
  });

  it('redaction survives restart and verify stays green', async () => {
    if (!db) return;
    const sql = db.reconnect();
    await sql.query('DELETE FROM platform_audit_entries');
    const audit = createAuditLog({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      nextSalt: createDeterministicSalt(),
      repository: createPgAuditRepository({ sql, transaction: sql }),
    });
    await audit.begin();
    const ev = await audit.append('secret-payload', { k: 's' });
    await audit.commit('c');
    await audit.redact(ev.id);
    expect((await audit.verify()).ok).toBe(true);
    const redacted = (await audit.list()).find((e) => e.id === ev.id);
    expect(redacted?.messageType).toBe('REDACTED');
    expect(redacted?.eventData).toBeNull();
    expect(redacted?.salt).toBeNull();
    expect(redacted?.logHash).toBe(ev.logHash);
    expect(redacted?.summaryHash).toBe(ev.summaryHash);

    await sql.close();
    const sql2 = db.reconnect();
    const audit2 = createAuditLog({
      repository: createPgAuditRepository({ sql: sql2, transaction: sql2 }),
    });
    expect((await audit2.verify()).ok).toBe(true);
    const again = (await audit2.list()).find((e) => e.id === ev.id);
    expect(again?.messageType).toBe('REDACTED');
    expect(again?.eventData).toBeNull();
    await sql2.close();
  });
});
