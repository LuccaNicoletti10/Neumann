/**
 * contracts — src/v1/data-quality.ts
 * Data quality + rules + quarantine (Passo 13). Shape congelado.
 */

export type QualityDimension =
  | 'completeness'
  | 'uniqueness'
  | 'validity'
  | 'consistency'
  | 'freshness'
  | 'drift';

export type RuleSeverity = 'info' | 'warn' | 'error' | 'quarantine';

export type RuleActionKind =
  | 'quarantine'
  | 'drop'
  | 'replace'
  | 'rename_column'
  | 'flag';

/** Regra: condition / severity / action / scope / version / owner. */
export interface QualityRule {
  id: string;
  name: string;
  /** Expressão simples: column op value | not_null | unique | regex | type */
  condition: RuleCondition;
  severity: RuleSeverity;
  action: {
    kind: RuleActionKind;
    params?: Record<string, unknown>;
  };
  /** Dataset id ou '*' */
  scope: string;
  version: number;
  owner: string;
  active: boolean;
}

export type RuleCondition =
  | { kind: 'not_null'; column: string }
  | { kind: 'unique'; column: string }
  | { kind: 'equals'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'regex'; column: string; pattern: string }
  | { kind: 'type'; column: string; type: 'string' | 'number' | 'boolean' }
  | { kind: 'freshness'; column: string; maxAgeSeconds: number; now: string };

export interface QualityScore {
  dimension: QualityDimension;
  /** 0..1 */
  score: number;
  detail?: string;
}

export interface QualityReport {
  datasetId: string;
  datasetVersion: number;
  scoredAt: string;
  scores: QualityScore[];
  /** Média das dimensões. */
  overall: number;
  violationCount: number;
  quarantinedCount: number;
}

export interface QuarantineRecord {
  id: string;
  datasetId: string;
  ruleId: string;
  rowIndex: number;
  row: Record<string, unknown>;
  reason: string;
  quarantinedAt: string;
}

/** Dataset composto: joins declarados (US 9,542,446 / 10,678,860). */
export interface CompositeDatasetDef {
  id: string;
  name: string;
  sourceDatasetIds: string[];
  /** Pares de join: left.col = right.col */
  joinKeys: Array<{ leftDatasetId: string; leftColumn: string; rightDatasetId: string; rightColumn: string }>;
}

export function buildGoldenQualityRule(): QualityRule {
  return {
    id: 'rule-not-null-id',
    name: 'id required',
    condition: { kind: 'not_null', column: 'id' },
    severity: 'quarantine',
    action: { kind: 'quarantine' },
    scope: '*',
    version: 1,
    owner: 'platform',
    active: true,
  };
}
