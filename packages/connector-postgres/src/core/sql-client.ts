/**
 * connector-postgres — src/core/sql-client.ts
 * Abstração SQL injetável (testes sem Docker/pg).
 */

export interface SqlClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface MemoryPersonRow {
  id: string;
  name: string;
  email: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MemorySqlClient extends SqlClient {
  /** Seed / mutate rows (testes). */
  upsert(rows: MemoryPersonRow[]): void;
  all(): MemoryPersonRow[];
}

function cmpPk(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Cliente em memória com tabela `people` (id, name, email, updated_at, deleted_at).
 * Interpreta um subconjunto mínimo de SQL usado pelo connector.
 */
export function createMemorySqlClient(seed: MemoryPersonRow[] = []): MemorySqlClient {
  const byId = new Map<string, MemoryPersonRow>();
  for (const row of seed) {
    byId.set(row.id, { ...row });
  }

  function rowsSorted(): MemoryPersonRow[] {
    return [...byId.values()].sort((a, b) => cmpPk(a.id, b.id));
  }

  return {
    upsert(rows) {
      for (const row of rows) byId.set(row.id, { ...row });
    },
    all() {
      return rowsSorted();
    },
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      // health ping
      if (normalized === 'select 1 as ok' || normalized === 'select 1') {
        return { rows: [{ ok: 1 } as T] };
      }

      // information_schema.columns (schema discovery)
      if (normalized.includes('information_schema.columns')) {
        const table = String(params[0] ?? 'people');
        if (table !== 'people') return { rows: [] };
        const cols = [
          { column_name: 'id', data_type: 'text', is_nullable: 'NO', is_pk: true },
          { column_name: 'name', data_type: 'text', is_nullable: 'NO', is_pk: false },
          { column_name: 'email', data_type: 'text', is_nullable: 'NO', is_pk: false },
          { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', is_pk: false },
          { column_name: 'deleted_at', data_type: 'timestamp with time zone', is_nullable: 'YES', is_pk: false },
        ];
        return { rows: cols as T[] };
      }

      // snapshot: SELECT ... FROM people WHERE id > $1 ORDER BY id ASC LIMIT $2
      if (normalized.includes('order by id asc') && normalized.includes('limit')) {
        const lastPk = params[0] === null || params[0] === undefined ? null : String(params[0]);
        const limit = Number(params[1] ?? 100);
        let list = rowsSorted();
        if (lastPk !== null) {
          list = list.filter((r) => cmpPk(r.id, lastPk) > 0);
        }
        return { rows: list.slice(0, limit) as T[] };
      }

      // cdc: updated_at > $1 OR (updated_at = $1 AND id > $2) ORDER BY updated_at ASC, id ASC LIMIT $3
      if (normalized.includes('updated_at') && normalized.includes('order by updated_at')) {
        const cursorTs = String(params[0] ?? '');
        const lastPk = String(params[1] ?? '');
        const limit = Number(params[2] ?? 100);
        const list = rowsSorted()
          .filter((r) => {
            if (r.updated_at > cursorTs) return true;
            if (r.updated_at === cursorTs && cmpPk(r.id, lastPk) > 0) return true;
            return false;
          })
          .sort((a, b) => {
            if (a.updated_at < b.updated_at) return -1;
            if (a.updated_at > b.updated_at) return 1;
            return cmpPk(a.id, b.id);
          });
        return { rows: list.slice(0, limit) as T[] };
      }

      throw new Error(`MemorySqlClient: SQL não suportado: ${sql}`);
    },
  };
}
