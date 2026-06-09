module.exports = {
  apps: [
    // ── Produção ────────────────────────────────────────────────
    {
      name: 'opencode-dashboard',
      cwd: '/root/code_projects/opencode-dashboard-dev',
      script: 'apps/server/dist/index.js',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        SERVER_PORT: '3001',
        DATABASE_PATH: './data/opencode.db',
        // Secrets: AUTH_PASSWORD + JWT_SECRET must be in the shell
        // environment. Source your .env or export them before pm2 start.
      },
      max_memory_restart: '1536M', // 1.5GB — headroom for SQLite WAL + PTY workers
      min_uptime: 60000,            // process must live ≥60s to count as healthy
      max_restarts: 5,              // stop restarting after 5 crashes — prevents crash-loop DB degradation
      error_file: './logs/prod-err.log',
      out_file: './logs/prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_size: '10M',
      retain: 5,
      autorestart: true,
      watch: false,
    },

    // ── Desenvolvimento ─────────────────────────────────────────
    // Diretório isolado: /root/code_projects/opencode-dashboard-dev
    {
      name: 'opencode-dashboard-dev',
      cwd: '/root/code_projects/opencode-dashboard-dev',
      script: 'apps/server/src/index.ts',
      interpreter: 'bun',
      interpreter_args: '--watch',
      env: {
        NODE_ENV: 'development',
        SERVER_PORT: '3002',
        DATABASE_PATH: './data/opencode_dev.db',
        // Secrets: AUTH_PASSWORD + JWT_SECRET must be in the shell
        // environment. Source your .env or export them before pm2 start.
      },
      max_memory_restart: '1536M',
      error_file: '/root/code_projects/opencode-dashboard-dev/logs/dev-err.log',
      out_file: '/root/code_projects/opencode-dashboard-dev/logs/dev-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_size: '10M',
      retain: 5,
      autorestart: true,
      watch: false,
    },
  ],
};
