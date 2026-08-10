/**
 * MetricsStore — armazenamento em memória com persistência JSON opcional.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ParsedUmi } from "./umi.js";
import type { CategoryDefinition } from "./categorization-module.js";
import type { MetricsIntervalDefinition } from "./collection-module.js";

export interface MetricPoint {
  umi: string;
  parsed: ParsedUmi;
  value: number;
  deploymentId: string;
  product?: string;
  sourceId?: string;
  timestamp: number;
  receivedAt: number;
}

export interface StoredSubmission {
  deploymentId: string;
  product?: string;
  sourceId?: string;
  submittedAt: number;
  receivedAt: number;
  metricCount: number;
}

interface StoreSnapshot {
  points: MetricPoint[];
  submissions: StoredSubmission[];
  categories: CategoryDefinition[];
  intervals: MetricsIntervalDefinition[];
}

export class MetricsStore {
  private points: MetricPoint[] = [];
  private submissions: StoredSubmission[] = [];
  private categories: CategoryDefinition[] = [];
  private intervals: MetricsIntervalDefinition[] = [];

  constructor(private readonly filePath?: string) {}

  load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const snap = JSON.parse(readFileSync(this.filePath, "utf8")) as StoreSnapshot;
    this.points = snap.points ?? [];
    this.submissions = snap.submissions ?? [];
    this.categories = snap.categories ?? [];
    this.intervals = snap.intervals ?? [];
  }

  save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snap: StoreSnapshot = {
      points: this.points,
      submissions: this.submissions,
      categories: this.categories,
      intervals: this.intervals,
    };
    writeFileSync(this.filePath, JSON.stringify(snap, null, 2), "utf8");
  }

  addPoints(points: MetricPoint[]): void {
    this.points.push(...points);
  }

  addSubmission(sub: StoredSubmission): void {
    this.submissions.push(sub);
  }

  getPoints(): readonly MetricPoint[] {
    return this.points;
  }

  getSubmissions(): readonly StoredSubmission[] {
    return this.submissions;
  }

  setCategories(categories: CategoryDefinition[]): void {
    this.categories = categories.map((c) => ({
      ...c,
      featurePatterns: [...c.featurePatterns],
    }));
  }

  getCategories(): CategoryDefinition[] {
    return this.categories.map((c) => ({
      ...c,
      featurePatterns: [...c.featurePatterns],
    }));
  }

  setIntervals(intervals: MetricsIntervalDefinition[]): void {
    this.intervals = intervals.map((i) => ({ ...i }));
  }

  getIntervals(): MetricsIntervalDefinition[] {
    return this.intervals.map((i) => ({ ...i }));
  }

  listDeployments(): string[] {
    const ids = new Set<string>();
    for (const p of this.points) ids.add(p.deploymentId);
    return [...ids].sort();
  }

  listProducts(): string[] {
    const ids = new Set<string>();
    for (const p of this.points) if (p.product) ids.add(p.product);
    for (const i of this.intervals) ids.add(i.product);
    return [...ids].sort();
  }
}
