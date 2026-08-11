/**
 * schema-registry — tests/drift.test.ts
 * Gate T1.4: add/remove/alter → classification correta.
 */
import { describe, expect, it } from 'vitest';

import { classifyDrift, diffColumns } from '../src/core/drift.js';
import type { ColumnSchema, ObjectSchema } from '../src/core/types.js';
import { peopleSchema } from './helpers.js';

function registeredFrom(observed = peopleSchema()): ObjectSchema {
  const at = '2024-01-01T00:00:00.000Z';
  return {
    source: observed.source,
    object: observed.object,
    schemaVersion: 1,
    paused: false,
    updatedAt: at,
    columns: observed.columns.map(
      (c): ColumnSchema => ({
        column: c.column,
        physicalType: c.physicalType,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey ?? false,
        foreignKeys: [...(c.foreignKeys ?? [])],
        observedValuesSample: [...(c.sampleValues ?? [])],
        firstSeen: at,
        lastSeen: at,
        ...(c.semanticHint !== undefined ? { semanticHint: c.semanticHint } : {}),
      }),
    ),
  };
}

describe('classificador de drift (T1.4)', () => {
  it('sem mudanças → compatible/accept', () => {
    const reg = registeredFrom();
    const report = classifyDrift(reg, peopleSchema());
    expect(report.kind).toBe('compatible');
    expect(report.action).toBe('accept');
  });

  it('adicionar coluna nullable → compatible', () => {
    const reg = registeredFrom();
    const observed = peopleSchema([
      { column: 'city', physicalType: 'string', nullable: true },
    ]);
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('compatible');
    expect(report.action).toBe('accept');
    expect(report.changes.some((c) => c.kind === 'added' && c.column === 'city')).toBe(true);
  });

  it('adicionar coluna NÃO-nullable → breaking', () => {
    const reg = registeredFrom();
    const observed = peopleSchema([
      { column: 'ssn', physicalType: 'string', nullable: false },
    ]);
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('breaking');
    expect(report.action).toBe('pause_and_alert');
  });

  it('remover coluna → breaking', () => {
    const reg = registeredFrom();
    const observed = {
      ...peopleSchema(),
      columns: peopleSchema().columns.filter((c) => c.column !== 'age'),
    };
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('breaking');
    expect(report.action).toBe('pause_and_alert');
    expect(report.changes.some((c) => c.kind === 'removed' && c.column === 'age')).toBe(true);
  });

  it('widening integer→float → coercible + cast', () => {
    const reg = registeredFrom();
    const observed = {
      ...peopleSchema(),
      columns: peopleSchema().columns.map((c) =>
        c.column === 'age' ? { ...c, physicalType: 'float' as const } : c,
      ),
    };
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('coercible');
    expect(report.action).toBe('accept_with_cast');
    expect(report.casts).toEqual([{ column: 'age', fromType: 'integer', toType: 'float' }]);
  });

  it('narrowing float→integer → breaking', () => {
    const base = peopleSchema();
    const withFloat = {
      ...base,
      columns: base.columns.map((c) =>
        c.column === 'age' ? { ...c, physicalType: 'float' as const } : c,
      ),
    };
    const reg = registeredFrom(withFloat);
    const observed = peopleSchema();
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('breaking');
    expect(report.action).toBe('pause_and_alert');
  });

  it('tipo incompatível (integer→date) → unknown', () => {
    const reg = registeredFrom();
    // integer↔date: nem widening nem narrowing reconhecido.
    const observed = {
      ...peopleSchema(),
      columns: peopleSchema().columns.map((c) =>
        c.column === 'age' ? { ...c, physicalType: 'date' as const } : c,
      ),
    };
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('unknown');
    expect(report.action).toBe('pause_and_alert');
  });

  it('nullability tightened (nullable→required) → breaking', () => {
    const reg = registeredFrom();
    const observed = {
      ...peopleSchema(),
      columns: peopleSchema().columns.map((c) =>
        c.column === 'age' ? { ...c, nullable: false } : c,
      ),
    };
    const report = classifyDrift(reg, observed);
    expect(report.kind).toBe('breaking');
  });

  it('nullability relaxed → compatible', () => {
    const base = peopleSchema();
    const requiredAge = {
      ...base,
      columns: base.columns.map((c) =>
        c.column === 'age' ? { ...c, nullable: false } : c,
      ),
    };
    const reg = registeredFrom(requiredAge);
    const report = classifyDrift(reg, peopleSchema());
    expect(report.kind).toBe('compatible');
  });

  it('diffColumns é determinístico (ordem alfabética)', () => {
    const reg = registeredFrom();
    const observed = peopleSchema([
      { column: 'zz', physicalType: 'string', nullable: true },
      { column: 'aa', physicalType: 'string', nullable: true },
    ]);
    const a = diffColumns(reg.columns, observed.columns);
    const b = diffColumns(reg.columns, observed.columns);
    expect(a).toEqual(b);
    const added = a.filter((c) => c.kind === 'added').map((c) => c.column);
    expect(added).toEqual(['aa', 'zz']);
  });
});
