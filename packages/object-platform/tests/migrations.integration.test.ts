/**
 * object-platform — tests/migrations.integration.test.ts
 * Versioned applyPlatformMigrations: checksum, no-op rerun, concurrent lock.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import pg from 'pg';

import {
  applyPlatformMigrations,
  checksumSql,
  createPgSqlClient,
  findInfraSqlDir,
  quoteIdent,
  tryOpenIsolatedPg,
} from '../src/core/pg-sql.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('applyPlatformMigrations', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('second run is a no-op (same checksums)', async () => {
    if (!db) return;
    const before = await db.sql.query<{ n: string; checksum: string }>(
      `SELECT count(*)::text AS n FROM schema_migrations`,
    );
    const countBefore = Number(before.rows[0]?.n ?? 0);
    expect(countBefore).toBeGreaterThanOrEqual(1);

    const rowsBefore = await db.sql.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );

    await applyPlatformMigrations(db.sql);

    const after = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM schema_migrations`,
    );
    expect(Number(after.rows[0]?.n)).toBe(countBefore);

    const rowsAfter = await db.sql.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    expect(rowsAfter.rows).toEqual(rowsBefore.rows);
  });

  it('edited historical migration fails closed naming the file', async () => {
    if (!db) return;
    const infra = findInfraSqlDir();
    const original = readFileSync(join(infra, '0001_outbox.sql'), 'utf8');
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-mig-'));
    try {
      writeFileSync(join(tmp, '0001_outbox.sql'), `${original}\n-- tampered checksum\n`);
      expect(checksumSql(`${original}\n-- tampered checksum\n`)).not.toBe(checksumSql(original));
      await expect(applyPlatformMigrations(db.sql, tmp)).rejects.toThrow(/0001_outbox\.sql/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('concurrent apply on a fresh schema runs each file once', async () => {
    if (!db) return;
    const schema = `t_mig_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const a = createPgSqlClient({ connectionString: db.connectionString, schema });
    const b = createPgSqlClient({ connectionString: db.connectionString, schema });
    try {
      await Promise.all([applyPlatformMigrations(a), applyPlatformMigrations(b)]);
      const n = await a.query<{ n: string }>(`SELECT count(*)::text AS n FROM schema_migrations`);
      const infra = findInfraSqlDir();
      const expected = readdirSync(infra).filter((f) => /^\d+_.*\.sql$/.test(f)).length;
      expect(Number(n.rows[0]?.n)).toBe(expected);
    } finally {
      await a.close();
      await b.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
  });
});
