/**
 * platform-api — src/server.ts
 */

import Fastify from 'fastify';

import { createPlatformContext, type PlatformContext } from './core/context.js';
import { registerV2Routes } from './routes/v2.js';

export async function createPlatformServer(ctx?: PlatformContext) {
  const context = ctx ?? createPlatformContext();
  const app = Fastify({ logger: false });
  await registerV2Routes(app, context);
  return { app, ctx: context };
}
