/**
 * object-set — src/core/resolver.ts
 * Recursive ObjectSet resolution.
 *
 * Algebra adapted from OpenFoundry svc-objects object-sets (Apache-2.0);
 * reimplemented against Neumann ObjectRepository / LinkRepository.
 */

import type {
  LinkRepository,
  ObjectRecord,
  ObjectRepository,
  ObjectSet,
  ObjectSetAggregateRequest,
  ObjectSetAggregation,
  ObjectSetLoadRequest,
  OntologyId,
} from 'contracts';
import { encodePageToken, decodePageToken, clampPageSize } from 'pagination';

import { baseTypeOf, coerceValue, invalidFilterValue, type PropertyTypeLookup } from './coerce.js';
import { evaluateFilter } from './filter.js';

export interface ObjectSetResolverDeps {
  ontologyId: OntologyId;
  objects: ObjectRepository;
  links: LinkRepository;
  propertyTypes?: PropertyTypeLookup;
}

async function asArray<T>(v: T[] | Promise<T[]>): Promise<T[]> {
  return await v;
}

async function asMaybe<T>(v: T | Promise<T>): Promise<T> {
  return await v;
}

function objectKey(obj: ObjectRecord): string {
  return `${obj.objectTypeId}::${obj.primaryKey}`;
}

export async function resolveObjectSet(
  def: ObjectSet,
  deps: ObjectSetResolverDeps,
): Promise<ObjectRecord[]> {
  const { ontologyId, objects, links } = deps;

  switch (def.type) {
    case 'BASE':
      return asArray(objects.list(ontologyId, def.objectType));

    case 'FILTER': {
      const source = await resolveObjectSet(def.objectSet, deps);
      return source.filter((obj) => evaluateFilter(obj, def.filter, deps.propertyTypes));
    }

    case 'UNION': {
      const seen = new Set<string>();
      const out: ObjectRecord[] = [];
      for (const child of def.objectSets) {
        for (const obj of await resolveObjectSet(child, deps)) {
          const k = objectKey(obj);
          if (!seen.has(k)) {
            seen.add(k);
            out.push(obj);
          }
        }
      }
      return out;
    }

    case 'INTERSECT': {
      if (def.objectSets.length === 0) return [];
      const resolved = await Promise.all(
        def.objectSets.map((s) => resolveObjectSet(s, deps)),
      );
      const keySets = resolved.map((s) => new Set(s.map(objectKey)));
      const first = resolved[0]!;
      return first.filter((obj) => keySets.every((ks) => ks.has(objectKey(obj))));
    }

    case 'SUBTRACT': {
      const [leftDef, rightDef] = def.objectSets;
      const left = await resolveObjectSet(leftDef, deps);
      const rightKeys = new Set(
        (await resolveObjectSet(rightDef, deps)).map(objectKey),
      );
      return left.filter((obj) => !rightKeys.has(objectKey(obj)));
    }

    case 'STATIC': {
      const out: ObjectRecord[] = [];
      for (const pk of def.primaryKeys) {
        const obj = await asMaybe(objects.get(ontologyId, def.objectType, pk));
        if (obj) out.push(obj);
      }
      return out;
    }

    case 'SEARCH_AROUND': {
      const source = await resolveObjectSet(def.objectSet, deps);
      const seen = new Set<string>();
      const out: ObjectRecord[] = [];
      for (const src of source) {
        const edges = await asArray(
          links.listFrom(ontologyId, src.objectTypeId, src.primaryKey, def.link),
        );
        for (const edge of edges) {
          const target = await asMaybe(
            objects.get(ontologyId, edge.targetObjectTypeId, edge.targetPrimaryKey),
          );
          if (!target) continue;
          const k = objectKey(target);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(target);
        }
      }
      return out;
    }

    default:
      return [];
  }
}

export async function loadObjects(
  req: ObjectSetLoadRequest,
  deps: ObjectSetResolverDeps,
): Promise<{ data: ObjectRecord[]; nextPageToken?: string }> {
  let data = await resolveObjectSet(req.objectSet, deps);

  if (req.orderBy?.length) {
    // Match PG: `ORDER BY expr <dir> NULLS LAST, primary_key <dir>`.
    // The pk pre-sort + stable clause sorts make pk the final tiebreaker.
    const primaryDir = req.orderBy[0]!.direction === 'desc' ? -1 : 1;
    data = [...data].sort((a, b) =>
      a.primaryKey === b.primaryKey ? 0 : (a.primaryKey < b.primaryKey ? -1 : 1) * primaryDir,
    );
    for (let i = req.orderBy.length - 1; i >= 0; i -= 1) {
      const clause = req.orderBy[i]!;
      const dir = clause.direction === 'desc' ? -1 : 1;
      const bt = deps.propertyTypes?.(baseTypeOf(req.objectSet), clause.property);
      const orderVal = (v: unknown): unknown => {
        if (v == null) return null;
        try {
          return coerceValue(v, bt);
        } catch {
          return v;
        }
      };
      data = [...data].sort((a, b) => {
        const av = orderVal(a.properties[clause.property]);
        const bv = orderVal(b.properties[clause.property]);
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // NULLS LAST regardless of direction
        if (bv == null) return -1;
        if (av === bv) return 0;
        return ((av as never) < (bv as never) ? -1 : 1) * dir;
      });
    }
  }

  const pageSize = clampPageSize(req.pageSize);
  const offset = req.pageToken ? decodePageToken(req.pageToken).offset : 0;
  const page = data.slice(offset, offset + pageSize);
  const next = offset + pageSize;
  return {
    data: page,
    nextPageToken:
      next < data.length
        ? encodePageToken({
            offset: next,
            lastId: page[page.length - 1]?.id,
          })
        : undefined,
  };
}

function aggregateValue(objs: ObjectRecord[], agg: ObjectSetAggregation): number | null {
  if (agg.kind === 'count') return objs.length;
  if (!agg.property) return null;
  const nums = objs
    .map((o) => o.properties[agg.property!])
    .filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  if (agg.kind === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (agg.kind === 'min') return Math.min(...nums);
  if (agg.kind === 'max') return Math.max(...nums);
  if (agg.kind === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  return null;
}

export function aggregateRecords(
  objs: ObjectRecord[],
  aggregations: ObjectSetAggregation[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const agg of aggregations) {
    const name = agg.name ?? `${agg.kind}${agg.property ? `_${agg.property}` : ''}`;
    out[name] = aggregateValue(objs, agg);
  }
  return out;
}

export async function aggregateObjects(
  req: ObjectSetAggregateRequest,
  deps: ObjectSetResolverDeps,
): Promise<Record<string, number | null>> {
  if (deps.propertyTypes) {
    const ot = baseTypeOf(req.objectSet);
    for (const a of req.aggregations) {
      if (a.kind !== 'count' && a.property) {
        const bt = deps.propertyTypes(ot, a.property);
        if (bt !== undefined && bt !== 'number') {
          invalidFilterValue(
            `aggregation "${a.kind}" requires a number property; "${a.property}" is ${bt}`,
            { property: a.property, baseType: bt },
          );
        }
      }
    }
  }
  const objs = await resolveObjectSet(req.objectSet, deps);
  return aggregateRecords(objs, req.aggregations);
}
