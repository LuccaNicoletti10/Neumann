/**
 * schema-registry — tests/registry.test.ts
 */
import { describe, expect, it } from 'vitest';

import { CoreError } from '../src/core/types.js';
import { makeRegistry, peopleSchema } from './helpers.js';

describe('schema registry', () => {
  it('register cria versão 1 com first_seen/last_seen', () => {
    const registry = makeRegistry();
    const { schema, created } = registry.register(peopleSchema());
    expect(created).toBe(true);
    expect(schema.schemaVersion).toBe(1);
    expect(schema.columns.every((c) => c.firstSeen === '2024-01-01T00:00:00.000Z')).toBe(true);
    expect(schema.columns.find((c) => c.column === 'id')?.isPrimaryKey).toBe(true);
  });

  it('observe compatible bumpa schema_version e aceita', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    const result = registry.observe(
      peopleSchema([{ column: 'city', physicalType: 'string', nullable: true }]),
    );
    expect(result.report.kind).toBe('compatible');
    expect(result.schema.schemaVersion).toBe(2);
    expect(result.schema.columns.map((c) => c.column)).toContain('city');
    expect(result.alert).toBeUndefined();
  });

  it('observe coercible registra cast e bumpa versão', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    registry.observe(peopleSchema([{ column: 'city', physicalType: 'string', nullable: true }]));
    const result = registry.observe({
      ...peopleSchema([{ column: 'city', physicalType: 'string', nullable: true }]),
      columns: peopleSchema([{ column: 'city', physicalType: 'string', nullable: true }]).columns.map(
        (c) => (c.column === 'age' ? { ...c, physicalType: 'float' as const } : c),
      ),
    });
    expect(result.report.kind).toBe('coercible');
    expect(result.schema.schemaVersion).toBe(3);
    expect(registry.listCasts('crm', 'people')).toEqual([
      { column: 'age', fromType: 'integer', toType: 'float' },
    ]);
  });

  it('observe breaking pausa a fonte e abre alerta', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    const result = registry.observe({
      ...peopleSchema(),
      columns: peopleSchema().columns.filter((c) => c.column !== 'name'),
    });
    expect(result.report.kind).toBe('breaking');
    expect(result.schema.paused).toBe(true);
    expect(result.alert?.id).toBe('alert-1');
    expect(registry.isPaused('crm', 'people')).toBe(true);
    expect(registry.listAlerts({ acknowledged: false })).toHaveLength(1);
  });

  it('observe em fonte pausada falha com SOURCE_PAUSED', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    registry.observe({
      ...peopleSchema(),
      columns: peopleSchema().columns.filter((c) => c.column !== 'age'),
    });
    expect(() => registry.observe(peopleSchema())).toThrow(CoreError);
    try {
      registry.observe(peopleSchema());
    } catch (e) {
      expect((e as CoreError).code).toBe('SOURCE_PAUSED');
    }
  });

  it('resume reativa a fonte; acknowledge marca alerta', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    const { alert } = registry.observe({
      ...peopleSchema(),
      columns: peopleSchema().columns.filter((c) => c.column !== 'age'),
    });
    const resumed = registry.resume('crm', 'people');
    expect(resumed.paused).toBe(false);
    expect(registry.acknowledgeAlert(alert!.id).acknowledged).toBe(true);
    expect(registry.listAlerts({ acknowledged: false })).toHaveLength(0);
  });

  it('get/list e cópias defensivas', () => {
    const registry = makeRegistry();
    registry.register(peopleSchema());
    const got = registry.get('crm', 'people');
    got!.columns[0]!.column = 'hacked';
    expect(registry.get('crm', 'people')?.columns[0]?.column).toBe('age');
    // sorted: age, id, name
    expect(registry.list('crm')).toHaveLength(1);
  });

  it('register rejeita schema vazio', () => {
    const registry = makeRegistry();
    expect(() =>
      registry.register({ source: 's', object: 'o', columns: [] }),
    ).toThrow(/ao menos uma coluna/);
  });
});
