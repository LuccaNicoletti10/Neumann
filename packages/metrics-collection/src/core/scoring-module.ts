/**
 * ScoringModule — score por categoria / deployment / produto.
 */
import type { MetricsStore, MetricPoint } from "./metrics-store.js";
import type { CategorizationModule } from "./categorization-module.js";
import { matchesPattern } from "./categorization-module.js";

export interface ScoreQuery {
  category: string;
  deploymentId?: string;
  product?: string;
}

export type ScoringFunction = (points: readonly MetricPoint[]) => number;

export class ScoringModule {
  private readonly scoringFunctions = new Map<string, ScoringFunction[]>();

  constructor(
    private readonly store: MetricsStore,
    private readonly categorization: CategorizationModule
  ) {}

  registerScoringFunction(categoryId: string, fn: ScoringFunction): void {
    const list = this.scoringFunctions.get(categoryId) ?? [];
    list.push(fn);
    this.scoringFunctions.set(categoryId, list);
  }

  private pointsFor(query: ScoreQuery): MetricPoint[] {
    return this.store.getPoints().filter((p) => {
      if (query.deploymentId !== undefined && p.deploymentId !== query.deploymentId) return false;
      if (query.product !== undefined && p.product !== query.product) return false;
      return this.categorization.categorize(p.parsed).includes(query.category);
    });
  }

  getScore(query: ScoreQuery): number {
    const points = this.pointsFor(query);
    let score = points.reduce((acc, p) => acc + p.value, 0);
    for (const fn of this.scoringFunctions.get(query.category) ?? []) {
      score += fn(points);
    }
    return score;
  }

  getScoresByDeployment(category: string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const deploymentId of this.store.listDeployments()) {
      result[deploymentId] = this.getScore({ category, deploymentId });
    }
    return result;
  }

  getScoresByProduct(category: string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const product of this.store.listProducts()) {
      result[product] = this.getScore({ category, product });
    }
    return result;
  }

  rankDeployments(category: string): Array<{ deploymentId: string; score: number }> {
    return Object.entries(this.getScoresByDeployment(category))
      .map(([deploymentId, score]) => ({ deploymentId, score }))
      .sort((a, b) => b.score - a.score);
  }
}

export function makeThresholdCountScoringFunction(options: {
  umiPattern: string;
  threshold: number;
  pointsPerDevice?: number;
}): ScoringFunction {
  const perDevice = options.pointsPerDevice ?? 1;
  return (points) => {
    const maxByDevice = new Map<string, number>();
    for (const p of points) {
      if (!matchesPattern(options.umiPattern, p.parsed)) continue;
      const device = p.sourceId ?? p.deploymentId;
      const current = maxByDevice.get(device) ?? Number.NEGATIVE_INFINITY;
      if (p.value > current) maxByDevice.set(device, p.value);
    }
    let count = 0;
    for (const max of maxByDevice.values()) {
      if (max > options.threshold) count++;
    }
    return count * perDevice;
  };
}
