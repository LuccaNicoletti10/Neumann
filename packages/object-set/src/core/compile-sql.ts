/**
 * object-set — src/core/compile-sql.ts
 * Compiles an ObjectSet AST into a single parameterized SQL query.
 * Filters push down to JSONB predicates; no in-process materialization.
 */

import { createHash } from 'node:crypto';

import type {
  ObjectSet,
  ObjectSetAggregation,
  ObjectSetFilter,
  OntologyId,
  PropertyBaseType,
} from 'contracts';

import { baseTypeOf, invalidFilterValue, type PropertyTypeLookup } from './coerce.js';

export interface SqlFragment {
  text: string;
  params: unknown[];
}

export interface CompileCtx {
  ontologyId: OntologyId;
  propertyTypes: PropertyTypeLookup;
  p: { n: number };
  params: unknown[];
}

export function createCompileCtx(
  ontologyId: OntologyId,
  propertyTypes: PropertyTypeLookup = () => undefined,
): CompileCtx {
  return { ontologyId, propertyTypes, p: { n: 0 }, params: [] };
}

function bind(ctx: CompileCtx, v: unknown): string {
  ctx.params.push(v);
  return `$${++ctx.p.n}`;
}

function likeLiteral(raw: string): string {
  return raw.replace(/[\\%_]/g, '\\$&');
}

/** JSONB property expression with ontology-guided cast. */
export function propExpr(prop: string, baseType: PropertyBaseType | undefined, ctx: CompileCtx): string {
  const raw = `o.properties->>${bind(ctx, prop)}`;
  switch (baseType) {
    case 'number':
      return `(${raw})::numeric`;
    case 'boolean':
      return `(${raw})::boolean`;
    case 'datetime':
      return `(${raw})::timestamptz`;
    default:
      return raw;
  }
}

export function compileFilter(f: ObjectSetFilter, objectType: string, ctx: CompileCtx): string {
  switch (f.type) {
    case 'AND':
      return f.filters.length
        ? `(${f.filters.map((x) => compileFilter(x, objectType, ctx)).join(' AND ')})`
        : 'TRUE';
    case 'OR':
      return f.filters.length
        ? `(${f.filters.map((x) => compileFilter(x, objectType, ctx)).join(' OR ')})`
        : 'FALSE';
    case 'NOT':
      return `(NOT ${compileFilter(f.filter, objectType, ctx)})`;

    case 'EQUALS': {
      const bt = ctx.propertyTypes(objectType, f.property);
      if (f.value === null) {
        // Absent-or-null semantics: ->> yields SQL NULL for both a missing key
        // and a JSON null, matching the memory evaluator and IS_NULL.
        return `(o.properties->>${bind(ctx, f.property)}) IS NULL`;
      }
      if (bt === 'string') {
        // @> fast path (GIN jsonb_path_ops) only when the ontology CONFIRMS
        // the property is a JSON string; against a JSON number, {"n":"5"} @>
        // would silently never match.
        return `o.properties @> jsonb_build_object(${bind(ctx, f.property)}::text, ${bind(ctx, String(f.value))}::text)`;
      }
      if (bt === 'number' || bt === 'boolean' || bt === 'datetime') {
        return `${propExpr(f.property, bt, ctx)} = ${bind(ctx, f.value)}`;
      }
      // Unknown / object_ref / struct: text comparison via ->> is
      // representation-agnostic (JSON number 5 ->> '5' = '5').
      return `(o.properties->>${bind(ctx, f.property)}) = ${bind(ctx, String(f.value))}`;
    }
    case 'NOT_EQUALS': {
      const bt = ctx.propertyTypes(objectType, f.property);
      if (f.value === null) {
        return `(o.properties->>${bind(ctx, f.property)}) IS NOT NULL`;
      }
      if (bt === 'number' || bt === 'boolean' || bt === 'datetime') {
        return `${propExpr(f.property, bt, ctx)} IS DISTINCT FROM ${bind(ctx, f.value)}`;
      }
      return `(o.properties->>${bind(ctx, f.property)}) IS DISTINCT FROM ${bind(ctx, String(f.value))}`;
    }
    case 'CONTAINS':
      return `(o.properties->>${bind(ctx, f.property)}) LIKE '%' || ${bind(ctx, likeLiteral(f.value))} || '%' ESCAPE CHR(92)`;
    case 'STARTS_WITH':
      return `(o.properties->>${bind(ctx, f.property)}) LIKE ${bind(ctx, likeLiteral(f.value))} || '%' ESCAPE CHR(92)`;
    case 'ENDS_WITH':
      return `(o.properties->>${bind(ctx, f.property)}) LIKE '%' || ${bind(ctx, likeLiteral(f.value))} ESCAPE CHR(92)`;
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      // Ordering against null is undefined; strict coercion rejects it with
      // 400 upstream. Compile to FALSE so lenient/direct callers match memory.
      if (f.value === null) return 'FALSE';
      const op = { GT: '>', GTE: '>=', LT: '<', LTE: '<=' }[f.type];
      const bt = ctx.propertyTypes(objectType, f.property);
      return `${propExpr(f.property, bt, ctx)} ${op} ${bind(ctx, f.value)}`;
    }
    case 'IS_NULL':
      return `(o.properties->>${bind(ctx, f.property)}) IS NULL`;
    case 'IN_SET': {
      const bt = ctx.propertyTypes(objectType, f.property);
      const nonNull = f.values.filter((v) => v !== null).map((v) => String(v));
      const hasNull = f.values.length !== nonNull.length;
      const parts: string[] = [];
      if (nonNull.length > 0) {
        const arr = bind(ctx, nonNull);
        parts.push(`${propExpr(f.property, bt, ctx)}::text = ANY(${arr}::text[])`);
      }
      if (hasNull) {
        // `x = ANY(array_with_null)` never matches NULL in SQL; memory's
        // `includes(null)` does. Split the null member into an IS NULL branch.
        parts.push(`(o.properties->>${bind(ctx, f.property)}) IS NULL`);
      }
      if (parts.length === 0) return 'FALSE';
      return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
    }
  }
}

