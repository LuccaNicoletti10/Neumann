/**
 * function-registry — src/core/builtins.ts
 * Kernel functions: scoreRecord, aggregateMetrics, deriveFlags.
 * Domínio-neutro — não são app de negócio.
 */

import type { FunctionImpl, FunctionObjectInput } from 'contracts';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function numericValues(obj: FunctionObjectInput): number[] {
  return Object.values(obj.properties).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
}

/** Completude das properties + magnitude numérica (tanh). Determinístico. */
export const scoreRecord: FunctionImpl = (objects) => {
  const scores = objects.map((o) => {
    const values = Object.values(o.properties);
    const filled = values.filter((v) => v != null && v !== '').length;
    const completeness = values.length === 0 ? 0 : filled / values.length;
    const nums = numericValues(o);
    const magnitude =
      nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
    const score = round4(0.7 * completeness + 0.3 * Math.tanh(Math.abs(magnitude) / 100));
    return {
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
      score,
      features: { completeness: round4(completeness), magnitude: round4(magnitude) },
    };
  });
  return { scores };
};

/** Agrega uma property numérica: count/sum/avg/min/max. */
export const aggregateMetrics: FunctionImpl = (objects, params) => {
  const property = String(params?.property ?? 'value');
  const nums: number[] = [];
  for (const o of objects) {
    const v = o.properties[property];
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
  }
  const count = objects.length;
  const numericCount = nums.length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = numericCount === 0 ? 0 : sum / numericCount;
  const min = numericCount === 0 ? 0 : Math.min(...nums);
  const max = numericCount === 0 ? 0 : Math.max(...nums);
  return {
    property,
    count,
    numericCount,
    sum: round4(sum),
    avg: round4(avg),
    min,
    max,
  };
};

/** Flags booleanas por objeto (vazio / numérico / acima do limiar). */
export const deriveFlags: FunctionImpl = (objects, params) => {
  const threshold = Number(params?.threshold ?? 0);
  const flags = objects.map((o) => {
    const values = Object.values(o.properties);
    const nums = numericValues(o);
    return {
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
      empty: values.length === 0 || values.every((v) => v == null || v === ''),
      hasNumeric: nums.length > 0,
      aboveThreshold: nums.some((n) => n > threshold),
    };
  });
  return { flags };
};
