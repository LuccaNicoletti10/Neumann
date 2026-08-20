/**
 * platform-api — src/cli.ts
 *
 * Named policy fixture via PLATFORM_POLICY_FIXTURE=allow-all|deny-all.
 * Postgres with no fixture loads the durable overlay (empty = deny).
 */

import { createPlatformRuntime } from './core/bootstrap.js';

const port = Number(process.env.PORT ?? 8080);

try {
  const runtime = await createPlatformRuntime({
    listen: { port, host: '0.0.0.0' },
  });
  const app = await runtime.listen({ port, host: '0.0.0.0' });
  const close = async () => {
    await runtime.close();
  };
  process.on('SIGINT', () => {
    void close().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void close().then(() => process.exit(0));
  });
  console.log(`Neumann platform-api listening on :${port} (${runtime.ctx.mode})`);
  void app;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`platform-api bootstrap failed: ${message}`);
  process.exit(1);
}
