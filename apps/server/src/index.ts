import { Elysia } from 'elysia';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { validateAuthEnv } from './auth/env';
import { initDb } from './db/client';
import { scanResources } from './routes/resources';
import { tasksRoutes } from './routes/tasks';
import { githubRoutes, startGithubPolling } from './routes/github';
import { authRoutes } from './auth';
import { projectsRoutes } from './routes/projects';
import { harnessesRoutes } from './routes/harnesses';
import { agentsRoutes } from './routes/agents';
import { sessionsRoutes, loadSessionsFromDb } from './routes/sessions';
import { resourcesRoutes } from './routes/resources';
import { filesRoutes, filesBaseRoutes } from './routes/files';
import { wsRoutes } from './ws/handler';
import { getPtyManager } from './pty/manager';

const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

function isProduction(): boolean {
  const env = typeof Bun !== 'undefined' ? Bun.env.NODE_ENV : process.env.NODE_ENV;
  return env === 'production';
}

// Validate required environment variables before starting
validateAuthEnv();

// Initialize database before starting the server
try {
  initDb();
} catch (err) {
  console.error('[server] failed to initialize database:', err);
  process.exit(1);
}

// Restore session metadata persisted from the previous run
loadSessionsFromDb();

// Scan opencode resources on boot
try {
  const count = scanResources().length;
  console.log(`[server] scanned ${count} opencode resources`);
} catch (err) {
  console.warn('[server] resource scan failed (non-fatal):', (err as Error).message);
}

// ── Static file serving helpers (production only) ──
const webDistPath = join(process.cwd(), 'apps/web/dist');
const webDistExists = isProduction() && existsSync(webDistPath);

if (webDistExists) {
  console.log(`[server] serving static files from ${webDistPath}`);
} else if (isProduction()) {
  console.warn(`[server] production mode but web dist not found at ${webDistPath}. Run "bun run build:web" first.`);
}

function serveFile(filePath: string): Response {
  const file = Bun.file(filePath);
  const headers: Record<string, string> = {};
  if (filePath.endsWith('.webmanifest')) headers['Content-Type'] = 'application/manifest+json';
  if (filePath.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
  return new Response(file, { headers });
}

function serveIndex(): Response {
  return new Response(Bun.file(join(webDistPath, 'index.html')), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function spaFallback(request: Request): Response | undefined {
  if (!webDistExists) return undefined;
  if (request.method !== 'GET') return undefined;
  const pathname = new URL(request.url).pathname;
  const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const filePath = join(webDistPath, relativePath);
  if (existsSync(filePath)) {
    try { return serveFile(filePath); } catch { /* fall through */ }
  }
  if (existsSync(join(webDistPath, 'index.html'))) return serveIndex();
  return undefined;
}

// ── App — onError registered FIRST so it applies to all plugins ──
const app = new Elysia()
  .onError(({ code, request, set }) => {
    if (code !== 'NOT_FOUND') return;
    const res = spaFallback(request);
    if (res) { set.status = 200; return res; }
  });

// Static file routes registered before API plugins so they take precedence.
// Elysia's onError catches truly unmatched paths (SPA routes), but known
// static directories need explicit routes because file-extension paths can
// get swallowed by Bun's native router before lifecycle hooks fire.
if (webDistExists) {
  app
    .get('/', () => serveIndex())
    .get('/assets/:file', ({ params }) => {
      const filePath = join(webDistPath, 'assets', params.file);
      if (existsSync(filePath)) return serveFile(filePath);
      return new Response('Not Found', { status: 404 });
    });

  // Root-level static files emitted by Vite/PWA plugin
  const rootStatics = [
    'manifest.webmanifest', 'registerSW.js', 'sw.js',
    'icon.svg', 'icon-192.png', 'icon-512.png',
  ];
  for (const filename of rootStatics) {
    const filePath = join(webDistPath, filename);
    if (existsSync(filePath)) {
      app.get(`/${filename}`, () => serveFile(filePath));
    }
  }
  // workbox chunk — filename contains a content hash, match by prefix
  const workboxFile = readdirSync(webDistPath).find((f) => f.startsWith('workbox-'));
  if (workboxFile) {
    app.get(`/${workboxFile}`, () => serveFile(join(webDistPath, workboxFile)));
  }
}

app
  .use(authRoutes)
  .use(projectsRoutes)
  .use(harnessesRoutes)
  .use(sessionsRoutes)
  .use(tasksRoutes)
  .use(agentsRoutes)
  .use(resourcesRoutes)
  .use(filesRoutes)
  .use(filesBaseRoutes)
  .use(githubRoutes)
  .use(wsRoutes);

if (isProduction()) {
  app.get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
} else {
  app.get('/', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}

// Observability — server metrics + db stats
app.get('/api/status', () => {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    runtime: typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`,
    timestamp: new Date().toISOString(),
  };
});

// Deploy webhook — triggered by GitHub Actions on push to main.
// Protected by DEPLOY_TOKEN; set this in .env and as GitHub secret.
// Runs the deploy sequence in background so the response is sent before
// pm2 restart kills this process.
app.post('/api/deploy', async ({ request, set }) => {
  const token = request.headers.get('x-deploy-token');
  if (!token || token !== process.env.DEPLOY_TOKEN) {
    set.status = 401;
    return { error: 'unauthorized' };
  }

  const DEPLOY_SCRIPT = `
    cd "$HOME/code_projects/opencode-dashboard" || exit 1
    git pull origin main || exit 1
    bun install --frozen-lockfile || exit 1
    bun run build || exit 1
    pm2 restart opencode-dashboard
  `;

  // Fire and forget — the response goes out before the shell finishes
  Bun.spawn({ cmd: ['sh', '-c', DEPLOY_SCRIPT], stdout: 'ignore', stderr: 'ignore' });

  return { status: 'deploy_started' };
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  getPtyManager().startStatusMonitor(1000);
  startGithubPolling();
});
