/**
 * execution-sandbox — src/core/worker-runner.ts
 *
 * Worker lifecycle is classified by the first causal event, not by exit code.
 * Generic non-zero exit is EXECUTION_ERROR, never FORBIDDEN_API or MEMORY_LIMIT.
 */
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface WorkerRunRequest {
  transformSource: string;
  input: unknown;
  policy: {
    maxCpuMs: number;
    maxMemoryBytes: number;
    fsAllowPrefixes: string[];
    allowNetwork: boolean;
  };
  files: Record<string, string>;
  timeoutMs: number;
  /** Test override. Production default is 128 MiB old-space. */
  resourceLimits?: { maxOldGenerationSizeMb: number };
  signal?: AbortSignal;
}

export type WorkerFailReason =
  | 'TIMEOUT'
  | 'MEMORY_LIMIT'
  | 'FORBIDDEN_API'
  | 'CANCELLED'
  | 'EXECUTION_ERROR'
  | 'FS_ESCAPE'
  | 'NETWORK_DENIED';

export interface WorkerRunResponse {
  ok: boolean;
  output?: unknown;
  error?: string;
  reason?: WorkerFailReason | string;
  files?: Record<string, string>;
}

export type WorkerLike = {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(): unknown;
  terminate(): Promise<number>;
};

export interface WorkerTermination {
  timedOut: boolean;
  cancelled: boolean;
  exitCode: number | null;
  error?: unknown;
}

export function createOnceSettler<T>(onSettle: (value: T) => void): {
  settle(value: T): boolean;
  isSettled(): boolean;
} {
  let settled = false;
  return {
    settle(value: T) {
      if (settled) return false;
      settled = true;
      onSettle(value);
      return true;
    },
    isSettled() {
      return settled;
    },
  };
}

export function isWorkerOutOfMemory(err: unknown): boolean {
  if (err === undefined || err === null || typeof err !== 'object') return false;
  const rec = err as { code?: unknown; message?: unknown };
  if (rec.code === 'ERR_WORKER_OUT_OF_MEMORY') return true;
  if (typeof rec.message === 'string' && /out of memory/i.test(rec.message)) return true;
  return false;
}

function isWorkerRunResponse(value: unknown): value is WorkerRunResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean'
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/**
 * Classify an isolate death that produced no result message.
 * Exit code alone is never OOM and never a forbidden API.
 */
export function classifyWorkerTermination(term: WorkerTermination): {
  reason: WorkerFailReason;
  error: string;
} {
  if (term.timedOut) {
    return { reason: 'TIMEOUT', error: 'SandboxTimeout' };
  }
  if (term.cancelled) {
    return { reason: 'CANCELLED', error: 'SandboxCancelled' };
  }
  if (isWorkerOutOfMemory(term.error)) {
    return { reason: 'MEMORY_LIMIT', error: errorMessage(term.error, 'ERR_WORKER_OUT_OF_MEMORY') };
  }
  return {
    reason: 'EXECUTION_ERROR',
    error:
      term.error !== undefined
        ? errorMessage(term.error, `worker exited ${term.exitCode ?? 'unknown'}`)
        : `worker exited ${term.exitCode ?? 'unknown'}`,
  };
}

export function bindWorkerTerminal(
  worker: WorkerLike,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<WorkerRunResponse> {
  return new Promise((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let workerError: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settler = createOnceSettler<WorkerRunResponse>((msg) => {
      if (timer !== undefined) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      worker.removeAllListeners();
      worker.once('error', () => undefined);
      void worker.terminate();
      resolve(msg);
    });

    function onAbort() {
      cancelled = true;
      settler.settle({ ok: false, reason: 'CANCELLED', error: 'SandboxCancelled' });
    }

    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      timedOut = true;
      settler.settle({ ok: false, reason: 'TIMEOUT', error: 'SandboxTimeout' });
    }, opts.timeoutMs);

    worker.once('message', (msg) => {
      if (isWorkerRunResponse(msg)) {
        settler.settle(msg);
        return;
      }
      settler.settle({
        ok: false,
        reason: 'EXECUTION_ERROR',
        error: 'worker posted a malformed result',
      });
    });

    worker.once('error', (err) => {
      workerError = err;
      if (isWorkerOutOfMemory(err)) {
        settler.settle({
          ok: false,
          reason: 'MEMORY_LIMIT',
          error: errorMessage(err, 'ERR_WORKER_OUT_OF_MEMORY'),
        });
        return;
      }
      const classified = classifyWorkerTermination({
        timedOut,
        cancelled,
        exitCode: null,
        error: err,
      });
      settler.settle({ ok: false, reason: classified.reason, error: classified.error });
    });

    worker.once('exit', (code) => {
      if (settler.isSettled()) return;
      const classified = classifyWorkerTermination({
        timedOut,
        cancelled,
        exitCode: typeof code === 'number' ? code : null,
        error: workerError,
      });
      settler.settle({ ok: false, reason: classified.reason, error: classified.error });
    });
  });
}

function workerEntry(): string {
  const js = fileURLToPath(new URL('../worker/entry.js', import.meta.url));
  const ts = fileURLToPath(new URL('../worker/entry.ts', import.meta.url));
  return existsSync(js) ? js : ts;
}

export async function runInWorker(req: WorkerRunRequest): Promise<WorkerRunResponse> {
  const entry = workerEntry();
  const worker = new Worker(entry, {
    workerData: {
      transformSource: req.transformSource,
      input: req.input,
      policy: req.policy,
      files: req.files,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: req.resourceLimits?.maxOldGenerationSizeMb ?? 128,
    },
    execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : [],
  });
  return bindWorkerTerminal(worker, { timeoutMs: req.timeoutMs, signal: req.signal });
}
