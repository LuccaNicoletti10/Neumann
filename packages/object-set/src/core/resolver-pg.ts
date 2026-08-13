/**
 * object-set — src/core/resolver-pg.ts
 * PostgreSQL ObjectSet resolver: one parameterized query per AST.
 * Memory resolver remains the conformance oracle (gate:objectset-parity).
 */

import type {
  ObjectRecord,
  ObjectSet,
  ObjectSetAggregateRequest,
  ObjectSetLoadRequest,
  OntologyId,
  SqlClient,
} from 'contracts';
import { invalidArgument } from 'api-errors';
import { clampPageSize, decodePageToken, encodePageToken } from 'pagination';

import type { PropertyTypeLookup } from './coerce.js';
import {
  compileAggregate,
  compileLoad,
  compileResolve,
  createCompileCtx,
  queryFingerprint,
} from './compile-sql.js';

export interface PgObjectSetResolverDeps {
  sql: SqlClient;
  ontologyId: OntologyId;
  propertyTypes?: PropertyTypeLookup;
}

function lookupOf(deps: PgObjectSetResolverDeps): PropertyTypeLookup {
  return deps.propertyTypes ?? (() => undefined);
}

function rowToRecord(row: Record<string, unknown>): ObjectRecord {
  return {
    id: String(row.id),
    ontologyId: String(row.ontology_id),
    ontologyVersionId: row.ontology_version_id ? String(row.ontology_version_id) : undefined,
    objectTypeId: String(row.object_type_id),
    primaryKey: String(row.primary_key),
    properties: (row.properties as Record<string, unknown>) ?? {},
    version: Number(row.version),
    deleted: Boolean(row.deleted),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    source: row.source != null ? String(row.source) : undefined,
    provenance: (row.provenance as Record<string, unknown>) ?? undefined,
  };
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function resolveObjectSetPg(
  def: ObjectSet,
  deps: PgObjectSetResolverDeps,
): Promise<ObjectRecord[]> {
  const ctx = createCompileCtx(deps.ontologyId, lookupOf(deps));
  const q = compileResolve(def, ctx);
  const result = await deps.sql.query(q.text, q.params);
  return (result.rows as Record<string, unknown>[]).map(rowToRecord);
}

export async function loadObjectsPg(
  req: ObjectSetLoadRequest,
  deps: PgObjectSetResolverDeps,
): Promise<{ data: ObjectRecord[]; nextPageToken?: string }> {
  const pageSize = clampPageSize(req.pageSize);
  const orderBy = req.orderBy?.[0]
    ? {
        property: req.orderBy[0].property,
        direction: (req.orderBy[0].direction === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      }
    : undefined;

  const fingerprintCtx = createCompileCtx(deps.ontologyId, lookupOf(deps));
  const keysOnly = compileResolve(req.objectSet, fingerprintCtx);
  const hash = queryFingerprint(keysOnly.text, fingerprintCtx.params, orderBy);

  let after: { orderValue: string | null; pk: string; nullRegion?: boolean } | undefined;
  if (req.pageToken) {
    const cursor = decodePageToken(req.pageToken);
    if (cursor.h && cursor.h !== hash) {
      throw invalidArgument('page token does not match this query');
    }
    if (typeof cursor.k === 'string') {
      after = {
        orderValue: cursor.o === undefined ? null : cursor.o,
        pk: cursor.k,
        nullRegion: cursor.nr === 1,
      };
    }
  }

  const ctx = createCompileCtx(deps.ontologyId, lookupOf(deps));
  const q = compileLoad(req.objectSet, ctx, { pageSize, after, orderBy });
  const result = await deps.sql.query(q.text, q.params);
  const rows = (result.rows as Record<string, unknown>[]).map(rowToRecord);
  const hasNext = rows.length > pageSize;
  const page = hasNext ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  const lastInNullRegion =
    orderBy != null && last != null && last.properties[orderBy.property] == null;
  const lastOrder =
    orderBy && last
      ? lastInNullRegion
        ? null
        : String(last.properties[orderBy.property])
      : last
        ? last.primaryKey
        : null;

  return {
    data: page,
    nextPageToken:
      hasNext && last
        ? encodePageToken({
            offset: 0,
            lastId: last.id,
            o: lastOrder,
            k: last.primaryKey,
            h: hash,
            ...(lastInNullRegion ? { nr: 1 } : {}),
          })
        : undefined,
  };
}

export async function aggregateObjectsPg(
  req: ObjectSetAggregateRequest,
  deps: PgObjectSetResolverDeps,
): Promise<Record<string, number | null>> {
  const ctx = createCompileCtx(deps.ontologyId, lookupOf(deps));
  const named = req.aggregations.map((a, i) => {
    const name = a.name ?? `${a.kind}${a.property ? `_${a.property}` : ''}`;
    const sqlAlias = `a${i}`;
    return { ...a, name, sqlAlias };
  });
  const q = compileAggregate(
    req.objectSet,
    named.map((a) => ({ ...a, name: a.sqlAlias })),
    ctx,
  );
  const result = await deps.sql.query(q.text, q.params);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const out: Record<string, number | null> = {};
  for (const a of named) {
    out[a.name] = a.kind === 'count' ? Number(row[a.sqlAlias] ?? 0) : num(row[a.sqlAlias]);
  }
  return out;
}

export function createPgObjectSetResolver(deps: PgObjectSetResolverDeps) {
  return {
    resolve: (def: ObjectSet) => resolveObjectSetPg(def, deps),
    load: (req: ObjectSetLoadRequest) => loadObjectsPg(req, deps),
    aggregate: (req: ObjectSetAggregateRequest) => aggregateObjectsPg(req, deps),
  };
}
