/**
 * MetricsCollectionSystem — fachada que orquestra todos os módulos.
 */
import { MetricsStore } from "./metrics-store.js";
import {
  CollectionModule,
  type DataSource,
  type MetricsSubmission,
  type SubmitResult,
} from "./collection-module.js";
import { CategorizationModule, type CategoryDefinition } from "./categorization-module.js";
import { ScoringModule, type ScoringFunction, type ScoreQuery } from "./scoring-module.js";
import {
  VisualizationModule,
  type VisualizationData,
  type VisualizationRequest,
} from "./visualization-module.js";

export const SYSTEM_DEPLOYMENT_ID = "metrics-system";
export const SYSTEM_PRODUCT = "metrics-collection";

export interface MetricsSystemOptions {
  storePath?: string;
  now?: () => number;
  metricsOnMetrics?: boolean;
}

export class MetricsCollectionSystem {
  readonly store: MetricsStore;
  readonly collection: CollectionModule;
  readonly categorization: CategorizationModule;
  readonly scoring: ScoringModule;
  readonly visualization: VisualizationModule;
  private readonly now: () => number;
  private readonly selfMetrics: boolean;

  constructor(options: MetricsSystemOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.selfMetrics = options.metricsOnMetrics ?? true;
    this.store = new MetricsStore(options.storePath);
    this.store.load();
    this.categorization = new CategorizationModule(
      this.store.getCategories().length > 0 ? this.store.getCategories() : undefined
    );
    this.collection = new CollectionModule(this.store, { now: this.now });
    this.scoring = new ScoringModule(this.store, this.categorization);
    this.visualization = new VisualizationModule(this.store, this.categorization);
    this.persistCategories();
  }

  private persistCategories(): void {
    this.store.setCategories(this.categorization.listCategories());
    this.store.save();
  }

  private emitSelfMetric(metric: string, value: number): void {
    if (!this.selfMetrics) return;
    this.collection.submit({
      deploymentId: SYSTEM_DEPLOYMENT_ID,
      product: SYSTEM_PRODUCT,
      submittedAt: this.now(),
      metrics: [{ umi: `metrics.system:${metric}:DAILY`, value }],
    });
  }

  submit(raw: unknown): SubmitResult {
    const result = this.collection.submit(raw);
    const sub = raw as Partial<MetricsSubmission>;
    if (sub?.deploymentId !== SYSTEM_DEPLOYMENT_ID) {
      this.emitSelfMetric("submissions.received", 1);
      this.emitSelfMetric("metrics.received", result.accepted);
    }
    return result;
  }

  addCategory(def: CategoryDefinition): void {
    this.categorization.addCategory(def);
    this.persistCategories();
  }

  addFeatureToCategory(categoryId: string, pattern: string): void {
    this.categorization.addFeatureToCategory(categoryId, pattern);
    this.persistCategories();
  }

  listCategories(): CategoryDefinition[] {
    return this.categorization.listCategories();
  }

  getScore(query: ScoreQuery): number {
    return this.scoring.getScore(query);
  }

  registerScoringFunction(categoryId: string, fn: ScoringFunction): void {
    this.scoring.registerScoringFunction(categoryId, fn);
  }

  registerDataSource(deploymentId: string, source: DataSource): void {
    this.collection.registerDataSource(deploymentId, source);
  }

  getVisualizationData(request: VisualizationRequest): VisualizationData {
    const data = this.visualization.getData(request);
    this.emitSelfMetric("visualization.queries", 1);
    return data;
  }

  renderVisualizationHtml(request: VisualizationRequest, title?: string): string {
    const data = this.getVisualizationData(request);
    return this.visualization.renderHtml(data, title);
  }

  listDeployments(): string[] {
    return this.store.listDeployments();
  }

  listProducts(): string[] {
    return this.store.listProducts();
  }
}
