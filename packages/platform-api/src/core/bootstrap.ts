/**
 * platform-api — src/core/bootstrap.ts
 *
 * Async factory: validate → open deps → validate schema → await policy →
 * await seed → context ready. Failure closes resources and does not listen.
 */

import type { FastifyInstance } from 'fastify';

import {
  createMemoryPlatformContext,
  createPostgresPlatformContext,
  type CreateMemoryPlatformContextOptions,
  type CreatePostgresPlatformContextOptions,
  type PlatformContext,
  type PolicyFixtureName,
} from './context.js';
import { createPlatformServer, type CreatePlatformServerOptions } from '../server.js';

export interface CreatePlatformRuntimeOptions {
  mode?: 'memory' | 'postgres';
  memory?: CreateMemoryPlatformContextOptions;
  postgres?: CreatePostgresPlatformContextOptions;
  server?: CreatePlatformServerOptions;
  listen?: { port: number; host?: string };
}

export interface PlatformRuntimeHandle {
  ctx: PlatformContext;
  app?: FastifyInstance;
  listen(opts?: { port: number; host?: string }): Promise<FastifyInstance>;
  close(): Promise<void>;
}

function resolveMode(opts: CreatePlatformRuntimeOptions): 'memory' | 'postgres' {
  if (opts.mode) return opts.mode;
  if (process.env.PLATFORM_MODE === 'postgres') return 'postgres';
  return 'memory';
}

function namedDemoFixture(): PolicyFixtureName | undefined {
  const raw = process.env.PLATFORM_POLICY_FIXTURE;
  if (raw === 'allow-all' || raw === 'deny-all') return raw;
  return undefined;
}

/**
 * Build a ready platform. Does not bind a port until `listen()`.
 */
export async function createPlatformRuntime(
  opts: CreatePlatformRuntimeOptions = {},
): Promise<PlatformRuntimeHandle> {
  const mode = resolveMode(opts);
  let ctx: PlatformContext;

  if (mode === 'postgres') {
    const pg = { ...(opts.postgres ?? {}) };
    if (!pg.policy && !pg.authorizer && !pg.overlay && !pg.policyFixture) {
      const envFixture = namedDemoFixture();
      if (envFixture) pg.policyFixture = envFixture;
    }
    ctx = await createPostgresPlatformContext(pg);
  } else {
    const mem = { ...(opts.memory ?? {}) };
    if (!mem.policy && !mem.authorizer && !mem.overlay && !mem.policyFixture) {
      const envFixture = namedDemoFixture();
      if (envFixture) mem.policyFixture = envFixture;
    }
    ctx = createMemoryPlatformContext(mem);
  }

  let app: FastifyInstance | undefined;

  const handle: PlatformRuntimeHandle = {
    ctx,
    get app() {
      return app;
    },
    async listen(listenOpts) {
      if (!ctx.ready) {
        throw new Error('listen refused: platform is not ready');
      }
      const built = await createPlatformServer(ctx, opts.server ?? {});
      app = built.app;
      const port = listenOpts?.port ?? opts.listen?.port;
      if (port === undefined) {
        throw new Error('listen requires port');
      }
      await app.listen({ port, host: listenOpts?.host ?? opts.listen?.host ?? '0.0.0.0' });
      return app;
    },
    async close() {
      ctx.ready = false;
      if (app) {
        await app.close();
        app = undefined;
      }
      await ctx.close?.();
      if (typeof ctx.policy.close === 'function') {
        await ctx.policy.close();
      }
    },
  };
  return handle;
}
