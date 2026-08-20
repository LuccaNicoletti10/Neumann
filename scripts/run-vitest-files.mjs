#!/usr/bin/env node
/**
 * Fail-closed Vitest for an explicit file list produced by test-discovery.
 * Skip, missing file, or zero tests → exit 1.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { INTEGRATION_RE } from './test-discovery.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function spawnCollect(command, args, { cwd, env, timeoutMs = 120_000 }) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    const finish = (status, extraErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        status,
        stdout,
        stderr: extraErr ? `${stderr}\n${extraErr}` : stderr,
      });
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (err) => finish(1, err.message));
    child.on('close', (status) => finish(status === null ? 1 : status));
  });
}

export function parseVitestJson(report) {
  const collectedFiles = (report.testResults ?? []).map((t) => t.name ?? '');
  const pending = Number(report.numPendingTests ?? 0);
  const total = Number(report.numTotalTests ?? 0);
  const failed = Number(report.numFailedTests ?? 0);
  const passed = Number(report.numPassedTests ?? 0);
  const skipped = (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? [])
      .filter((a) => a.status === 'skipped' || a.status === 'pending')
      .map((a) => a.fullName ?? a.title),
  );
  return { collectedFiles, pending, total, failed, passed, skipped };
}

/**
 * Run an explicit file list with Vitest.
 *
 * @param {object} args
 * @param {string} args.cwd package directory
 * @param {string[]} args.files paths relative to cwd
 * @param {'unit' | 'integration'} args.mode partition mode
 * @param {string} [args.coverageDir] when set, V8 coverage is written here
 * @returns {Promise<{ ok: boolean, exit: number, error?: string, summary: object | null }>}
 */
export async function runVitestFiles({ cwd, files, mode, coverageDir }) {
  if (files.length === 0) {
    return { ok: false, exit: 2, error: 'no files', summary: null };
  }

  if (mode === 'unit') {
    const leaked = files.filter((f) => INTEGRATION_RE.test(f));
    if (leaked.length > 0) {
      return {
        ok: false,
        exit: 1,
        error: `unit run included integration files: ${leaked.join(', ')}`,
        summary: null,
      };
    }
  }

  if (mode === 'integration' && !process.env.DATABASE_URL) {
    return {
      ok: false,
      exit: 1,
      error: 'DATABASE_URL is required (integration is fail-closed; this is not a skip)',
      summary: null,
    };
  }

  if (mode === 'integration') {
    const wait = await spawnCollect('pnpm', ['exec', 'tsx', join(repoRoot, 'scripts/pg-require.ts')], {
      cwd: repoRoot,
      env: process.env,
    });
    if (wait.status !== 0) {
      return {
        ok: false,
        exit: wait.status,
        error: 'PostgreSQL is not reachable or not configured (not a skip)',
        summary: null,
      };
    }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'neumann-vitest-'));
  const jsonPath = join(tmp, 'report.json');
  // WHY: each IsolatedPg pool is 10 connections; parallel integration files
  // exhaust max_connections and hang until the 5s vitest budget. forks avoids
  // worker_threads deadlock with execution-sandbox.
  const isolationArgs =
    mode === 'integration' ? ['--pool=forks', '--fileParallelism=false'] : [];
  const coverageArgs = coverageDir
    ? [
        '--coverage',
        '--coverage.provider=v8',
        '--coverage.all=true',
        '--coverage.include=src/**',
        `--coverage.reportsDirectory=${coverageDir}`,
        '--coverage.reporter=json',
        '--coverage.reporter=json-summary',
        '--coverage.exclude=**/*.d.ts',
        '--coverage.exclude=**/dist/**',
        '--coverage.exclude=**/node_modules/**',
        '--coverage.exclude=**/*.{test,spec}.*',
      ]
    : [];
  const result = await spawnCollect(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      ...files,
      ...isolationArgs,
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${jsonPath}`,
      ...coverageArgs,
    ],
    { cwd, env: process.env },
  );

  let report;
  try {
    report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    rmSync(tmp, { recursive: true, force: true });
    return {
      ok: false,
      exit: 1,
      error: 'fail-closed vitest: JSON report was not written (zero files collected or runner crash)',
      summary: null,
    };
  }
  rmSync(tmp, { recursive: true, force: true });

  const summary = parseVitestJson(report);
  const collectedRel = summary.collectedFiles.map((name) => relative(repoRoot, name));
  const requestedRel = files.map((f) => relative(repoRoot, resolve(cwd, f)));
  const missing = requestedRel.filter(
    (req) => !collectedRel.some((got) => got === req || got.endsWith(req) || req.endsWith(got)),
  );

  const problems = [];
  if (summary.collectedFiles.length === 0) problems.push('zero files collected');
  if (summary.total === 0) problems.push('zero tests collected');
  if (summary.pending > 0 || summary.skipped.length > 0) {
    problems.push(`skipped tests are an error (${summary.skipped.join('; ') || summary.pending})`);
  }
  if (missing.length > 0) problems.push(`requested files disappeared: ${missing.join(', ')}`);
  if (mode === 'unit') {
    const collectedIntegration = collectedRel.filter((f) => INTEGRATION_RE.test(f));
    if (collectedIntegration.length > 0) {
      problems.push(`unit collected integration files: ${collectedIntegration.join(', ')}`);
    }
  }
  if (summary.failed > 0 || report.success === false || result.status !== 0) {
    problems.push('vitest failed');
  }

  return {
    ok: problems.length === 0,
    exit: problems.length === 0 ? 0 : 1,
    error: problems[0],
    summary: {
      ...summary,
      collectedFiles: collectedRel,
      requestedFiles: requestedRel,
    },
  };
}

export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function loop() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => loop()));
  return results;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const mode = args[0] === '--mode=unit' ? 'unit' : 'integration';
  const files = args.filter((a) => !a.startsWith('--mode='));
  if (files.length === 0) {
    console.error('usage: run-vitest-files.mjs --mode=unit|integration <file> [file...]');
    process.exit(2);
  }
  const ran = await runVitestFiles({ cwd: process.cwd(), files, mode });
  console.log('--- fail-closed summary ---');
  console.log(JSON.stringify({ ok: ran.ok, error: ran.error, summary: ran.summary }, null, 2));
  process.exit(ran.exit);
}
