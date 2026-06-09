import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Map Bun's built-in sqlite to a better-sqlite3 wrapper for Vitest (Node.js)
      'bun:sqlite': new URL('src/db/__mocks__/bun-sqlite.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
