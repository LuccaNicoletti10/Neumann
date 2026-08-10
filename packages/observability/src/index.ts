/**
 * observability — src/index.ts
 *
 * API publica: logger pino, tracing OTel, plugin Fastify, harness TM0.5 e
 * servidor demo para validacao do gate PASSO 2 / task 015.
 */

export * from './types.js';
export * from './logger.js';
export * from './tracing.js';
export * from './harness.js';
export {
  observabilityPlugin,
  registerObservabilityPlugin,
  type ObservabilityPluginOptions,
} from './fastify-plugin.js';
export {
  createDemoServer,
  startDemoServer,
  DEFAULT_DEMO_IDENTITY,
  type DemoServerOptions,
  type StartedDemoServer,
} from './demo-server.js';
