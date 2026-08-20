import { defineConfig } from 'vitest/config';

// WHY: tryOpenIsolatedPg applies 0001–0026; under gate:core parallel PG load, 5s is insufficient.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
