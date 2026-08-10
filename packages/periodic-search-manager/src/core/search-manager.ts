/**
 * Fachada orquestradora do periodic-search-manager.
 *
 * Implementação funcional independente dos mecanismos da patente US 10,572,487 B1
 * (Palantir, "Periodic Database Search Manager For Multiple Data Sources"):
 * - "periodic search": buscas configuradas por usuários rodam periodicamente
 *   (Scheduler com relógio injetável);
 * - "multiple data sources": cada busca abrange várias fontes via
 *   DataSourceRegistry;
 * - "new-data detection": cada execução consulta cada fonte com since=watermark
 *   (só dados novos) e aplica o ResultDiffer (recordId + sha256) para dedupe;
 * - "alert/notify": ao encontrar resultados novos, gera AlertRecord e notifica
 *   usuários e membros de times;
 * - "result storage": buscas, resultados, alertas e runs são persistidos em JSON.
 */

import { randomUUID } from 'node:crypto';
import type {
  AlertRecord,
  Clock,
  QuerySpec,
  RunRecord,
  ScheduleSpec,
  SearchConfig,
  SearchResultRecord,
} from './types.js';
import type { DataRecord, DataSourceRegistry } from './data-source.js';
import { TeamDirectory, AlertManager, InMemoryTeamDirectory, Notifier } from './alert-manager.js';
import { WatermarkStore } from './watermark-store.js';
import { ResultDiffer, hashContent } from './result-differ.js';
import { SearchStore } from './search-store.js';
import { Scheduler, computeNextRunAt, type SearchRunner } from './scheduler.js';

/** Relógio do sistema (produção). */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface CreateSearchInput {
  name: string;
  query?: QuerySpec | undefined;
  dataSourceIds: string[];
  schedule: ScheduleSpec;
  recipientUserIds?: string[] | undefined;
  teamIds?: string[] | undefined;
  enabled?: boolean | undefined;
  createdBy?: string | undefined;
}

/**
 * Campos atualizáveis de uma busca. `undefined` significa "não alterar"
 * (compatível com exactOptionalPropertyTypes e saídas de parsers como zod).
 */
export interface UpdateSearchInput {
  name?: string | undefined;
  query?: QuerySpec | undefined;
  dataSourceIds?: string[] | undefined;
  schedule?: ScheduleSpec | undefined;
  recipientUserIds?: string[] | undefined;
  teamIds?: string[] | undefined;
  enabled?: boolean | undefined;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
}

