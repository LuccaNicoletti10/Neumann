#!/usr/bin/env node
/**
 * Require DATABASE_URL, wait for PostgreSQL, apply applyPlatformMigrations.
 */
import {
  applyPlatformMigrations,
  createPgSqlClient,
  listPlatformMigrationFiles,
  redactDatabaseUrl,
  waitForPostgres,
} from 'object-platform';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('db:migrate requires DATABASE_URL (password is never logged)');
    process.exit(1);
  }

  const timeoutMs = Number(process.env.NEUMANN_PG_WAIT_MS ?? 30_000);
  await waitForPostgres(url, { timeoutMs });
  const sql = createPgSqlClient({ connectionString: url });
  try {
    await applyPlatformMigrations(sql);
    const expected = listPlatformMigrationFiles();
    const applied = await sql.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    const names = applied.rows.map((r) => String(r.filename));
    const missing = expected.filter((f) => !names.includes(f));
    if (missing.length > 0) {
      console.error(`db:migrate incomplete: missing ${missing.join(', ')}`);
      process.exit(1);
    }
    console.log(`db:migrate ok at ${redactDatabaseUrl(url)}`);
    console.log(`migrations: ${names.join(', ')}`);
  } finally {
    await sql.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
