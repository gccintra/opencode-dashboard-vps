// ecosystem.config.example.cjs — template for production deployments
// Copy to ecosystem.config.cjs and fill in your environment-specific values.
// Never commit ecosystem.config.cjs — it is gitignored.
module.exports = {
  apps: [
    {
      name: 'opencode-dashboard',
      cwd: '/path/to/your/deployment',          // absolute path to the deployed repo
      script: 'apps/server/dist/index.js',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        SERVER_PORT: '3001',
        DATABASE_PATH: '/var/lib/opencode/opencode.db',  // outside the repo — safe from git pull
        // Hint Bun's GC heap limit to 1 GiB (prevents 100% heap usage with tiny default)
        BUN_JSC_forceRAMSize: '1073741824',
        // Secrets must come from .env or the shell environment:
        // AUTH_PASSWORD, JWT_SECRET, JWT_EXPIRY, DEPLOY_TOKEN
      },
      // 300 MB RSS threshold — Bun pre-allocates ~130 GB virtual space (V8 JIT),
      // so PM2's VmSize-based monitoring triggers false-positive restarts at lower values.
      max_memory_restart: '300M',
      min_uptime: 60000,     // process must live ≥60s to count as healthy
      max_restarts: 10,      // allows recovery from transient OOM spikes
      restart_delay: 5000,   // 5s cooldown between restarts — prevents cascade
      kill_timeout: 10000,   // 10s for PTY children to die gracefully
      kill_retry_time: 200,  // 200ms between SIGTERM retries
      wait_ready: true,      // wait for process.send('ready') after app.listen()
      listen_timeout: 30000, // 30s startup grace period
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