const EMPTY_KEYS = `SELECT NULL::text AS object_type_id, NULL::text AS primary_key WHERE FALSE`;

export function compileObjectSet(def: ObjectSet, ctx: CompileCtx): SqlFragment {
  const base = (objectType: string, extraWhere?: string): string => {
    const w = [
      `o.ontology_id = ${bind(ctx, ctx.ontologyId)}`,
      `o.object_type_id = ${bind(ctx, objectType)}`,
      `o.deleted = false`,
    ];
    if (extraWhere) w.push(extraWhere);
    return `SELECT o.object_type_id, o.primary_key FROM platform_objects o WHERE ${w.join(' AND ')}`;
  };

  switch (def.type) {
    case 'BASE':
      return { text: base(def.objectType), params: ctx.params };

    case 'FILTER': {
      if (def.objectSet.type === 'BASE') {
        const where = compileFilter(def.filter, def.objectSet.objectType, ctx);
        return { text: base(def.objectSet.objectType, where), params: ctx.params };
      }
      const inner = compileObjectSet(def.objectSet, ctx);
      const ot = baseTypeOf(def.objectSet);
      const where = compileFilter(def.filter, ot, ctx);
      return {
        text: `SELECT o.object_type_id, o.primary_key
               FROM platform_objects o
               JOIN (${inner.text}) k
                 ON k.object_type_id = o.object_type_id AND k.primary_key = o.primary_key
               WHERE o.ontology_id = ${bind(ctx, ctx.ontologyId)} AND o.deleted = false AND ${where}`,
        params: ctx.params,
      };
    }

    case 'UNION': {
      if (def.objectSets.length === 0) return { text: EMPTY_KEYS, params: ctx.params };
      return {
        text: def.objectSets.map((s) => `(${compileObjectSet(s, ctx).text})`).join(' UNION '),
        params: ctx.params,
      };
    }
    case 'INTERSECT': {
      if (def.objectSets.length === 0) return { text: EMPTY_KEYS, params: ctx.params };
      return {
        text: def.objectSets.map((s) => `(${compileObjectSet(s, ctx).text})`).join(' INTERSECT '),
        params: ctx.params,
      };
    }
    case 'SUBTRACT': {
      const [l, r] = def.objectSets;
      return {
        text: `(${compileObjectSet(l, ctx).text}) EXCEPT (${compileObjectSet(r, ctx).text})`,
        params: ctx.params,
      };
    }

    case 'STATIC':
      return {
        text: `SELECT o.object_type_id, o.primary_key FROM platform_objects o
               WHERE o.ontology_id = ${bind(ctx, ctx.ontologyId)}
                 AND o.object_type_id = ${bind(ctx, def.objectType)}
                 AND o.deleted = false
                 AND o.primary_key = ANY(${bind(ctx, def.primaryKeys)}::text[])`,
        params: ctx.params,
      };

    case 'SEARCH_AROUND': {
      const src = compileObjectSet(def.objectSet, ctx);
      return {
        text: `SELECT DISTINCT t.object_type_id, t.primary_key
               FROM (${src.text}) s
               JOIN platform_links l
                 ON l.ontology_id = ${bind(ctx, ctx.ontologyId)}
                AND l.link_type_id = ${bind(ctx, def.link)}
                AND l.source_object_type_id = s.object_type_id
                AND l.source_primary_key   = s.primary_key
                AND l.deleted = false
               JOIN platform_objects t
                 ON t.ontology_id = l.ontology_id
                AND t.object_type_id = l.target_object_type_id
                AND t.primary_key    = l.target_primary_key
                AND t.deleted = false`,
        params: ctx.params,
      };
    }
  }
}

export interface CompileLoadOpts {
  pageSize: number;
  after?: { orderValue: string | null; pk: string; nullRegion?: boolean };
  orderBy?: { property: string; direction: 'asc' | 'desc' };
}

