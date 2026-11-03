import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    // API tests share one test database, so files must not run in parallel.
    fileParallelism: false,
  },
});
