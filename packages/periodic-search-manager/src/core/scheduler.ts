/**
 * Agendador periódico do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "periodic search" — as buscas configuradas pelos usuários
 * rodam PERIODICAMENTE. Este agendador calcula o próximo horário de execução
 * (nextRunAt) a partir do ScheduleSpec (intervalo ou diário em UTC) e processa
 * buscas vencidas em `tick(now)`. O relógio é injetável (determinismo) e
 * `start()/stop()` usam setInterval real para produção — sem dependência de
 * cron externo.
 */

import type { Clock, ScheduleSpec, SearchConfig } from './types.js';

/**
 * Calcula o próximo instante de execução (ISO) a partir de `from`.
 * - interval: from + everyMs.
 * - daily: próximo horário (hourUtc:minuteUtc) estritamente após `from`
 *   (hoje se ainda não passou, senão amanhã).
 */
export function computeNextRunAt(schedule: ScheduleSpec, from: Date): string {
  if (schedule.kind === 'interval') {
    if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) {
      throw new Error(`Intervalo inválido: ${schedule.everyMs}`);
    }
    return new Date(from.getTime() + schedule.everyMs).toISOString();
  }
  // daily em UTC
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      schedule.hourUtc,
      schedule.minuteUtc,
      0,
      0,
    ),
  );
  if (candidate.getTime() > from.getTime()) {
    return candidate.toISOString();
  }
  const nextDay = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  return nextDay.toISOString();
}

/** Retorna true se a busca está vencida em `now`. */
export function isDue(search: SearchConfig, now: Date): boolean {
  if (!search.enabled) return false;
  if (search.nextRunAt === undefined) return false;
  return new Date(search.nextRunAt).getTime() <= now.getTime();
}

/** Runner injetável: executa uma busca (implementado pelo SearchManager). */
export interface SearchRunner {
  runSearch(searchId: string): Promise<unknown>;
}

/**
 * Scheduler: processa buscas vencidas em `tick()`; em produção, `start()`
 * agenda ticks periódicos com setInterval.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(
    private readonly runner: SearchRunner,
    private readonly clock: Clock,
    private readonly listSearches: () => Promise<SearchConfig[]>,
  ) {}

  /**
   * Processa todas as buscas vencidas em `now` (ou no relógio injetado).
   * Determinístico: itera as buscas ordenadas por nextRunAt, depois por id.
   * Retorna os IDs das buscas executadas.
   */
  async tick(now?: Date): Promise<string[]> {
    const instant = now ?? this.clock.now();
    const searches = await this.listSearches();
    const due = searches
      .filter((s) => isDue(s, instant))
      .sort((a, b) => {
        const cmp = (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '');
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
      });
    const ran: string[] = [];
    for (const search of due) {
      await this.runner.runSearch(search.id);
      ran.push(search.id);
    }
    return ran;
  }

  /**
   * Inicia o loop de produção: chama tick() a cada `tickIntervalMs`.
   * Erros em um tick não derrubam o loop.
   */
  start(tickIntervalMs = 1000): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      if (this.ticking) return; // evita sobreposição de ticks
      this.ticking = true;
      void this.tick()
        .catch((err: unknown) => {
          console.error('[scheduler] erro no tick:', err);
        })
        .finally(() => {
          this.ticking = false;
        });
    }, tickIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get running(): boolean {
    return this.timer !== undefined;
  }
}