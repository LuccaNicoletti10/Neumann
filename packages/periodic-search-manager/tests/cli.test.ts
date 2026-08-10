/**
 * Testes de smoke do CLI: funções de parse (determinísticas) e um fluxo leve
 * via funções exportadas (search create/run/list, alerts, source add-record).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDurationMs, parseCliArgs, parseSchedule, main } from '../src/cli.js';
import { makeTempDir, removeTempDir } from './helpers.js';

describe('CLI — parse', () => {
  it('parseDurationMs: ms, s, m, h, d', () => {
    expect(parseDurationMs('500')).toBe(500);
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('60s')).toBe(60_000);
    expect(parseDurationMs('5m')).toBe(300_000);
    expect(parseDurationMs('2h')).toBe(7_200_000);
    expect(parseDurationMs('1d')).toBe(86_400_000);
    expect(() => parseDurationMs('abc')).toThrow(/inválida/i);
    expect(() => parseDurationMs('10x')).toThrow(/inválida/i);
  });

  it('parseCliArgs: posicionais, --flag valor e --flag=valor', () => {
    const parsed = parseCliArgs([
      'search', 'create',
      '--name', 'Monitor',
      '--source=s1,s2',
      '--every', '60s',
    ]);
    expect(parsed.command).toEqual(['search', 'create']);
    expect(parsed.flags).toEqual({ name: 'Monitor', source: 's1,s2', every: '60s' });
    expect(() => parseCliArgs(['--name'])).toThrow(/sem valor/i);
  });

  it('parseSchedule: interval e daily', () => {
    expect(parseSchedule({ command: [], flags: { every: '60s' } })).toEqual({
      kind: 'interval',
      everyMs: 60_000,
    });
    expect(parseSchedule({ command: [], flags: { daily: '09:30' } })).toEqual({
      kind: 'daily',
      hourUtc: 9,
      minuteUtc: 30,
    });
    expect(() => parseSchedule({ command: [], flags: {} })).toThrow(/--every/i);
    expect(() => parseSchedule({ command: [], flags: { daily: '9h30' } })).toThrow(/HH:MM/i);
  });
});

describe('CLI — fluxo e2e leve (sem HTTP)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  it('search create/run/list + source add-record + alerts', async () => {
    // Cria busca com fonte ad-hoc (registrada via --source-def):
    const createCode = await main([
      'search', 'create',
      '--data-dir', dir,
      '--name', 'Monitor de erros',
      '--source', 's1',
      '--source-def', 's1:Logs',
      '--every', '60s',
      '--text', 'erro',
      '--users', 'u1',
    ]);
    expect(createCode).toBe(0);

    const listCode = await main(['search', 'list', '--data-dir', dir]);
    expect(listCode).toBe(0);

    const listCalls = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    const listJson = JSON.parse(listCalls[listCalls.length - 1] ?? '[]') as Array<{ id: string; name: string }>;
    expect(listJson).toHaveLength(1);
    expect(listJson[0]?.name).toBe('Monitor de erros');
    const searchId = listJson[0]?.id ?? '';
    expect(searchId).not.toBe('');

    // search run (sem dados: totalNew = 0) e alerts (vazio):
    const runCode = await main(['search', 'run', searchId, '--data-dir', dir, '--source-def', 's1:Logs']);
    expect(runCode).toBe(0);
    const alertsCode = await main(['alerts', searchId, '--data-dir', dir]);
    expect(alertsCode).toBe(0);

    // source add-record (fonte ad-hoc em memória):
    const addRecCode = await main([
      'source', 'add-record', 's1',
      '--data-dir', dir,
      '--json', '{"recordId":"r1","timestamp":"2024-01-01T00:00:10.000Z","content":{"msg":"erro de disco"}}',
    ]);
    expect(addRecCode).toBe(0);
  });

  it('help retorna 0 e comando desconhecido retorna 1', async () => {
    expect(await main([])).toBe(0);
    expect(await main(['comando-inexistente'])).toBe(1);
  });
});
