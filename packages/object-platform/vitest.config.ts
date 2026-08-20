import { defineConfig } from 'vitest/config';

// WHY: migration apply through 0026 under concurrent gate:core PG load exceeds default 5s.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
