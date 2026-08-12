/**
 * data-quality — src/core/engine.ts
 * Pós-run: score → aplicar regras → quarentena com motivo.
 */

import type {
  CompositeDatasetDef,
  QualityReport,
  QualityRule,
  QuarantineRecord,
} from 'contracts';

import { materializeComposite } from './composite.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { overallScore, scoreDataset, type MetricsOptions } from './metrics.js';
import { applyCleanActions, evaluateDatasetRules } from './rules.js';
import type {
  CreateQualityEngineOptions,
  NamedDataset,
  Row,
} from './types.js';

export interface RunQualityResult {
  report: QualityReport;
  cleanRows: Row[];
  quarantined: QuarantineRecord[];
}

export interface DataQualityEngine {
  registerDataset(ds: NamedDataset): void;
  getDataset(id: string): NamedDataset | undefined;
  addRule(rule: QualityRule): void;
  listRules(): QualityRule[];
  /** Gate: pós-run qualidade + quarentena. */
  run(datasetId: string, metricsOpts?: Partial<MetricsOptions>): RunQualityResult;
  listQuarantine(datasetId?: string): QuarantineRecord[];
  defineComposite(def: CompositeDatasetDef): NamedDataset;
  getComposite(id: string): NamedDataset | undefined;
}

export function createDataQualityEngine(
  options: CreateQualityEngineOptions = {},
): DataQualityEngine {
  const clock = options.clock ?? createDeterministicClock();
  const nextId = options.nextId ?? createIdGenerator();
  const datasets = new Map<string, NamedDataset>();
  const composites = new Map<string, NamedDataset>();
  const rules: QualityRule[] = [];
  const quarantine: QuarantineRecord[] = [];

  return {
    registerDataset(ds) {
      datasets.set(ds.id, {
        ...ds,
        columns: [...ds.columns],
        rows: ds.rows.map((r) => ({ ...r })),
      });
    },
    getDataset(id) {
      return datasets.get(id) ?? composites.get(id);
    },
    addRule(rule) {
      rules.push({ ...rule, condition: { ...rule.condition } as QualityRule['condition'] });
    },
    listRules() {
      return rules.map((r) => ({ ...r }));
    },
    run(datasetId, metricsOpts = {}) {
      const ds = datasets.get(datasetId) ?? composites.get(datasetId);
      if (!ds) throw new Error(`dataset inexistente: ${datasetId}`);

      const now = options.now ?? clock();
      const scores = scoreDataset(ds, {
        now,
        freshnessMaxAgeSeconds: metricsOpts.freshnessMaxAgeSeconds,
        validityColumns: metricsOpts.validityColumns,
        consistencyPairs: metricsOpts.consistencyPairs,
      });

      const quarantineRules = rules.filter(
        (r) =>
          r.active &&
          (r.scope === '*' || r.scope === datasetId) &&
          (r.action.kind === 'quarantine' || r.severity === 'quarantine'),
      );

      const violations = evaluateDatasetRules(quarantineRules, datasetId, ds.rows, { now });
      const badIndexes = new Set(violations.map((v) => v.rowIndex));

      const quarantined: QuarantineRecord[] = violations.map((v) => {
        const rec: QuarantineRecord = {
          id: nextId('q'),
          datasetId,
          ruleId: v.ruleId,
          rowIndex: v.rowIndex,
          row: v.row,
          reason: v.reason,
          quarantinedAt: clock(),
        };
        quarantine.push(rec);
        return rec;
      });

      const kept = ds.rows
        .map((r, i) => ({ r, i }))
        .filter((x) => !badIndexes.has(x.i))
        .map((x) => ({ ...x.r }));

      const cleanRows = applyCleanActions(rules, datasetId, kept);

      // Atualiza dataset com rows limpas (versão bump)
      const updated: NamedDataset = {
        ...ds,
        version: ds.version + 1,
        rows: cleanRows,
        updatedAt: clock(),
      };
      if (datasets.has(datasetId)) datasets.set(datasetId, updated);
      else composites.set(datasetId, updated);

      const report: QualityReport = {
        datasetId,
        datasetVersion: updated.version,
        scoredAt: clock(),
        scores,
        overall: overallScore(scores),
        violationCount: violations.length,
        quarantinedCount: quarantined.length,
      };

      return { report, cleanRows, quarantined };
    },
    listQuarantine(datasetId) {
      return quarantine
        .filter((q) => !datasetId || q.datasetId === datasetId)
        .map((q) => ({ ...q, row: { ...q.row } }));
    },
    defineComposite(def) {
      const now = options.now ?? clock();
      const all = new Map([...datasets, ...composites]);
      const material = materializeComposite(def, all, now);
      composites.set(def.id, material);
      return material;
    },
    getComposite(id) {
      return composites.get(id);
    },
  };
}
