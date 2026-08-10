/**
 * CollectionModule — submissions + interval definitions + scheduler.
 */
import { z } from "zod";
import { parseUmi, serializeUmi } from "./umi.js";
import { MetricsStore, type MetricPoint } from "./metrics-store.js";

export const metricValueSchema = z.object({
  umi: z.string().min(1),
  value: z.number().finite("value deve ser um número finito"),
});

export const submissionSchema = z.object({
  deploymentId: z.string().min(1, "deploymentId é obrigatório"),
  product: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  submittedAt: z.number().int().positive().optional(),
  metrics: z.array(metricValueSchema).min(1, "submission precisa de ao menos uma métrica"),
});

export type MetricValue = z.infer<typeof metricValueSchema>;
export type MetricsSubmission = z.infer<typeof submissionSchema>;

export interface MetricsRequest {
  feature: string;
  metricsType: "point" | "duration";
  product: string;
  period: { from: number; to: number };
}

export interface DataSource {
  query(request: MetricsRequest): MetricsSubmission[] | Promise<MetricsSubmission[]>;
}

export type IntervalRate = "HOURLY" | "DAILY" | "WEEKLY";

export const intervalDefinitionSchema = z.object({
  deploymentId: z.string().min(1),
  feature: z.string().min(1, "feature (padrão glob de UMI) é obrigatória"),
  product: z.string().min(1),
  rate: z.enum(["HOURLY", "DAILY", "WEEKLY"]),
});

export type MetricsIntervalDefinition = z.infer<typeof intervalDefinitionSchema> & {
  lastDeliveredAt?: number;
};

export const RATE_MS: Record<IntervalRate, number> = {
  HOURLY: 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

function metricsTypeOfFeature(feature: string): "point" | "duration" {
  const parts = feature.split(":");
  const last = parts[parts.length - 1];
  if (
    parts.length >= 3 &&
    (last === "HOURLY" || last === "DAILY" || last === "WEEKLY" || last === "MONTHLY")
  ) {
    return "duration";
  }
  return "point";
}

export interface SubmitResult {
  accepted: number;
  points: MetricPoint[];
}

export interface CollectionModuleOptions {
  dataSources?: Map<string, DataSource>;
  now?: () => number;
}

export class CollectionModule {
  private readonly dataSources: Map<string, DataSource>;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: MetricsStore,
    options: CollectionModuleOptions = {}
  ) {
    this.dataSources = options.dataSources ?? new Map();
    this.now = options.now ?? (() => Date.now());
  }

  registerDataSource(deploymentId: string, source: DataSource): void {
    this.dataSources.set(deploymentId, source);
  }

  submit(raw: unknown): SubmitResult {
    const submission = submissionSchema.parse(raw);
    const receivedAt = this.now();
    const submittedAt = submission.submittedAt ?? receivedAt;
    const points: MetricPoint[] = submission.metrics.map((m) => {
      const parsed = parseUmi(m.umi);
      return {
        umi: serializeUmi(parsed),
        parsed,
        value: m.value,
        deploymentId: submission.deploymentId,
        ...(submission.product !== undefined ? { product: submission.product } : {}),
        ...(submission.sourceId !== undefined ? { sourceId: submission.sourceId } : {}),
        timestamp: submittedAt,
        receivedAt,
      };
    });
    this.store.addPoints(points);
    this.store.addSubmission({
      deploymentId: submission.deploymentId,
      ...(submission.product !== undefined ? { product: submission.product } : {}),
      ...(submission.sourceId !== undefined ? { sourceId: submission.sourceId } : {}),
      submittedAt,
      receivedAt,
      metricCount: points.length,
    });
    this.store.save();
    return { accepted: points.length, points };
  }

  setInterval(raw: unknown): MetricsIntervalDefinition {
    const def = intervalDefinitionSchema.parse(raw);
    const intervals = this.store.getIntervals();
    const existing = intervals.findIndex(
      (i) =>
        i.deploymentId === def.deploymentId &&
        i.feature === def.feature &&
        i.product === def.product
    );
    const record: MetricsIntervalDefinition = { ...def };
    if (existing >= 0) {
      intervals[existing] = { ...intervals[existing], ...record };
    } else {
      intervals.push(record);
    }
    this.store.setIntervals(intervals);
    this.store.save();
    return record;
  }

  listIntervals(): MetricsIntervalDefinition[] {
    return this.store.getIntervals();
  }

  async tick(now: number = this.now()): Promise<MetricsRequest[]> {
    const intervals = this.store.getIntervals();
    const delivered: MetricsRequest[] = [];
    let changed = false;
    for (const def of intervals) {
      const rateMs = RATE_MS[def.rate];
      const last = def.lastDeliveredAt;
      const due = last === undefined || now - last >= rateMs;
      if (!due) continue;
      const source = this.dataSources.get(def.deploymentId);
      if (!source) continue;
      const from = last ?? now - rateMs;
      const request: MetricsRequest = {
        feature: def.feature,
        metricsType: metricsTypeOfFeature(def.feature),
        product: def.product,
        period: { from, to: now },
      };
      const submissions = await source.query(request);
      for (const sub of submissions) {
        this.submit({
          ...sub,
          deploymentId: sub.deploymentId ?? def.deploymentId,
          product: sub.product ?? def.product,
        });
      }
      def.lastDeliveredAt = now;
      changed = true;
      delivered.push(request);
    }
    if (changed) {
      this.store.setIntervals(intervals);
      this.store.save();
    }
    return delivered;
  }

  start(tickMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
