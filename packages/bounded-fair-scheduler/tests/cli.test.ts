// bounded-fair-scheduler — testes da CLI (mecanismos 3-9 via linha de comando).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = join(PKG_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(PKG_ROOT, 'src', 'cli.ts');

function cli(args: string[]): string {
  return execFileSync(TSX, [CLI, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function freshState(): { state: string; flag: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'bfs-cli-'));
  const state = join(dir, 'state.json');
  return { state, flag: ['--state', state] };
}

describe('CLI — demo', () => {
  it('demo mostra waiting queue (backpressure) e redução de latência low-cost', () => {
    const out = cli(['demo']);
    expect(out).toContain('admitted=execution');
    expect(out).toContain('admitted=waiting');
    expect(out).toContain('waitingQueueEnqueuedCount=3');
    expect(out).toContain('fair-bounded');
    expect(out).toMatch(/FCFS/);
    expect(out).toMatch(/redução de latência low-cost: \d+\.\d%/);
  }, 90_000);
});

describe('CLI — submit / run / queue / cancel', () => {
  it('fluxo completo com fila maxQueueSize=1: backpressure, cancel na waiting, run', () => {
    const { flag } = freshState();
    const s1 = cli(['submit', '--query', 'SELECT 1', '--cost', '100', '--max-queue-size', '1', ...flag]);
    expect(JSON.parse(s1)).toMatchObject({ jobId: 'job-1', admitted: 'execution' });

    const s2 = cli(['submit', '--query', 'SELECT 2', '--cost', '100', ...flag]);
    expect(JSON.parse(s2)).toMatchObject({ jobId: 'job-2', admitted: 'waiting' });

    const q1 = cli(['queue', ...flag]);
    expect(q1).toContain('execution queue (1/1, CHEIA)');
    expect(q1).toContain('#1 job-1');
    expect(q1).toContain('waiting queue (1)');
    expect(q1).toContain('#1 job-2');

    const cancel = cli(['cancel', 'job-2', ...flag]);
    expect(cancel).toContain('job-2 cancelado');
    expect(cancel).toContain('waiting queue (0)');

    const run = cli(['run', ...flag]);
    expect(run).toMatch(/steps executados: \d+/);
    expect(run).toContain('job-1 [completed]');
    expect(run).toContain('rows=100');

    const q2 = cli(['queue', ...flag]);
    expect(q2).toContain('execution queue (0/1)');
  }, 180_000);

  it('cancel de job na execution promove o waiting', () => {
    const { flag } = freshState();
    cli(['submit', '--query', 'a', '--cost', '100', '--max-queue-size', '1', ...flag]);
    cli(['submit', '--query', 'b', '--cost', '10', ...flag]);
    const cancel = cli(['cancel', 'job-1', ...flag]);
    expect(cancel).toContain('job-1 cancelado');
    const q = cli(['queue', ...flag]);
    expect(q).toContain('#1 job-2');
    expect(q).toContain('waiting queue (0)');
  }, 180_000);

  it('compare --file jobs.json exibe relatório fair-bounded vs FCFS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bfs-cli-'));
    const file = join(dir, 'jobs.json');
    writeFileSync(
      file,
      JSON.stringify([
        { query: 'pesada', costEstimate: 1000 },
        { query: 'leve', costEstimate: 10 },
      ]),
    );
    const { flag } = freshState();
    const out = cli(['compare', '--file', file, ...flag]);
    const report = JSON.parse(out) as {
      lowCost: { count: number; completionLatencyReductionPct: number | null };
    };
    expect(report.lowCost.count).toBe(1);
    expect(report.lowCost.completionLatencyReductionPct ?? 0).toBeGreaterThan(0);
  }, 180_000);
});