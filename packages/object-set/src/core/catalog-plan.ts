/**
 * object-set — catalog access-plan contract.
 *
 * Correctness of catalog search is the planned access method (GIN), not
 * wall-clock. Callers assert on CatalogPlanInspection; EXPLAIN JSON stays here.
 */
import type { SqlClient } from 'contracts';

export const CATALOG_RELATION = 'platform_objects';

export interface RelationIndex {
  name: string;
  accessMethod: string;
}

export interface CatalogPlanInspection {
  /** Index names referenced by any plan node (Bitmap Index Scan / Index Scan). */
  indexNames: string[];
  /** True when a Seq Scan is the access method for the catalog relation. */
  sequentialScan: boolean;
  nodeTypes: string[];
}

export interface CatalogPlanVerdict {
  usedGin: boolean;
  usedIndex: boolean;
  ginIndexesUsed: string[];
  otherIndexesUsed: string[];
  sequentialScan: boolean;
}

type PlanNode = {
  nodeType: string;
  indexName: string | undefined;
  relationName: string | undefined;
  children: PlanNode[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parsePlanNode(value: unknown): PlanNode | undefined {
  if (!isRecord(value)) return undefined;
  const nodeType = asString(value['Node Type']);
  if (nodeType === undefined) return undefined;
  const rawChildren = value.Plans;
  const children: PlanNode[] = [];
  if (Array.isArray(rawChildren)) {
    for (const child of rawChildren) {
      const parsed = parsePlanNode(child);
      if (parsed) children.push(parsed);
    }
  }
  return {
    nodeType,
    indexName: asString(value['Index Name']),
    relationName: asString(value['Relation Name']),
    children,
  };
}

/**
 * pg serializes EXPLAIN (FORMAT JSON) as `[{ Plan: {...} }]` or a string of that.
 */
export function parseExplainJson(raw: unknown): PlanNode {
  let value = raw;
  if (typeof value === 'string') {
    value = JSON.parse(value) as unknown;
  }
  if (Array.isArray(value) && value[0] !== undefined) {
    value = value[0];
  }
  if (isRecord(value) && value.Plan !== undefined) {
    const root = parsePlanNode(value.Plan);
    if (root) return root;
  }
  const direct = parsePlanNode(value);
  if (direct) return direct;
  throw new Error('EXPLAIN JSON did not contain a Plan node');
}

function walk(node: PlanNode, acc: CatalogPlanInspection): void {
  acc.nodeTypes.push(node.nodeType);
  if (node.indexName !== undefined) {
    acc.indexNames.push(node.indexName);
  }
  if (
    node.nodeType === 'Seq Scan' &&
    (node.relationName === CATALOG_RELATION || node.relationName === undefined)
  ) {
    acc.sequentialScan = true;
  }
  for (const child of node.children) walk(child, acc);
}

export function inspectCatalogPlan(explainJson: unknown): CatalogPlanInspection {
  const root = parseExplainJson(explainJson);
  const acc: CatalogPlanInspection = {
    indexNames: [],
    sequentialScan: false,
    nodeTypes: [],
  };
  walk(root, acc);
  return acc;
}

export function verdictForCatalogPlan(
  inspection: CatalogPlanInspection,
  indexes: readonly RelationIndex[],
): CatalogPlanVerdict {
  const gin = new Set(
    indexes.filter((idx) => idx.accessMethod === 'gin').map((idx) => idx.name),
  );
  const ginIndexesUsed = inspection.indexNames.filter((name) => gin.has(name));
  const otherIndexesUsed = inspection.indexNames.filter((name) => !gin.has(name));
  return {
    usedGin: ginIndexesUsed.length > 0,
    usedIndex: inspection.indexNames.length > 0,
    ginIndexesUsed,
    otherIndexesUsed,
    sequentialScan: inspection.sequentialScan && ginIndexesUsed.length === 0,
  };
}

export async function listRelationIndexes(
  sql: SqlClient,
  relation: string,
): Promise<RelationIndex[]> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation)) {
    throw new Error(`invalid relation name: ${relation}`);
  }
  const result = await sql.query<{ name: string; access_method: string }>(
    `SELECT indexrel.relname AS name, am.amname AS access_method
     FROM pg_index ix
     JOIN pg_class rel ON rel.oid = ix.indrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     JOIN pg_class indexrel ON indexrel.oid = ix.indexrelid
     JOIN pg_am am ON am.oid = indexrel.relam
     WHERE rel.relname = $1
       AND nsp.nspname = current_schema()`,
    [relation],
  );
  return result.rows.map((row) => ({
    name: row.name,
    accessMethod: row.access_method,
  }));
}

export async function explainCatalogQuery(
  sql: SqlClient,
  query: { text: string; params?: unknown[] },
): Promise<unknown> {
  const result = await sql.query<Record<string, unknown>>(
    `EXPLAIN (FORMAT JSON) ${query.text}`,
    query.params,
  );
  const first = result.rows[0];
  if (first === undefined) {
    throw new Error('EXPLAIN returned no rows');
  }
  const plan = first['QUERY PLAN'] ?? Object.values(first)[0];
  return plan;
}

export async function inspectExplainedCatalogQuery(
  sql: SqlClient,
  query: { text: string; params?: unknown[] },
  indexes: readonly RelationIndex[],
): Promise<CatalogPlanVerdict> {
  const raw = await explainCatalogQuery(sql, query);
  return verdictForCatalogPlan(inspectCatalogPlan(raw), indexes);
}
