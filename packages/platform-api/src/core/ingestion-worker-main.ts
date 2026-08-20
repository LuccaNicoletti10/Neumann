/**
 * Operational ingestion worker. Separate from HTTP listen (ADR-0017).
 * Starts only after the platform runtime reports ready.
 */

import type { PlatformContext } from './context.js';

export interface IngestionWorkerRuntime {
  ctx: Pick<PlatformContext, 'ready' | 'ingestionWorker'>;
  close(): Promise<void>;
}

export interface StartIngestionWorkerDeps {
  createRuntime: () => Promise<IngestionWorkerRuntime>;
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  exit(code: number): void;
  logError(message: string): void;
}

export async function startIngestionWorker(deps: StartIngestionWorkerDeps): Promise<void> {
  try {
    const runtime = await deps.createRuntime();
    if (!runtime.ctx.ready) {
      throw new Error('ingestion worker refused: platform is not ready');
    }
    const ac = new AbortController();
    const close = async () => {
      ac.abort();
      await runtime.ctx.ingestionWorker.stop();
      await runtime.close();
    };
    deps.on('SIGINT', () => {
      void close().then(() => deps.exit(0));
    });
    deps.on('SIGTERM', () => {
      void close().then(() => deps.exit(0));
    });
    await runtime.ctx.ingestionWorker.run(ac.signal);
    await runtime.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logError(`ingestion worker bootstrap failed: ${message}`);
    deps.exit(1);
  }
}
