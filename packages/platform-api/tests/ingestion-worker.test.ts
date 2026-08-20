/**
 * platform-api — ingestion worker bootstrap (ADR-0017).
 */
import { describe, expect, it } from 'vitest';

import { startIngestionWorker } from '../src/core/ingestion-worker-main.js';

describe('startIngestionWorker', () => {
  it('refuses a runtime that is not ready', async () => {
    const exits: number[] = [];
    const logs: string[] = [];
    await startIngestionWorker({
      createRuntime: async () => ({
        ctx: {
          ready: false,
          ingestionWorker: {
            drainOnce: async () => 0,
            run: async () => undefined,
            stop: async () => undefined,
          },
        },
        close: async () => undefined,
      }),
      on: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      logError: (message) => {
        logs.push(message);
      },
    });
    expect(exits).toEqual([1]);
    expect(logs[0]).toMatch(/not ready/);
    expect(logs.join(' ')).not.toMatch(/secret|authorization|whsec/i);
  });

  it('runs until abort, then stop is graceful', async () => {
    const exits: number[] = [];
    let stopped = false;
    let closed = 0;
    const handlers: Partial<Record<'SIGINT' | 'SIGTERM', () => void>> = {};
    let running!: () => void;
    const sawRun = new Promise<void>((resolve) => {
      running = resolve;
    });
    let exitResolve!: () => void;
    const exited = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });
    const done = startIngestionWorker({
      createRuntime: async () => ({
        ctx: {
          ready: true,
          ingestionWorker: {
            drainOnce: async () => 0,
            run: async (signal) => {
              running();
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                signal.addEventListener('abort', () => resolve(), { once: true });
              });
            },
            stop: async () => {
              stopped = true;
            },
          },
        },
        close: async () => {
          closed += 1;
        },
      }),
      on: (event, handler) => {
        handlers[event] = handler;
      },
      exit: (code) => {
        exits.push(code);
        exitResolve();
      },
      logError: () => undefined,
    });
    await sawRun;
    handlers.SIGTERM?.();
    await Promise.all([done, exited]);
    expect(stopped).toBe(true);
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(exits).toContain(0);
  });
});
