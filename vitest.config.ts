import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    bail: 1,
    retry: 2,
    // apps/pty-worker é EXCLUÍDO — roda em Node.js isolado (node-pty nativo não roda em Bun)
    // Execute separadamente: cd apps/pty-worker && bunx vitest run
    projects: ['apps/server', 'apps/web'],
  },
});
