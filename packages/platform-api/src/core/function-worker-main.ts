/**
 * Operational Function worker. Separate from HTTP listen (ADR-0019).
 * Starts only after the platform runtime reports ready.
 */

import type { PlatformContext } from './context.js';

export interface FunctionWorkerRuntime {
  ctx: Pick<PlatformContext, 'ready' | 'functionWorker'>;
  close(): Promise<void>;
}

export interface StartFunctionWorkerDeps {
  createRuntime: () => Promise<FunctionWorkerRuntime>;
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  exit(code: number): void;
  logError(message: string): void;
}

export async function startFunctionWorker(deps: StartFunctionWorkerDeps): Promise<void> {
  try {
    const runtime = await deps.createRuntime();
    if (!runtime.ctx.ready) {
      throw new Error('function worker refused: platform is not ready');
    }
    const ac = new AbortController();
    const close = async () => {
      ac.abort();
      await runtime.ctx.functionWorker.stop();
      await runtime.close();
    };
    deps.on('SIGINT', () => {
      void close().then(() => deps.exit(0));
    });
    deps.on('SIGTERM', () => {
      void close().then(() => deps.exit(0));
    });
    await runtime.ctx.functionWorker.run(ac.signal);
    await runtime.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logError(`function worker bootstrap failed: ${message}`);
    deps.exit(1);
  }
}
