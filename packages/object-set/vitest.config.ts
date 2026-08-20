import { defineConfig } from 'vitest/config';

// WHY: objectset parity/catalog PG under gate:core parallel load exceeds default 5s.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
