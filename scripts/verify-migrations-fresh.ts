#!/usr/bin/env node
/**
 * Empty-database migration gate. Schema-isolated Vitest is not this proof.
 * Creates a disposable PostgreSQL database (not a schema) and fails closed
 * if CREATEDB is denied.
 */
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import pg from 'pg';

import {
  applyPlatformMigrations,
  checksumSql,
  createPgSqlClient,
  findInfraSqlDir,
  listPlatformMigrationFiles,
  quoteIdent,
  redactDatabaseUrl,
  waitForPostgres,
} from 'object-platform';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('verify:migrations:fresh requires DATABASE_URL (this is not a skip)');
    process.exit(1);
  }
  return url;
}

function dbConnectionString(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function createEmptyDatabase(url: string, name: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: url });
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `verify:migrations:fresh failed to CREATE DATABASE (CREATEDB required, not a skip): ${message}`,
    );
  } finally {
    await admin.end();
  }
}

async function dropDatabase(url: string, name: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: url });
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
}

async function withEmptyDatabase<T>(
  url: string,
  fn: (sql: ReturnType<typeof createPgSqlClient>, database: string) => Promise<T>,
): Promise<T> {
  const database = `neumann_fresh_${randomBytes(4).toString('hex')}`;
  await createEmptyDatabase(url, database);
  const sql = createPgSqlClient({ connectionString: dbConnectionString(url, database) });
  try {
    return await fn(sql, database);
  } finally {
    await sql.close();
    await dropDatabase(url, database);
  }
}

async function assertFinalCatalog(sql: ReturnType<typeof createPgSqlClient>): Promise<void> {
  const files = listPlatformMigrationFiles();
  const applied = await sql.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations ORDER BY filename`,
  );
  const names = applied.rows.map((r) => r.filename);
  if (JSON.stringify(names) !== JSON.stringify(files)) {
    throw new Error(
      `verify:migrations:fresh applied ${names.join(', ')} expected ${files.join(', ')}`,
    );
  }
  if (names.at(-1) !== '0026_history_seq_function_read_seq.sql') {
    throw new Error('verify:migrations:fresh expected tail 0026_history_seq_function_read_seq.sql');
  }
  const trigger = await sql.query<{ tgname: string }>(
    `SELECT t.tgname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname IN ('mapping_versions_immutable', 'function_artifacts_immutable')
       AND n.nspname = current_schema()
       AND NOT t.tgisinternal
     ORDER BY t.tgname`,
  );
  if (trigger.rows.map((r) => r.tgname).join(',') !== 'function_artifacts_immutable,mapping_versions_immutable') {
    throw new Error('verify:migrations:fresh missing immutability triggers');
  }
  const idx = await sql.query<{ relname: string }>(
    `SELECT c.relname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'ingestion_webhook_nonces_expires_at_idx'
       AND n.nspname = current_schema()`,
  );
  if (idx.rows.length !== 1) {
    throw new Error('verify:migrations:fresh missing ingestion_webhook_nonces_expires_at_idx');
  }
  const tables = await sql.query<{ relname: string }>(
    `SELECT relname FROM pg_class
     WHERE relkind = 'r'
       AND relname IN (
         'schema_migrations',
         'mapping_versions',
         'connector_registrations',
         'ingestion_webhook_nonces',
         'ingestion_runs',
         'function_artifacts',
         'function_executions'
       )
     ORDER BY relname`,
  );
  if (tables.rows.length !== 7) {
    throw new Error(`verify:migrations:fresh missing tables: ${JSON.stringify(tables.rows)}`);
  }
}

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  await waitForPostgres(url);
  const infra = findInfraSqlDir();
  const all = listPlatformMigrationFiles(infra);

  await withEmptyDatabase(url, async (sql) => {
    await applyPlatformMigrations(sql);
    await assertFinalCatalog(sql);
    const first = await sql.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    await applyPlatformMigrations(sql);
    const second = await sql.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    if (JSON.stringify(second.rows) !== JSON.stringify(first.rows)) {
      throw new Error('verify:migrations:fresh second apply was not a no-op');
    }

    const tmp = mkdtempSync(join(tmpdir(), 'neumann-fresh-cksum-'));
    try {
      const original = readFileSync(join(infra, '0001_outbox.sql'), 'utf8');
      writeFileSync(join(tmp, '0001_outbox.sql'), `${original}\n-- tampered checksum\n`);
      if (checksumSql(`${original}\n-- tampered checksum\n`) === checksumSql(original)) {
        throw new Error('verify:migrations:fresh checksum fixture did not diverge');
      }
      let failed = false;
      try {
        await applyPlatformMigrations(sql, tmp);
      } catch (err) {
        failed = /0001_outbox\.sql/.test(err instanceof Error ? err.message : String(err));
      }
      if (!failed) {
        throw new Error('verify:migrations:fresh checksum mismatch did not fail closed');
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    console.log('verify:migrations:fresh empty database 0001→0026, no-op rerun, checksum fail-closed');
  });

  await withEmptyDatabase(url, async (sql) => {
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-fresh-25-'));
    try {
      for (const file of all) {
        if (file >= '0026_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      await applyPlatformMigrations(sql, tmp);
      const before = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      if (before.rows.at(-1)?.filename !== '0025_function_runtime.sql') {
        throw new Error('verify:migrations:fresh upgrade fixture was not stopped at 0025');
      }
      await applyPlatformMigrations(sql);
      const after = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      if (after.rows.map((r) => r.filename).join(',') !== all.join(',')) {
        throw new Error('verify:migrations:fresh 0025→0026 upgrade incomplete');
      }
      if (!after.rows.some((r) => r.filename === '0026_history_seq_function_read_seq.sql')) {
        throw new Error('verify:migrations:fresh 0025→0026 did not apply 0026');
      }
      await assertFinalCatalog(sql);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    console.log('verify:migrations:fresh upgrade 0025→0026 on empty database');
  });

  await withEmptyDatabase(url, async (sql) => {
    const tmp = mkdtempSync(join(tmpdir(), 'neumann-fresh-fail-'));
    try {
      for (const file of all) {
        if (file >= '0026_') continue;
        copyFileSync(join(infra, file), join(tmp, file));
      }
      writeFileSync(join(tmp, '0026_history_seq_function_read_seq.sql'), 'SELECT 1 / 0;\n');
      let failed = false;
      try {
        await applyPlatformMigrations(sql, tmp);
      } catch (err) {
        failed = /division by zero/i.test(err instanceof Error ? err.message : String(err));
      }
      if (!failed) {
        throw new Error('verify:migrations:fresh failing 0026 did not roll back');
      }
      const afterFail = await sql.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      if (afterFail.rows.at(-1)?.filename !== '0025_function_runtime.sql') {
        throw new Error('verify:migrations:fresh failing 0026 left schema_migrations dirty');
      }
      if (afterFail.rows.some((r) => r.filename === '0026_history_seq_function_read_seq.sql')) {
        throw new Error('verify:migrations:fresh recorded a rolled-back 0026');
      }
      await applyPlatformMigrations(sql);
      await assertFinalCatalog(sql);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    console.log('verify:migrations:fresh failing migration rolled back on empty database');
  });

  console.log(`verify:migrations:fresh ok at ${redactDatabaseUrl(url)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
