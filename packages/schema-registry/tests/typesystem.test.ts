/**
 * schema-registry — tests/typesystem.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  isNarrowing,
  isWidening,
  normalizePhysicalType,
} from '../src/core/typesystem.js';

describe('typesystem', () => {
  it('normalizePhysicalType cobre aliases comuns', () => {
    expect(normalizePhysicalType('int64')).toBe('bigint');
    expect(normalizePhysicalType('float64')).toBe('float');
    expect(normalizePhysicalType('varchar')).toBe('string');
    expect(normalizePhysicalType('timestamptz')).toBe('datetime');
    expect(normalizePhysicalType('object')).toBe('string');
    expect(normalizePhysicalType('xyz')).toBe('unknown');
  });

  it('widening numérico e temporal', () => {
    expect(isWidening('integer', 'float')).toBe(true);
    expect(isWidening('integer', 'decimal')).toBe(true);
    expect(isWidening('boolean', 'integer')).toBe(true);
    expect(isWidening('date', 'datetime')).toBe(true);
    expect(isWidening('integer', 'string')).toBe(true);
    expect(isWidening('float', 'integer')).toBe(false);
  });

  it('narrowing é o inverso do widening', () => {
    expect(isNarrowing('float', 'integer')).toBe(true);
    expect(isNarrowing('string', 'integer')).toBe(true);
    expect(isNarrowing('integer', 'float')).toBe(false);
  });
});
