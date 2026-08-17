/**
 * object-set — src/core/search-sql.ts
 * Full-text catalog search. Separate from ObjectSet compile-sql.
 */

import { urnOf } from 'contracts';

export interface CatalogSearchParams {
  ontologyId?: string;
  q: string;
  limit?: number;
}

export function compileCatalogSearch(opts: CatalogSearchParams): { text: string; params: unknown[] } {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const params: unknown[] = [`%${opts.q}%`, opts.q, limit];
  const ontologyClause = opts.ontologyId
    ? (params.push(opts.ontologyId), `AND o.ontology_id = $4`)
    : '';
  return {
    text: `SELECT o.ontology_id, o.object_type_id, o.primary_key, o.properties
           FROM platform_objects o
           WHERE o.deleted = false
             ${ontologyClause}
             AND (
               o.primary_key ILIKE $1
               OR to_tsvector('simple', o.properties::text) @@ plainto_tsquery('simple', $2)
             )
           ORDER BY o.object_type_id, o.primary_key
           LIMIT $3`,
    params,
  };
}

export function catalogHitUrn(row: {
  ontology_id: string;
  object_type_id: string;
  primary_key: string;
}): string {
  return urnOf(row.ontology_id, row.object_type_id, row.primary_key);
}
