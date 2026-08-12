/**
 * data-quality — src/core/rules.ts
 * Avaliação de QualityRule (condition → action).
 */

import type { QualityRule, RuleCondition } from 'contracts';

import type { Row } from './types.js';

export interface RuleViolation {
  ruleId: string;
  rowIndex: number;
  reason: string;
  row: Row;
}

/** Avalia regras row-level. unique é dataset-level (tratado em evaluateDatasetRules). */
export function rowViolates(
  condition: RuleCondition,
  row: Row,
  ctx: { now?: string } = {},
): string | null {
  switch (condition.kind) {
    case 'not_null': {
      const v = row[condition.column];
      if (v === null || v === undefined || v === '') {
        return `${condition.column} is null`;
      }
      return null;
    }
    case 'equals': {
      if (String(row[condition.column]) !== String(condition.value)) {
        return `${condition.column} != ${String(condition.value)}`;
      }
      return null;
    }
    case 'in': {
      const ok = condition.values.some((v) => String(v) === String(row[condition.column]));
      if (!ok) return `${condition.column} not in allowed set`;
      return null;
    }
    case 'regex': {
      const re = new RegExp(condition.pattern);
      if (!re.test(String(row[condition.column] ?? ''))) {
        return `${condition.column} !~ /${condition.pattern}/`;
      }
      return null;
    }
    case 'type': {
      const v = row[condition.column];
      const ok =
        condition.type === 'string'
          ? typeof v === 'string'
          : condition.type === 'number'
            ? typeof v === 'number' && Number.isFinite(v)
            : typeof v === 'boolean';
      if (!ok) return `${condition.column} type != ${condition.type}`;
      return null;
    }
    case 'freshness': {
      const ts = Date.parse(String(row[condition.column] ?? ''));
      const now = Date.parse(condition.now || ctx.now || '');
      if (!Number.isFinite(ts) || !Number.isFinite(now)) {
        return `${condition.column} not a valid timestamp`;
      }
      const age = (now - ts) / 1000;
      if (age > condition.maxAgeSeconds) {
        return `${condition.column} stale age=${age}s`;
      }
      return null;
    }
    case 'unique':
      // handled at dataset level
      return null;
  }
}

export function evaluateDatasetRules(
  rules: readonly QualityRule[],
  datasetId: string,
  rows: readonly Row[],
  ctx: { now?: string } = {},
): RuleViolation[] {
  const applicable = rules.filter(
    (r) => r.active && (r.scope === '*' || r.scope === datasetId),
  );
  const violations: RuleViolation[] = [];

  for (const rule of applicable) {
    if (rule.condition.kind === 'unique') {
      const col = rule.condition.column;
      const seen = new Map<string, number>();
      rows.forEach((row, i) => {
        const key = String(row[col]);
        const first = seen.get(key);
        if (first !== undefined) {
          violations.push({
            ruleId: rule.id,
            rowIndex: i,
            reason: `${col} duplicate of row ${first}`,
            row: { ...row },
          });
        } else {
          seen.set(key, i);
        }
      });
      continue;
    }

    rows.forEach((row, i) => {
      const reason = rowViolates(rule.condition, row, ctx);
      if (reason) {
        violations.push({
          ruleId: rule.id,
          rowIndex: i,
          reason: `${rule.name}: ${reason}`,
          row: { ...row },
        });
      }
    });
  }

  return violations;
}

/** Aplica actions de limpeza (não quarantine) nas rows restantes. */
export function applyCleanActions(
  rules: readonly QualityRule[],
  datasetId: string,
  rows: Row[],
): Row[] {
  const applicable = rules.filter(
    (r) =>
      r.active &&
      (r.scope === '*' || r.scope === datasetId) &&
      r.action.kind !== 'quarantine' &&
      r.action.kind !== 'flag',
  );

  let out = rows.map((r) => ({ ...r }));
  for (const rule of applicable) {
    switch (rule.action.kind) {
      case 'drop': {
        if (rule.condition.kind === 'unique') {
          const col = rule.condition.column;
          const seen = new Set<string>();
          out = out.filter((row) => {
            const key = String(row[col]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        } else {
          out = out.filter((row) => rowViolates(rule.condition, row) === null);
        }
        break;
      }
      case 'replace': {
        const col = String(rule.action.params?.column ?? '');
        const from = rule.action.params?.from;
        const to = rule.action.params?.to;
        out = out.map((row) => {
          if (col && String(row[col]) === String(from)) {
            return { ...row, [col]: to };
          }
          return row;
        });
        break;
      }
      case 'rename_column': {
        const from = String(rule.action.params?.from ?? '');
        const to = String(rule.action.params?.to ?? '');
        if (!from || !to) break;
        out = out.map((row) => {
          if (!Object.prototype.hasOwnProperty.call(row, from)) return row;
          const next = { ...row, [to]: row[from] };
          delete next[from];
          return next;
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
