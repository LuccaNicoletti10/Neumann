/**
 * contracts — src/v1/object-set.ts
 * ObjectSet algebra (Foundry-inspired; adapted from OpenFoundry Apache-2.0 shapes).
 *
 * Supported ops for milestone 1:
 * BASE | FILTER | UNION | INTERSECT | SUBTRACT | STATIC | SEARCH_AROUND
 */

import type { LinkTypeId, ObjectTypeId, PropertyTypeId } from './ontology.js';

export type ObjectSetOp =
  | 'BASE'
  | 'FILTER'
  | 'UNION'
  | 'INTERSECT'
  | 'SUBTRACT'
  | 'STATIC'
  | 'SEARCH_AROUND';

export type PropertyValue = string | number | boolean | null;

/** Filter subset used by ObjectSet FILTER (kernel — no business rules). */
export type ObjectSetFilter =
  | { type: 'AND'; filters: ObjectSetFilter[] }
  | { type: 'OR'; filters: ObjectSetFilter[] }
  | { type: 'NOT'; filter: ObjectSetFilter }
  | { type: 'EQUALS'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'NOT_EQUALS'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'CONTAINS'; property: PropertyTypeId | string; value: string }
  | { type: 'STARTS_WITH'; property: PropertyTypeId | string; value: string }
  | { type: 'ENDS_WITH'; property: PropertyTypeId | string; value: string }
  | { type: 'GT'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'GTE'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'LT'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'LTE'; property: PropertyTypeId | string; value: PropertyValue }
  | { type: 'IS_NULL'; property: PropertyTypeId | string }
  | { type: 'IN_SET'; property: PropertyTypeId | string; values: PropertyValue[] };

export interface BaseObjectSet {
  type: 'BASE';
  objectType: ObjectTypeId | string;
}

export interface FilterObjectSet {
  type: 'FILTER';
  objectSet: ObjectSet;
  filter: ObjectSetFilter;
}

export interface UnionObjectSet {
  type: 'UNION';
  objectSets: ObjectSet[];
}

export interface IntersectObjectSet {
  type: 'INTERSECT';
  objectSets: ObjectSet[];
}

export interface SubtractObjectSet {
  type: 'SUBTRACT';
  /** [left, right] — left \ right */
  objectSets: [ObjectSet, ObjectSet];
}

export interface StaticObjectSet {
  type: 'STATIC';
  objectType: ObjectTypeId | string;
  primaryKeys: string[];
}

export interface SearchAroundObjectSet {
  type: 'SEARCH_AROUND';
  objectSet: ObjectSet;
  link: LinkTypeId | string;
}

export type ObjectSet =
  | BaseObjectSet
  | FilterObjectSet
  | UnionObjectSet
  | IntersectObjectSet
  | SubtractObjectSet
  | StaticObjectSet
  | SearchAroundObjectSet;

export type AggregationKind = 'count' | 'sum' | 'min' | 'max' | 'avg';

export interface ObjectSetAggregation {
  kind: AggregationKind;
  /** Required for sum/min/max/avg. */
  property?: PropertyTypeId | string;
  name?: string;
}

export interface ObjectSetLoadRequest {
  objectSet: ObjectSet;
  orderBy?: { property: string; direction?: 'asc' | 'desc' }[];
  pageSize?: number;
  pageToken?: string;
}

export interface ObjectSetAggregateRequest {
  objectSet: ObjectSet;
  aggregations: ObjectSetAggregation[];
}
