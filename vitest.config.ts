import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    bail: 1,
    retry: 2,
    projects: ['apps/server', 'apps/web'],
  },
});