/** Remove chaves com valor undefined (patch semantics). */
function stripUndefined<T extends object>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Partial<Record<keyof T, unknown>> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const value = obj[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export interface SearchManagerOptions {
  dataDir: string;
  registry: DataSourceRegistry;
  clock?: Clock;
  notifiers?: Notifier[];
  teamDirectory?: TeamDirectory;
}

/**
 * SearchManager: API pública que orquestra CRUD de buscas, execução (runner),
 * agendamento (scheduler) e consultas aos artefatos persistidos.
 */
export class SearchManager implements SearchRunner {
  readonly store: SearchStore;
  readonly watermarks: WatermarkStore;
  readonly differ: ResultDiffer;
  readonly alerts: AlertManager;
  readonly scheduler: Scheduler;
  private readonly clock: Clock;
  private readonly registry: DataSourceRegistry;

  constructor(options: SearchManagerOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.registry = options.registry;
    this.store = new SearchStore(options.dataDir);
    this.watermarks = new WatermarkStore(options.dataDir);
    this.differ = new ResultDiffer(options.dataDir);
    this.alerts = new AlertManager(
      options.dataDir,
      options.teamDirectory ?? new InMemoryTeamDirectory(),
      options.notifiers ?? [],
      this.clock,
    );
    this.scheduler = new Scheduler(this, this.clock, () => this.listSearches());
  }

  /** Cria uma busca periódica; valida as fontes e calcula o primeiro nextRunAt. */
  async createSearch(input: CreateSearchInput): Promise<SearchConfig> {
    if (input.name.trim() === '') {
      throw new Error('Nome da busca não pode ser vazio');
    }
    for (const sourceId of input.dataSourceIds) {
      // lança DataSourceNotFoundError se a fonte não estiver registrada
      this.registry.get(sourceId);
    }
    const now = this.clock.now();
    return this.store.create({
      name: input.name,
      query: input.query ?? {},
      dataSourceIds: [...input.dataSourceIds],
      schedule: input.schedule,
      recipientUserIds: input.recipientUserIds ?? [],
      teamIds: input.teamIds ?? [],
      enabled: input.enabled ?? true,
      createdBy: input.createdBy ?? 'anonymous',
      createdAt: now.toISOString(),
      nextRunAt: computeNextRunAt(input.schedule, now),
    });
  }

  async updateSearch(id: string, input: UpdateSearchInput): Promise<SearchConfig> {
    const patch = stripUndefined(input);
    if (patch.dataSourceIds !== undefined) {
      for (const sourceId of patch.dataSourceIds) {
        this.registry.get(sourceId);
      }
    }
    const updated = await this.store.update(id, patch);
    // Se a agenda mudou, recalcula nextRunAt a partir de agora.
    if (patch.schedule !== undefined) {
      return this.store.update(id, {
        nextRunAt: computeNextRunAt(patch.schedule, this.clock.now()),
      });
    }
    return updated;
  }

  deleteSearch(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  getSearch(id: string): Promise<SearchConfig> {
    return this.store.get(id);
  }

  listSearches(): Promise<SearchConfig[]> {
    return this.store.list();
  }

  /**
   * Executa uma busca imediatamente (runner):
   * para cada fonte -> query(since=watermark) -> diff (seen-set) ->
   * se houver novos: alerta -> atualiza watermark/seen -> grava RunRecord.
   */
  async runSearch(searchId: string): Promise<RunRecord> {
    const search = await this.store.get(searchId);
    const runId = randomUUID();
    const startedAt = this.clock.now();
    const fetchedBySource: Record<string, number> = {};
    const newBySource: Record<string, number> = {};
    const allNew: DataRecord[] = [];
    let totalFetched = 0;
    let runError: string | undefined;

    try {
      for (const sourceId of search.dataSourceIds) {
        const source = this.registry.get(sourceId);
        const since = await this.watermarks.get(search.id, sourceId);
        const fetched = await source.query(search.query, since);
        fetchedBySource[sourceId] = fetched.length;
        totalFetched += fetched.length;

        const { newRecords } = await this.differ.diff(search.id, fetched);
        newBySource[sourceId] = newRecords.length;
        allNew.push(...newRecords);

        // Atualiza o watermark para o maior timestamp buscado nesta fonte.
        if (fetched.length > 0) {
          const maxTimestamp = fetched.reduce((max, r) => (r.timestamp > max ? r.timestamp : max), '');
          const current = since ?? '';
          if (maxTimestamp > current) {
            await this.watermarks.set(search.id, sourceId, maxTimestamp);
          }
        }
      }

      let alertId: string | undefined;
      if (allNew.length > 0) {
        // Persiste resultados novos (result storage).
        const firstSeenAt = this.clock.now().toISOString();
        const resultRecords: SearchResultRecord[] = allNew.map((r) => ({
          searchId: search.id,
          recordId: r.recordId,
          sourceId: r.sourceId,
          timestamp: r.timestamp,
          contentHash: hashContent(r.content),
          content: r.content,
          firstSeenAt,
          runId,
        }));
        await this.store.appendResults(resultRecords);

        // Gera alerta e notifica (alert/notify).
        const alert = await this.alerts.createAndNotify(search, allNew);
        alertId = alert.id;

        // Marca como vistos (dedupe futuro).
        await this.differ.markSeen(search.id, allNew);
      }

      const finishedAt = this.clock.now();
      const run: RunRecord = {
        id: runId,
        searchId: search.id,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        fetchedBySource,
        newBySource,
        totalFetched,
        totalNew: allNew.length,
        status: 'ok',
        ...(alertId !== undefined ? { alertId } : {}),
      };
      await this.store.appendRun(run);
      await this.store.update(search.id, {
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: computeNextRunAt(search.schedule, finishedAt),
      });
      return run;
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err);
      const finishedAt = this.clock.now();
      const run: RunRecord = {
        id: runId,
        searchId: search.id,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        fetchedBySource,
        newBySource,
        totalFetched,
        totalNew: allNew.length,
        status: 'error',
        error: runError,
      };
      await this.store.appendRun(run);
      await this.store.update(search.id, {
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: computeNextRunAt(search.schedule, finishedAt),
      });
      return run;
    }
  }

  /** Alias de conveniência para execução manual. */
  runNow(id: string): Promise<RunRecord> {
    return this.runSearch(id);
  }

  /** Processa buscas vencidas em `now` (relógio injetável por padrão). */
  tick(now?: Date): Promise<string[]> {
    return this.scheduler.tick(now);
  }

  listResults(searchId?: string): Promise<SearchResultRecord[]> {
    return this.store.listResults(searchId);
  }

  listAlerts(searchId?: string): Promise<AlertRecord[]> {
    return this.alerts.list(searchId);
  }

  listRuns(searchId?: string): Promise<RunRecord[]> {
    return this.store.listRuns(searchId);
  }
}