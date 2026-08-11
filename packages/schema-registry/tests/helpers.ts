/**
 * schema-registry — tests/helpers.ts
 */
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createSchemaRegistry } from '../src/core/registry.js';
import type { SchemaRegistry } from '../src/core/registry.js';
import type { ObservedColumn, ObservedSchema } from '../src/core/types.js';

export function makeRegistry(): SchemaRegistry {
  return createSchemaRegistry({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

export function peopleSchema(extra: ObservedColumn[] = []): ObservedSchema {
  return {
    source: 'crm',
    object: 'people',
    columns: [
      {
        column: 'id',
        physicalType: 'integer',
        nullable: false,
        isPrimaryKey: true,
        sampleValues: ['1', '2'],
      },
      {
        column: 'name',
        physicalType: 'string',
        nullable: false,
        sampleValues: ['Ada'],
      },
      {
        column: 'age',
        physicalType: 'integer',
        nullable: true,
        sampleValues: ['36'],
      },
      ...extra,
    ],
  };
}
