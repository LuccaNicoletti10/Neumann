/**
 * object-set — src/core/coerce.ts
 * Ontology-guided coercion for filters (HTTP + memory + SQL compiler).
 * Unknown property → 400 (do not silently match nothing).
 */

import type { ObjectSet, ObjectSetFilter, PropertyBaseType, PropertyValue } from 'contracts';
import { NeumannApiError } from 'api-errors';

export type PropertyTypeLookup = (
  objectType: string,
  property: string,
) => PropertyBaseType | undefined;

export type CoerceMode = 'strict' | 'lenient';

export function invalidFilterValue(message: string, parameters: Record<string, unknown> = {}): never {
  throw new NeumannApiError({
    errorCode: 'INVALID_ARGUMENT',
    errorName: 'InvalidFilterValue',
    message,
    parameters,
  });
}

export function coerceValue(v: unknown, bt: PropertyBaseType | undefined): PropertyValue {
  if (v === null || v === undefined) return null;
  switch (bt) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(n)) invalidFilterValue(`not a number: ${String(v)}`);
      return n;
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return invalidFilterValue(`not a boolean: ${String(v)}`);
    }
    case 'datetime': {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) invalidFilterValue(`not a datetime: ${String(v)}`);
      return d.toISOString();
    }
    default:
      return String(v);
  }
}

export function coerceFilter(
  f: ObjectSetFilter,
  objectType: string,
  lookup: PropertyTypeLookup,
  mode: CoerceMode = 'strict',
): ObjectSetFilter {
  switch (f.type) {
    case 'AND':
    case 'OR':
      return {
        type: f.type,
        filters: f.filters.map((x) => coerceFilter(x, objectType, lookup, mode)),
      };
    case 'NOT':
      return { type: 'NOT', filter: coerceFilter(f.filter, objectType, lookup, mode) };
    case 'IS_NULL':
      assertKnownProperty(objectType, f.property, lookup, mode);
      return f;
    case 'CONTAINS':
    case 'STARTS_WITH':
    case 'ENDS_WITH':
      assertKnownProperty(objectType, f.property, lookup, mode);
      return { ...f, value: String(f.value ?? '') };
    case 'IN_SET': {
      const bt = lookup(objectType, f.property);
      assertKnownProperty(objectType, f.property, lookup, mode);
      return {
        type: 'IN_SET',
        property: f.property,
        values: f.values.map((v) => coerceValue(v, bt)),
      };
    }
    default: {
      const bt = lookup(objectType, f.property);
      assertKnownProperty(objectType, f.property, lookup, mode);
      return { ...f, value: coerceValue(f.value, bt) };
    }
  }
}

function assertKnownProperty(
  objectType: string,
  property: string,
  lookup: PropertyTypeLookup,
  mode: CoerceMode,
): void {
  if (mode === 'lenient') return;
  if (lookup(objectType, property) === undefined) {
    invalidFilterValue(`unknown property "${property}" on "${objectType}"`, {
      objectType,
      property,
    });
  }
}

export function baseTypeOf(def: ObjectSet): string {
  switch (def.type) {
    case 'BASE':
    case 'STATIC':
      return def.objectType;
    case 'FILTER':
    case 'SEARCH_AROUND':
      return baseTypeOf(def.objectSet);
    case 'UNION':
    case 'INTERSECT':
      return def.objectSets[0] ? baseTypeOf(def.objectSets[0]) : '';
    case 'SUBTRACT':
      return baseTypeOf(def.objectSets[0]);
    default:
      return '';
  }
}

export function coerceObjectSet(
  def: ObjectSet,
  lookup: PropertyTypeLookup,
  mode: CoerceMode = 'strict',
): ObjectSet {
  switch (def.type) {
    case 'FILTER':
      return {
        type: 'FILTER',
        objectSet: coerceObjectSet(def.objectSet, lookup, mode),
        filter: coerceFilter(def.filter, baseTypeOf(def.objectSet), lookup, mode),
      };
    case 'UNION':
    case 'INTERSECT':
      return {
        type: def.type,
        objectSets: def.objectSets.map((s) => coerceObjectSet(s, lookup, mode)),
      };
    case 'SUBTRACT':
      return {
        type: 'SUBTRACT',
        objectSets: [
          coerceObjectSet(def.objectSets[0], lookup, mode),
          coerceObjectSet(def.objectSets[1], lookup, mode),
        ],
      };
    case 'SEARCH_AROUND':
      return { ...def, objectSet: coerceObjectSet(def.objectSet, lookup, mode) };
    default:
      return def;
  }
}

export function propertyLookupFromTypes(
  types: Record<string, PropertyBaseType | undefined>,
): PropertyTypeLookup {
  return (_objectType, property) => types[property];
}

export function propertyLookupFromOntology(version?: {
  propertyTypes: Record<string, { baseType: PropertyBaseType }>;
}): PropertyTypeLookup {
  return (_objectType, property) => version?.propertyTypes[property]?.baseType;
}
