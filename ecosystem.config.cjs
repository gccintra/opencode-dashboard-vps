module.exports = {
  apps: [
    // ── Produção ────────────────────────────────────────────────
    {
      name: 'opencode-dashboard',
      cwd: '/root/production/opencode-dashboard-vps',
      script: 'apps/server/dist/index.js',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        SERVER_PORT: '3001',
        DATABASE_PATH: '/root/production/opencode-dashboard-vps/data/opencode.db',
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
  ],
};
