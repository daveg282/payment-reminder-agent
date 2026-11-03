import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    // API tests share one test database, so files must not run in parallel.
    fileParallelism: false,
    // The test database is remote (Supabase), so DB-backed tests need more than the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
