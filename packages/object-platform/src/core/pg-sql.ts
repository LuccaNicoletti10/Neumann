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

export const POLICY_GENERATION_CHANNEL = 'neumann_policy_generation';

export interface NotificationClient {
  query(text: string, params?: unknown[]): Promise<unknown>;
  on(event: string, handler: (msg: { channel: string; payload?: string }) => void): void;
  off?(event: string, handler: (msg: { channel: string; payload?: string }) => void): void;
  release?: () => void;
}

export interface PoolLike {
  connect(): Promise<NotificationClient>;
}

/**
 * LISTEN on `channel` using a caller-provided client. Caller owns release.
 */
export async function listenForNotifications(
  client: NotificationClient,
  channel: string,
  onNotify: (payload: string) => void,
): Promise<() => Promise<void>> {
  await client.query(`LISTEN ${quoteIdent(channel)}`);
  const handler = (msg: { channel: string; payload?: string }) => {
    if (msg.channel === channel) onNotify(msg.payload ?? '');
  };
  client.on('notification', handler);
  return async () => {
    client.off?.('notification', handler);
    await client.query(`UNLISTEN ${quoteIdent(channel)}`).catch(() => undefined);
  };
}

/**
 * Hold one pool connection for LISTEN until the returned stop() runs.
 * WHY: Pool checkouts are released after each query; NOTIFY requires a
 * session that stays subscribed.
 */
export async function attachPoolListen(
  pool: PoolLike,
  opts: { schema?: string; channel: string; onNotify: (payload: string) => void },
): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    if (opts.schema) {
      await client.query(`SET search_path TO ${quoteIdent(opts.schema)}`);
    }
    // WHY: pool.end() while this checkout is live emits Connection terminated;
    // the handler keeps shutdown fail-closed without an unhandled rejection.
    client.on('error', () => undefined);
    const stop = await listenForNotifications(client, opts.channel, opts.onNotify);
    let stopped = false;
    return async () => {
      if (stopped) return;
      stopped = true;
      await stop();
      await client.query('RESET search_path').catch(() => undefined);
      client.release?.();
    };
  } catch (err) {
    client.release?.();
    throw err;
  }
}

export interface TransactionalSqlClient extends SqlClient, TransactionManager {
  close(): Promise<void>;
  /** Hold one pool connection for the duration of `fn` (advisory locks, migration runner). */
  withSession<T>(fn: (sql: SqlClient) => Promise<T>): Promise<T>;
  /**
   * Dedicated LISTEN connection. Production replica path (ADR-0009).
   */
  listen(channel: string, onNotify: (payload: string) => void): Promise<() => void | Promise<void>>;
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
  const listenStops = new Set<() => Promise<void>>();

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

    async listen(channel, onNotify) {
      const stop = await attachPoolListen(pool, { schema, channel, onNotify });
      const wrapped = async () => {
        listenStops.delete(wrapped);
        await stop();
      };
      listenStops.add(wrapped);
      return wrapped;
    },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...listenStops].map((stop) => stop()));
      listenStops.clear();
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

export class PostgresUnavailableError extends Error {
  override readonly name = 'PostgresUnavailableError';
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class PostgresConfigError extends Error {
  override readonly name = 'PostgresConfigError';
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export type IsolatedPg = {
  sql: TransactionalSqlClient;
  schema: string;
  connectionString: string;
  reconnect(): TransactionalSqlClient;
  close(): Promise<void>;
};

/** Present only when `DATABASE_URL` is set. No implicit host port 5432. */
export const DEFAULT_TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

function stripSecrets(text: string): string {
  return text.replace(/:([^:@/]+)@/g, ':***@');
}

export function classifyPgConnectError(err: unknown, redactedUrl: string): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const raw = err instanceof Error ? err.message : String(err);
  const message = stripSecrets(raw);

  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return new PostgresConfigError(
      `PostgreSQL authentication failed at ${redactedUrl} (${code || '28P01'})`,
      code || '28P01',
    );
  }
  if (code === '3D000' || /database ".*" does not exist/i.test(message)) {
    return new PostgresConfigError(
      `PostgreSQL database does not exist at ${redactedUrl} (${code || '3D000'})`,
      code || '3D000',
    );
  }
  if (code === '28000' || /role ".*" does not exist/i.test(message)) {
    return new PostgresConfigError(
      `PostgreSQL role does not exist at ${redactedUrl} (${code || '28000'})`,
      code || '28000',
    );
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN'
  ) {
    return new PostgresUnavailableError(
      `PostgreSQL is not reachable at ${redactedUrl} (${code})`,
      code,
    );
  }
  return new PostgresConfigError(
    `PostgreSQL connection failed at ${redactedUrl}: ${message}`,
    code || 'PG_CONNECT',
  );
}

function resolveConnectionString(url?: string): string {
  if (url && url.length > 0) return url;
  return process.env.DATABASE_URL ?? '';
}

export async function waitForPostgres(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  if (!url) {
    throw new PostgresConfigError(
      'DATABASE_URL is required for PostgreSQL integration',
      'DATABASE_URL_MISSING',
    );
  }
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 500;
  const redacted = redactDatabaseUrl(url);
  const started = Date.now();
  let last: Error | undefined;
  while (Date.now() - started < timeoutMs) {
    const pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: Math.min(2_000, timeoutMs),
    });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (err) {
      await pool.end().catch(() => undefined);
      last = classifyPgConnectError(err, redacted);
      if (last instanceof PostgresConfigError) {
        throw last;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw (
    last ??
    new PostgresUnavailableError(
      `PostgreSQL is not reachable at ${redacted} within ${timeoutMs}ms`,
      'TIMEOUT',
    )
  );
}

export function listPlatformMigrationFiles(sqlDir?: string): string[] {
  const dir = sqlDir ?? findInfraSqlDir();
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
}

async function openIsolatedPgAt(url: string): Promise<IsolatedPg> {
  const redacted = redactDatabaseUrl(url);
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await admin.query('SELECT 1');
  } catch (err) {
    await admin.end().catch(() => undefined);
    throw classifyPgConnectError(err, redacted);
  }
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
  } catch (err) {
    await admin.end().catch(() => undefined);
    throw err;
  }
  await admin.end();

  const sql = createPgSqlClient({ connectionString: url, schema });
  try {
    await applyPlatformMigrations(sql);
  } catch (err) {
    await sql.close().catch(() => undefined);
    throw err;
  }
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

/** Mandatory open: missing URL, auth, config, and migration failures throw. */
export async function openIsolatedPg(url?: string): Promise<IsolatedPg> {
  const connectionString = resolveConnectionString(url);
  if (!connectionString) {
    throw new PostgresConfigError(
      'DATABASE_URL is required for PostgreSQL integration',
      'DATABASE_URL_MISSING',
    );
  }
  return openIsolatedPgAt(connectionString);
}

/**
 * Optional open for unit/local. Returns undefined only when DATABASE_URL is
 * unset or PostgreSQL is not listening (ECONNREFUSED / ENOTFOUND / …).
 * Authentication, wrong database, and migration failures always throw.
 */
export async function tryOpenIsolatedPg(url?: string): Promise<IsolatedPg | undefined> {
  const connectionString = resolveConnectionString(url);
  if (!connectionString) return undefined;
  try {
    return await openIsolatedPgAt(connectionString);
  } catch (err) {
    if (err instanceof PostgresUnavailableError) return undefined;
    throw err;
  }
}
