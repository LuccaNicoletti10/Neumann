/**
 * platform-api — Function worker bootstrap (ADR-0019).
 */
import { describe, expect, it } from 'vitest';

import { startFunctionWorker } from '../src/core/function-worker-main.js';

describe('startFunctionWorker', () => {
  it('refuses a runtime that is not ready', async () => {
    const exits: number[] = [];
    const logs: string[] = [];
    await startFunctionWorker({
      createRuntime: async () => ({
        ctx: {
          ready: false,
          functionWorker: {
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
    const done = startFunctionWorker({
      createRuntime: async () => ({
        ctx: {
          ready: true,
          functionWorker: {
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
    handlers.SIGINT?.();
    await Promise.all([done, exited]);
    expect(stopped).toBe(true);
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(exits).toContain(0);
  });

  it('SIGTERM also stops gracefully', async () => {
    const exits: number[] = [];
    const handlers: Partial<Record<'SIGINT' | 'SIGTERM', () => void>> = {};
    let running!: () => void;
    const sawRun = new Promise<void>((resolve) => {
      running = resolve;
    });
    let exitResolve!: () => void;
    const exited = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });
    const done = startFunctionWorker({
      createRuntime: async () => ({
        ctx: {
          ready: true,
          functionWorker: {
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
            stop: async () => undefined,
          },
        },
        close: async () => undefined,
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
    expect(exits).toContain(0);
  });
});
