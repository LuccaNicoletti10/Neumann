/**
 * execution-sandbox — worker termination classification (first causal event wins).
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { detectForbiddenApi } from '../src/worker/forbidden-api.js';
import {
  bindWorkerTerminal,
  classifyWorkerTermination,
  createOnceSettler,
  isWorkerOutOfMemory,
  runInWorker,
  type WorkerLike,
  type WorkerRunResponse,
} from '../src/core/worker-runner.js';

const policy = {
  maxCpuMs: 50,
  maxMemoryBytes: 64_000,
  fsAllowPrefixes: [] as string[],
  allowNetwork: false,
};

function fakeWorker(): WorkerLike & { emit: (event: string, ...args: unknown[]) => boolean } {
  const ee = new EventEmitter();
  const handle: WorkerLike & { emit: (event: string, ...args: unknown[]) => boolean } = {
    once(event: string, listener: (...args: unknown[]) => void) {
      ee.once(event, listener);
      return handle;
    },
    removeAllListeners() {
      ee.removeAllListeners();
      return handle;
    },
    terminate: async () => 1,
    emit(event: string, ...args: unknown[]) {
      return ee.emit(event, ...args);
    },
  };
  return handle;
}

describe('worker termination classification', () => {
  it('timeout-initiated terminate is TIMEOUT even when exit code is non-zero', () => {
    const classified = classifyWorkerTermination({
      timedOut: true,
      cancelled: false,
      exitCode: 1,
    });
    expect(classified.reason).toBe('TIMEOUT');
  });

  it('ERR_WORKER_OUT_OF_MEMORY is MEMORY_LIMIT', () => {
    const err = Object.assign(new Error('Worker terminated due to reaching memory limit'), {
      code: 'ERR_WORKER_OUT_OF_MEMORY',
    });
    expect(isWorkerOutOfMemory(err)).toBe(true);
    expect(
      classifyWorkerTermination({ timedOut: false, cancelled: false, exitCode: 1, error: err })
        .reason,
    ).toBe('MEMORY_LIMIT');
  });

  it('generic non-zero exit is EXECUTION_ERROR, not MEMORY_LIMIT or FORBIDDEN_API', () => {
    const classified = classifyWorkerTermination({
      timedOut: false,
      cancelled: false,
      exitCode: 1,
    });
    expect(classified.reason).toBe('EXECUTION_ERROR');
    expect(classified.error).toMatch(/worker exited 1/);
  });

  it('explicit cancel is CANCELLED', () => {
    expect(
      classifyWorkerTermination({ timedOut: false, cancelled: true, exitCode: 1 }).reason,
    ).toBe('CANCELLED');
  });

  it('settles exactly once; late events cannot overwrite', () => {
    const seen: string[] = [];
    const settler = createOnceSettler<string>((value) => seen.push(value));
    expect(settler.settle('TIMEOUT')).toBe(true);
    expect(settler.settle('MEMORY_LIMIT')).toBe(false);
    expect(settler.settle('FORBIDDEN_API')).toBe(false);
    expect(settler.settle('EXECUTION_ERROR')).toBe(false);
    expect(settler.isSettled()).toBe(true);
    expect(seen).toEqual(['TIMEOUT']);
  });
});

describe('detectForbiddenApi', () => {
  it('require/import in source is forbidden; a generic throw is not', () => {
    expect(detectForbiddenApi("() => require('fs')", 'require is not defined')).toBe(true);
    expect(detectForbiddenApi('() => { throw new Error("boom") }', 'boom')).toBe(false);
  });
});

describe('bindWorkerTerminal', () => {
  it('success message wins', async () => {
    const worker = fakeWorker();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000 });
    worker.emit('message', { ok: true, output: 7 } satisfies WorkerRunResponse);
    await expect(result).resolves.toEqual({ ok: true, output: 7 });
  });

  it('timeout is first when the timer fires before any message', async () => {
    const worker = fakeWorker();
    const result = await bindWorkerTerminal(worker, { timeoutMs: 20 });
    expect(result.reason).toBe('TIMEOUT');
    expect(() =>
      worker.emit(
        'error',
        Object.assign(new Error('late OOM'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }),
      ),
    ).not.toThrow();
    worker.emit('exit', 1);
    expect(result.reason).toBe('TIMEOUT');
  });

  it('OOM error is MEMORY_LIMIT', async () => {
    const worker = fakeWorker();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000 });
    worker.emit(
      'error',
      Object.assign(new Error('Worker terminated due to reaching memory limit'), {
        code: 'ERR_WORKER_OUT_OF_MEMORY',
      }),
    );
    await expect(result).resolves.toMatchObject({ ok: false, reason: 'MEMORY_LIMIT' });
  });

  it('detector message is FORBIDDEN_API', async () => {
    const worker = fakeWorker();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000 });
    worker.emit('message', {
      ok: false,
      reason: 'FORBIDDEN_API',
      error: 'require is not defined',
    } satisfies WorkerRunResponse);
    await expect(result).resolves.toMatchObject({ reason: 'FORBIDDEN_API' });
  });

  it('unexpected exit without a message is EXECUTION_ERROR', async () => {
    const worker = fakeWorker();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000 });
    worker.emit('exit', 1);
    await expect(result).resolves.toMatchObject({
      ok: false,
      reason: 'EXECUTION_ERROR',
      error: 'worker exited 1',
    });
  });

  it('abort signal is CANCELLED', async () => {
    const worker = fakeWorker();
    const ac = new AbortController();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000, signal: ac.signal });
    ac.abort();
    await expect(result).resolves.toMatchObject({ ok: false, reason: 'CANCELLED' });
  });

  it('message then late exit keeps the message', async () => {
    const worker = fakeWorker();
    const result = bindWorkerTerminal(worker, { timeoutMs: 5_000 });
    worker.emit('message', { ok: true, output: 'first' } satisfies WorkerRunResponse);
    worker.emit('exit', 1);
    await expect(result).resolves.toEqual({ ok: true, output: 'first' });
  });
});

describe('runInWorker', () => {
  it('identity transform succeeds', async () => {
    const result = await runInWorker({
      transformSource: '(input) => input',
      input: { n: 1 },
      policy,
      files: {},
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ n: 1 });
  }, 10_000);

  it('infinite loop is TIMEOUT, not MEMORY_LIMIT', async () => {
    const started = Date.now();
    const result = await runInWorker({
      transformSource: '() => { for (;;) { /* hang */ } }',
      input: {},
      policy,
      files: {},
      timeoutMs: 200,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('TIMEOUT');
  }, 10_000);

  it('heap exhaustion is MEMORY_LIMIT', async () => {
    const result = await runInWorker({
      transformSource:
        '() => { const chunks = []; for (;;) { chunks.push(new Array(200000).fill(1)); } }',
      input: {},
      policy: { ...policy, maxCpuMs: 50_000 },
      files: {},
      timeoutMs: 20_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('MEMORY_LIMIT');
  }, 30_000);

  it('require(fs) is FORBIDDEN_API from the detector, not from exit code', async () => {
    const result = await runInWorker({
      transformSource: "() => { require('fs'); return 1; }",
      input: {},
      policy,
      files: {},
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('FORBIDDEN_API');
  }, 10_000);

  it('unexpected throw is EXECUTION_ERROR, not FORBIDDEN_API', async () => {
    const result = await runInWorker({
      transformSource: '() => { throw new Error("boom-unrelated"); }',
      input: {},
      policy,
      files: {},
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EXECUTION_ERROR');
    expect(result.error).toMatch(/boom-unrelated/);
  }, 10_000);

  it('abort is CANCELLED', async () => {
    const ac = new AbortController();
    const pending = runInWorker({
      transformSource: '() => { for (;;) { /* hang */ } }',
      input: {},
      policy,
      files: {},
      timeoutMs: 20_000,
      signal: ac.signal,
    });
    ac.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('CANCELLED');
  }, 10_000);
});
