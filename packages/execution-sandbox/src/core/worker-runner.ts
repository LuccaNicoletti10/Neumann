/**
 * execution-sandbox — src/core/worker-runner.ts
 * Worker thread pool with timeout and heap cap.
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
}

export interface WorkerRunResponse {
  ok: boolean;
  output?: unknown;
  error?: string;
  reason?: string;
  files?: Record<string, string>;
}

function workerEntry(): string {
  const js = fileURLToPath(new URL('../worker/entry.js', import.meta.url));
  const ts = fileURLToPath(new URL('../worker/entry.ts', import.meta.url));
  return existsSync(js) ? js : ts;
}

export async function runInWorker(req: WorkerRunRequest): Promise<WorkerRunResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (msg: WorkerRunResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(msg);
    };
    const entry = workerEntry();
    const worker = new Worker(entry, {
      workerData: {
        transformSource: req.transformSource,
        input: req.input,
        policy: req.policy,
        files: req.files,
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : [],
    });
    const timer = setTimeout(() => {
      void worker.terminate().then(() => {
        finish({ ok: false, reason: 'TIMEOUT', error: 'SandboxTimeout' });
      });
    }, req.timeoutMs);
    worker.once('message', (msg: WorkerRunResponse) => {
      finish(msg);
    });
    worker.once('error', (err) => {
      finish({ ok: false, reason: 'FORBIDDEN_API', error: err.message });
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish({ ok: false, reason: 'MEMORY_LIMIT', error: `worker exited ${code}` });
      }
    });
  });
}
