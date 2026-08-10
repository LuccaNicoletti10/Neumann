/**
 * CLI: demo roda e imprime a comparação FCFS × fair; submit/run/cancel/compare
 * funcionam sobre um jobs.json temporário.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function cli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileP(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', ...args],
    { cwd: pkgRoot, timeout: 60_000 },
  );
  return { stdout, stderr };
}

let dir: string;
let jobsFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'fqs-cli-'));
  jobsFile = path.join(dir, 'jobs.json');
  await writeFile(
    jobsFile,
    JSON.stringify({
      tableSizes: { t: 1000 },
      thresholdCost: 100,
      jobs: [
        { query: 't', costEstimate: 1000 },
        { query: 't', costEstimate: 10 },
        { query: 't', costEstimate: 10 },
      ],
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CLI', () => {
  it('demo: imprime comparação FCFS × fair com jobs pequenos favorecidos', async () => {
    const { stdout } = await cli('demo');
    expect(stdout).toContain('modo FCFS');
    expect(stdout).toContain('modo FAIR');
    expect(stdout).toMatch(/job pequeno job-2: conclusão FCFS=\d+ ms → FAIR=\d+ ms/);
    // Extrai os números e confirma que fair < FCFS.
    const m = /job pequeno job-2: conclusão FCFS=(\d+) ms → FAIR=(\d+) ms/.exec(stdout)!;
    expect(Number(m[2])).toBeLessThan(Number(m[1]));
  }, 90_000);

  it('submit --query --cost: submete, executa e imprime métricas', async () => {
    const { stdout } = await cli('submit', '--query', 't', '--cost', '250', '--table-size', '250');
    expect(stdout).toContain('jobId: job-1');
    expect(stdout).toContain('estado: done');
    expect(stdout).toContain('linhas retornadas: 250');
    expect(stdout).toContain('tasks executadas: 3');
  }, 90_000);

  it('run --mode fair: executa a carga e imprime métricas por job', async () => {
    const { stdout } = await cli('run', '--mode', 'fair', '--file', jobsFile);
    expect(stdout).toContain('modo: fair');
    expect(stdout).toContain('job-1');
    expect(stdout).toContain('job-3');
  }, 90_000);

  it('cancel <id>: cancela um job da carga e executa os demais', async () => {
    const { stdout } = await cli('cancel', 'job-2', '--file', jobsFile);
    expect(stdout).toContain('cancel(job-2): removido da fila e marcado como cancelled');
    expect(stdout).toContain('estado final');
  }, 90_000);

  it('compare --file: imprime métricas dos dois modos', async () => {
    const { stdout } = await cli('compare', '--file', jobsFile);
    expect(stdout).toContain('modo FCFS (sem divisão)');
    expect(stdout).toContain('modo FAIR (round-robin)');
  }, 90_000);
});
