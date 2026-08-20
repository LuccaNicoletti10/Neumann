import { defineConfig } from 'vitest/config';

// WHY: PG Function runtime under gate:core parallel load exceeds default 5s.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
