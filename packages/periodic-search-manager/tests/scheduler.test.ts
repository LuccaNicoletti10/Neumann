/**
 * Testes do scheduler (periodic search): tick com relógio fake dispara buscas
 * vencidas (interval e daily), não dispara as não-vencidas, e nextRunAt é
 * calculado corretamente — inclusive daily para o dia seguinte.
 */

import { describe, expect, it } from 'vitest';
import { Scheduler, computeNextRunAt, isDue } from '../src/core/scheduler.js';
import type { SearchConfig } from '../src/core/types.js';
import { FakeClock } from './helpers.js';

function makeSearch(overrides: Partial<SearchConfig>): SearchConfig {
  return {
    id: 's1',
    name: 'Busca',
    query: {},
    dataSourceIds: ['fonte-a'],
    schedule: { kind: 'interval', everyMs: 60_000 },
    recipientUserIds: [],
    teamIds: [],
    enabled: true,
    createdBy: 'tester',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeNextRunAt', () => {
  it('interval: from + everyMs', () => {
    const from = new Date('2024-01-01T10:00:00.000Z');
    expect(computeNextRunAt({ kind: 'interval', everyMs: 60_000 }, from)).toBe(
      '2024-01-01T10:01:00.000Z',
    );
  });

  it('daily: ainda hoje, se o horário não passou', () => {
    const from = new Date('2024-01-01T10:00:00.000Z');
    expect(computeNextRunAt({ kind: 'daily', hourUtc: 12, minuteUtc: 30 }, from)).toBe(
      '2024-01-01T12:30:00.000Z',
    );
  });

  it('daily: dia seguinte, se o horário de hoje já passou', () => {
    const from = new Date('2024-01-01T13:00:00.000Z');
    expect(computeNextRunAt({ kind: 'daily', hourUtc: 12, minuteUtc: 30 }, from)).toBe(
      '2024-01-02T12:30:00.000Z',
    );
  });

  it('daily: exatamente no horário -> dia seguinte (estritamente após)', () => {
    const from = new Date('2024-01-01T12:30:00.000Z');
    expect(computeNextRunAt({ kind: 'daily', hourUtc: 12, minuteUtc: 30 }, from)).toBe(
      '2024-01-02T12:30:00.000Z',
    );
  });

  it('daily: virada de mês/ano', () => {
    const from = new Date('2024-12-31T23:00:00.000Z');
    expect(computeNextRunAt({ kind: 'daily', hourUtc: 1, minuteUtc: 0 }, from)).toBe(
      '2025-01-01T01:00:00.000Z',
    );
  });

  it('interval inválido lança erro', () => {
    expect(() => computeNextRunAt({ kind: 'interval', everyMs: 0 }, new Date())).toThrow();
  });
});

describe('isDue', () => {
  it('vencida quando nextRunAt <= now e habilitada', () => {
    const now = new Date('2024-01-01T10:01:00.000Z');
    expect(isDue(makeSearch({ nextRunAt: '2024-01-01T10:00:00.000Z' }), now)).toBe(true);
    expect(isDue(makeSearch({ nextRunAt: '2024-01-01T10:01:00.000Z' }), now)).toBe(true);
    expect(isDue(makeSearch({ nextRunAt: '2024-01-01T10:02:00.000Z' }), now)).toBe(false);
  });

  it('desabilitada ou sem nextRunAt nunca está vencida', () => {
    const now = new Date('2024-01-01T10:01:00.000Z');
    expect(isDue(makeSearch({ nextRunAt: '2024-01-01T10:00:00.000Z', enabled: false }), now)).toBe(false);
    expect(isDue(makeSearch({}), now)).toBe(false);
  });
});

describe('Scheduler.tick com relógio fake', () => {
  it('dispara apenas buscas vencidas (interval e daily)', async () => {
    const clock = new FakeClock('2024-01-01T10:00:00.000Z');
    const searches: SearchConfig[] = [
      makeSearch({ id: 'vencida-interval', schedule: { kind: 'interval', everyMs: 60_000 }, nextRunAt: '2024-01-01T10:00:00.000Z' }),
      makeSearch({ id: 'vencida-daily', schedule: { kind: 'daily', hourUtc: 9, minuteUtc: 0 }, nextRunAt: '2024-01-01T09:00:00.000Z' }),
      makeSearch({ id: 'nao-vencida', schedule: { kind: 'interval', everyMs: 3_600_000 }, nextRunAt: '2024-01-01T11:00:00.000Z' }),
      makeSearch({ id: 'desabilitada', enabled: false, nextRunAt: '2024-01-01T09:30:00.000Z' }),
    ];
    const ran: string[] = [];
    const scheduler = new Scheduler(
      { runSearch: (id) => { ran.push(id); return Promise.resolve(); } },
      clock,
      () => Promise.resolve(searches),
    );

    const result = await scheduler.tick(clock.now());
    expect(result).toEqual(['vencida-daily', 'vencida-interval']);
    expect(ran).toEqual(['vencida-daily', 'vencida-interval']);
  });

  it('tick usa o relógio injetado quando `now` não é informado', async () => {
    const clock = new FakeClock('2024-01-01T10:00:00.000Z');
    const search = makeSearch({ id: 'x', nextRunAt: '2024-01-01T10:00:30.000Z' });
    const ran: string[] = [];
    const scheduler = new Scheduler(
      { runSearch: (id) => { ran.push(id); return Promise.resolve(); } },
      clock,
      () => Promise.resolve([search]),
    );

    expect(await scheduler.tick()).toEqual([]); // ainda não venceu
    clock.advanceMs(31_000);
    expect(await scheduler.tick()).toEqual(['x']); // venceu
    expect(ran).toEqual(['x']);
  });

  it('start/stop controlam o timer de produção', () => {
    const scheduler = new Scheduler(
      { runSearch: () => Promise.resolve() },
      new FakeClock(),
      () => Promise.resolve([]),
    );
    expect(scheduler.running).toBe(false);
    scheduler.start(10_000);
    expect(scheduler.running).toBe(true);
    scheduler.start(10_000); // idempotente
    expect(scheduler.running).toBe(true);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });
});