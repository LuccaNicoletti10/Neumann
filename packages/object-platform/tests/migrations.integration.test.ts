/**
 * object-platform — tests/migrations.integration.test.ts
 * Versioned applyPlatformMigrations: checksum, no-op rerun, concurrent lock.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import pg from 'pg';

import {
  applyPlatformMigrations,
  checksumSql,
  createPgSqlClient,
  findInfraSqlDir,
  listPlatformMigrationFiles,
  openIsolatedPg,
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

  it('empty schema receives every numbered file through 0024', async () => {
    if (!db) return;
    const files = await db.sql.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename`,
    );
    const expected = listPlatformMigrationFiles();
    expect(expected.at(-1)).toBe('0026_history_seq_function_read_seq.sql');
    expect(files.rows.map((r) => r.filename)).toEqual(expected);
  });

  it('schema already at 0013 applies only 0014', async () => {
    if (!db) return;
    const schema = `t_mig13_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    const infra = findInfraSqlDir();
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-mig13-'));
    try {
      for (const file of listPlatformMigrationFiles(infra)) {
        if (file.startsWith('0014_')) continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      await applyPlatformMigrations(sql, tmp);
      const before = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(before.rows.map((r) => r.filename)).not.toContain('0014_er_gold_set.sql');

      await applyPlatformMigrations(sql);
      const after = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(after.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
      expect(after.rows.length).toBe(before.rows.length + 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
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

  it('schema already at 0020 upgrades through 0026', async () => {
    if (!db) return;
    const schema = `t_mig20_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    const infra = findInfraSqlDir();
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-mig20-'));
    try {
      for (const file of listPlatformMigrationFiles(infra)) {
        if (file >= '0021_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      await applyPlatformMigrations(sql, tmp);
      const before = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(before.rows.map((r) => r.filename).at(-1)).toBe(
        '0020_action_idempotency_scope.sql',
      );
      expect(before.rows.map((r) => r.filename)).not.toContain(
        '0021_object_version_migration.sql',
      );

      await applyPlatformMigrations(sql);
      const after = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(after.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
      expect(after.rows.length).toBe(before.rows.length + 6);
      const cols = await sql.query<{ attname: string }>(
        `SELECT attname FROM pg_attribute
         WHERE attrelid = 'platform_object_history'::regclass
           AND attname IN ('from_ontology_version_id', 'to_ontology_version_id')
         ORDER BY attname`,
      );
      expect(cols.rows.map((r) => r.attname)).toEqual([
        'from_ontology_version_id',
        'to_ontology_version_id',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
  });

  it('a failing 0021 rolls back and leaves schema_migrations at 0020', async () => {
    if (!db) return;
    const schema = `t_migfail_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    const infra = findInfraSqlDir();
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-migfail-'));
    try {
      for (const file of listPlatformMigrationFiles(infra)) {
        if (file >= '0021_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      writeFileSync(
        join(tmp, '0021_object_version_migration.sql'),
        'SELECT 1 / 0;\n',
      );
      await expect(applyPlatformMigrations(sql, tmp)).rejects.toThrow(/division by zero/i);

      const afterFail = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(afterFail.rows.map((r) => r.filename).at(-1)).toBe(
        '0020_action_idempotency_scope.sql',
      );
      expect(afterFail.rows.map((r) => r.filename)).not.toContain(
        '0021_object_version_migration.sql',
      );
      const missing = await sql.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_attribute
         WHERE attrelid = 'platform_object_history'::regclass
           AND attname = 'from_ontology_version_id'`,
      );
      expect(Number(missing.rows[0]?.n)).toBe(0);

      await applyPlatformMigrations(sql);
      const recovered = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(recovered.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
  });

  it('a failing 0023 rolls back at 0022 then recovery upgrades through 0026', async () => {
    if (!db) return;
    const schema = `t_migfail23_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    const infra = findInfraSqlDir();
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-migfail23-'));
    try {
      for (const file of listPlatformMigrationFiles(infra)) {
        if (file >= '0023_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      writeFileSync(join(tmp, '0023_ingestion_ingress_catalog.sql'), 'SELECT 1 / 0;\n');
      await expect(applyPlatformMigrations(sql, tmp)).rejects.toThrow(/division by zero/i);
      const afterFail = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(afterFail.rows.map((r) => r.filename).at(-1)).toBe('0022_ingestion_runtime.sql');
      expect(afterFail.rows.map((r) => r.filename)).not.toContain(
        '0023_ingestion_ingress_catalog.sql',
      );
      await applyPlatformMigrations(sql);
      const recovered = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(recovered.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
      expect(recovered.rows.length).toBe(afterFail.rows.length + 4);
      const tables = await sql.query<{ relname: string }>(
        `SELECT relname FROM pg_class
         WHERE relname IN ('connector_registrations', 'mapping_versions', 'ingestion_webhook_inbox')
           AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
         ORDER BY relname`,
        [schema],
      );
      expect(tables.rows.map((r) => r.relname)).toEqual([
        'connector_registrations',
        'ingestion_webhook_inbox',
        'mapping_versions',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
  });

  it('fresh schema applies 0001–0026 and a second run is a no-op', async () => {
    if (!db) return;
    const schema = `t_migfresh_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    try {
      await applyPlatformMigrations(sql);
      const first = await sql.query<{ filename: string; checksum: string }>(
        `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
      );
      expect(first.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
      expect(first.rows.at(-1)?.filename).toBe('0026_history_seq_function_read_seq.sql');

      await applyPlatformMigrations(sql);
      const second = await sql.query<{ filename: string; checksum: string }>(
        `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
      );
      expect(second.rows).toEqual(first.rows);
    } finally {
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
    });

  it('a failing 0025 rolls back at 0024 then recovery upgrades through 0026', async () => {
    if (!db) return;
    const schema = `t_migfail25_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: db.connectionString });
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const sql = createPgSqlClient({ connectionString: db.connectionString, schema });
    const infra = findInfraSqlDir();
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-migfail25-'));
    try {
      for (const file of listPlatformMigrationFiles(infra)) {
        if (file >= '0025_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      writeFileSync(join(tmp, '0025_function_runtime.sql'), 'SELECT 1 / 0;\n');
      await expect(applyPlatformMigrations(sql, tmp)).rejects.toThrow(/division by zero/i);
      const afterFail = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(afterFail.rows.map((r) => r.filename).at(-1)).toBe('0024_mapping_immutability.sql');
      expect(afterFail.rows.map((r) => r.filename)).not.toContain('0025_function_runtime.sql');
      const missing = await sql.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class
         WHERE relname = 'function_artifacts'
           AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)`,
        [schema],
      );
      expect(Number(missing.rows[0]?.n)).toBe(0);
      await applyPlatformMigrations(sql);
      const recovered = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      expect(recovered.rows.map((r) => r.filename)).toEqual(listPlatformMigrationFiles());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await sql.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await admin.end();
    }
    });
  it('wrong password throws PostgresConfigError and does not look like a skip', async () => {
    if (!db) return;
    const parsed = new URL(db.connectionString);
    parsed.password = 'this-password-is-wrong';
    await expect(tryOpenIsolatedPg(parsed.toString())).rejects.toThrow(/authentication failed/);
    await expect(openIsolatedPg(parsed.toString())).rejects.toThrow(/authentication failed/);
  });
});
