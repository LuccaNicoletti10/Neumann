/**
 * platform-api — ingestion worker process (ADR-0017).
 * Starts only after postgres context is ready. Separate from HTTP listen.
 */

import { createPlatformRuntime } from './core/bootstrap.js';
import { startIngestionWorker } from './core/ingestion-worker-main.js';

await startIngestionWorker({
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
