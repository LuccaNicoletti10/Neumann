import { defineConfig } from 'vitest/config';

// WHY: certification/E2E PG suites under gate:core parallel load exceed default 5s.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
