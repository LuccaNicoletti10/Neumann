/**
 * contracts — src/v1/sql.ts
 * Shared SQL client / unit-of-work primitives for durable adapters.
 */

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

/** Minimal query surface. A transaction client is also a SqlClient. */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<SqlQueryResult<T>>;
}

/**
 * Runs `fn` on a single PostgreSQL connection inside BEGIN/COMMIT.
 * Throw → ROLLBACK. Nested calls must receive the same tx client, not a new pool checkout.
 */
export interface TransactionManager {
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}
