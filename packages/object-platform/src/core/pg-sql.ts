/**
 * object-platform — src/core/pg-sql.ts
 * PostgreSQL SqlClient + TransactionManager. One connection per transaction.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';
import type { SqlClient, SqlQueryResult, TransactionManager } from 'contracts';

const { Pool } = pg;

export type { SqlClient, SqlQueryResult, TransactionManager };

export function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new Error(`invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

export interface TransactionalSqlClient extends SqlClient, TransactionManager {
  close(): Promise<void>;
  /** Hold one pool connection for the duration of `fn` (advisory locks, migration runner). */
  withSession<T>(fn: (sql: SqlClient) => Promise<T>): Promise<T>;
}

export interface CreatePgSqlClientOptions {
  connectionString: string;
  /** Optional schema; SET search_path on every checkout and RESET on release. */
  schema?: string;
}

function wrapResult<T>(result: pg.QueryResult): SqlQueryResult<T> {
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

export function createPgSqlClient(opts: CreatePgSqlClientOptions): TransactionalSqlClient {
  const pool = new Pool({ connectionString: opts.connectionString });
  const schema = opts.schema;

  async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      if (schema) {
        await client.query(`SET search_path TO ${quoteIdent(schema)}`);
      }
      return await fn(client);
    } finally {
      try {
        await client.query('RESET search_path');
      } catch {
        /* ignore */
      }
      client.release();
    }
  }

  let closed = false;

  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      return withClient(async (client) =>
        wrapResult<T>(await client.query(text, params)),
      );
    },

    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      return withClient(async (client) => {
        await client.query('BEGIN');
        const tx: SqlClient = {
          async query<R = Record<string, unknown>>(text: string, params?: unknown[]) {
            return wrapResult<R>(await client.query(text, params));
          },
        };
        try {
          const result = await fn(tx);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    },

    async withSession<T>(fn: (sql: SqlClient) => Promise<T>): Promise<T> {
      return withClient(async (client) => {
        const session: SqlClient = {
          async query<R = Record<string, unknown>>(text: string, params?: unknown[]) {
            return wrapResult<R>(await client.query(text, params));
          },
        };
        return fn(session);
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

export function findInfraSqlDir(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'infra', 'sql');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('infra/sql not found (run tests from the monorepo)');
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER
);
`;

export function checksumSql(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function hasWithSession(
  sql: SqlClient,
): sql is SqlClient & { withSession: TransactionalSqlClient['withSession'] } {
  return typeof (sql as TransactionalSqlClient).withSession === 'function';
}

async function runPlatformMigrations(sql: SqlClient, sqlDir?: string): Promise<void> {
  const dir = sqlDir ?? findInfraSqlDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  await sql.query('SELECT pg_advisory_lock(8041716, hashtext(current_schema()))');
  try {
    await sql.query(SCHEMA_MIGRATIONS_DDL);

    for (const file of files) {
      const body = readFileSync(join(dir, file), 'utf8');
      const checksum = checksumSql(body);
      const existing = await sql.query<{ checksum: string }>(
        `SELECT checksum FROM schema_migrations WHERE filename = $1`,
        [file],
      );
      const prev = existing.rows[0]?.checksum;
      if (prev) {
        if (prev !== checksum) {
          throw new Error(
            `migration checksum mismatch: ${file} was already applied with a different checksum; historical migrations must not be edited`,
          );
        }
        continue;
      }

      const started = Date.now();
      await sql.query('BEGIN');
      try {
        await sql.query(body);
        await sql.query(
          `INSERT INTO schema_migrations (filename, checksum, duration_ms)
           VALUES ($1, $2, $3)`,
          [file, checksum, Date.now() - started],
        );
        await sql.query('COMMIT');
      } catch (err) {
        try {
          await sql.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      }
    }
  } finally {
    await sql.query('SELECT pg_advisory_unlock(8041716, hashtext(current_schema()))').catch(
      () => undefined,
    );
  }
}

/**
 * Apply numbered `infra/sql/*.sql` files once, tracked in `schema_migrations`.
 * Re-runs with the same checksum are no-ops. Edited historical files fail closed.
 */
export async function applyPlatformMigrations(sql: SqlClient, sqlDir?: string): Promise<void> {
  if (hasWithSession(sql)) {
    await sql.withSession((session) => runPlatformMigrations(session, sqlDir));
    return;
  }
  await runPlatformMigrations(sql, sqlDir);
}

export const DEFAULT_TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://neumann:neumann@127.0.0.1:5432/neumann';

export async function tryOpenIsolatedPg(url = DEFAULT_TEST_DATABASE_URL): Promise<
  | {
      sql: TransactionalSqlClient;
      schema: string;
      connectionString: string;
      reconnect(): TransactionalSqlClient;
      close(): Promise<void>;
    }
  | undefined
> {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  try {
    await admin.query('SELECT 1');
  } catch {
    await admin.end().catch(() => undefined);
    return undefined;
  }
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
  } catch (err) {
    await admin.end().catch(() => undefined);
    throw err;
  }
  await admin.end();

  const sql = createPgSqlClient({ connectionString: url, schema });
  await applyPlatformMigrations(sql);
  return {
    sql,
    schema,
    connectionString: url,
    reconnect() {
      return createPgSqlClient({ connectionString: url, schema });
    },
    async close() {
      await sql.close();
      const drop = new Pool({ connectionString: url });
      try {
        await drop.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      } finally {
        await drop.end();
      }
    },
  };
}
