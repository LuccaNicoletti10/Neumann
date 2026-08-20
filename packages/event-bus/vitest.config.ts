import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // WHY: PG outbox/worker under gate:core parallel load exceeds default 5s.
    testTimeout: 30_000,
  },
});