export function compileLoad(def: ObjectSet, ctx: CompileCtx, opts: CompileLoadOpts): SqlFragment {
  const keys = compileObjectSet(def, ctx);
  const dir = opts.orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
  const cmpOp = dir === 'DESC' ? '<' : '>';

  const orderExpr = opts.orderBy
    ? propExpr(
        opts.orderBy.property,
        ctx.propertyTypes(baseTypeOf(def), opts.orderBy.property),
        ctx,
      )
    : `o.primary_key`;

  // Keyset over `ORDER BY expr <dir> NULLS LAST, pk <dir>` has two regimes:
  //  1) cursor in the non-null region → advance by tuple, OR jump into nulls
  //     (a plain tuple compare against NULL yields NULL and silently DROPS
  //     every null-ordered row — the data-loss bug this replaces);
  //  2) cursor already in the null region → advance by pk among nulls only.
  let afterClause = '';
  if (opts.after) {
    if (!opts.orderBy) {
      afterClause = `AND o.primary_key ${cmpOp} ${bind(ctx, opts.after.pk)}`;
    } else if (opts.after.nullRegion || opts.after.orderValue === null) {
      afterClause = `AND (${orderExpr} IS NULL AND o.primary_key ${cmpOp} ${bind(ctx, opts.after.pk)})`;
    } else {
      afterClause = `AND ((${orderExpr}, o.primary_key) ${cmpOp} (${bind(ctx, opts.after.orderValue)}, ${bind(ctx, opts.after.pk)}) OR ${orderExpr} IS NULL)`;
    }
  }

  return {
    text: `SELECT o.* FROM platform_objects o
           JOIN (${keys.text}) k
             ON k.object_type_id = o.object_type_id AND k.primary_key = o.primary_key
           WHERE o.ontology_id = ${bind(ctx, ctx.ontologyId)} AND o.deleted = false
           ${afterClause}
           ORDER BY ${orderExpr} ${dir} NULLS LAST, o.primary_key ${dir}
           LIMIT ${bind(ctx, opts.pageSize + 1)}`,
    params: ctx.params,
  };
}

export function compileResolve(def: ObjectSet, ctx: CompileCtx): SqlFragment {
  const keys = compileObjectSet(def, ctx);
  return {
    text: `SELECT o.* FROM platform_objects o
           JOIN (${keys.text}) k
             ON k.object_type_id = o.object_type_id AND k.primary_key = o.primary_key
           WHERE o.ontology_id = ${bind(ctx, ctx.ontologyId)} AND o.deleted = false
           ORDER BY o.object_type_id ASC, o.primary_key ASC`,
    params: ctx.params,
  };
}

export function compileAggregate(
  def: ObjectSet,
  aggregations: ObjectSetAggregation[],
  ctx: CompileCtx,
): SqlFragment {
  const aggObjectType = baseTypeOf(def);
  for (const a of aggregations) {
    if (a.kind !== 'count' && a.property) {
      const bt = ctx.propertyTypes(aggObjectType, a.property);
      if (bt !== undefined && bt !== 'number') {
        invalidFilterValue(
          `aggregation "${a.kind}" requires a number property; "${a.property}" is ${bt}`,
          { property: a.property, baseType: bt },
        );
      }
    }
  }
  const keys = compileObjectSet(def, ctx);
  const selects = aggregations.map((a, i) => {
    const alias = quoteIdent(a.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a.name) ? a.name : `a${i}`);
    switch (a.kind) {
      case 'count':
        return `count(*)::bigint AS ${alias}`;
      case 'sum':
        return a.property
          ? `sum((o.properties->>${bind(ctx, a.property)})::numeric) AS ${alias}`
          : `NULL::numeric AS ${alias}`;
      case 'min':
        return a.property
          ? `min((o.properties->>${bind(ctx, a.property)})::numeric) AS ${alias}`
          : `NULL::numeric AS ${alias}`;
      case 'max':
        return a.property
          ? `max((o.properties->>${bind(ctx, a.property)})::numeric) AS ${alias}`
          : `NULL::numeric AS ${alias}`;
      case 'avg':
        return a.property
          ? `avg((o.properties->>${bind(ctx, a.property)})::numeric) AS ${alias}`
          : `NULL::numeric AS ${alias}`;
    }
  });

  return {
    text: `SELECT ${selects.join(', ')}
           FROM platform_objects o
           JOIN (${keys.text}) k
             ON k.object_type_id = o.object_type_id AND k.primary_key = o.primary_key
           WHERE o.ontology_id = ${bind(ctx, ctx.ontologyId)} AND o.deleted = false`,
    params: ctx.params,
  };
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid aggregation alias: ${name}`);
  }
  return `"${name}"`;
}

export function queryFingerprint(
  sqlText: string,
  params: unknown[],
  orderBy?: CompileLoadOpts['orderBy'],
): string {
  return createHash('sha256')
    .update(sqlText)
    .update('\0')
    // Same AST shape with different filter VALUES compiles to identical text
    // (values live in params) — hash them too, or a page token from
    // `GT n > 4` is silently accepted by `GT n > 6`.
    .update(JSON.stringify(params))
    .update('\0')
    .update(orderBy ? `${orderBy.property}:${orderBy.direction ?? 'asc'}` : 'pk')
    .digest('hex')
    .slice(0, 16);
}
