/**
 * platform-api — Function worker process (ADR-0019).
 * Starts only after postgres context is ready. Separate from HTTP listen.
 */

import { createPlatformRuntime } from '../src/core/bootstrap.js';
import { startFunctionWorker } from '../src/core/function-worker-main.js';

await startFunctionWorker({
  createRuntime: () => createPlatformRuntime({ mode: 'postgres' }),
  on: (event, handler) => {
    process.on(event, handler);
  },
  exit: (code) => {
    process.exit(code);
  },
  logError: (message) => {
    console.error(message);
  },
});
