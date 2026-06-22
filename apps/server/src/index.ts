import { Elysia } from 'elysia';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { validateAuthEnv } from './auth/env';
import { initDb, getDb, getDbPath, getDbIntegrityResult } from './db/client';
import { scanResources } from './routes/resources';
import { healthRoutes } from './routes/health';
import { tasksRoutes } from './routes/tasks';
import { labelsRoutes } from './routes/labels';
import { githubRoutes, startGithubPolling } from './routes/github';
import { authRoutes } from './auth';
import { projectsRoutes } from './routes/projects';
import { harnessesRoutes } from './routes/harnesses';
import { agentsRoutes } from './routes/agents';
import { sessionsRoutes, loadSessionsFromDb, reconcileTmuxSessions } from './routes/sessions';
import { tmuxAvailable, tmuxHasSession } from './pty/tmux';
import { resourcesRoutes } from './routes/resources';
import { filesRoutes, filesBaseRoutes } from './routes/files';
import { wsRoutes } from './ws/handler';
import { eventsWsRoutes } from './ws/events';
import { getPtyManager } from './pty/manager';
import { systemRoutes } from './routes/system';
import { canvasesRoutes } from './routes/canvases';
import { kanbanColumnsRoutes } from './routes/kanban-columns';
import { taskActivityRoutes } from './routes/task-activity';
import { taskLinksRoutes } from './routes/task-links';

const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

function isProduction(): boolean {
  const env = typeof Bun !== 'undefined' ? Bun.env.NODE_ENV : process.env.NODE_ENV;
  return env === 'production';
}

// Reduce OOM-killer priority so SSH/DBus are killed before this process
try {
  Bun.write('/proc/self/oom_score_adj', '-500');
} catch {
  /* non-fatal: may lack permission in some environments */
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
  console.warn(
    `[server] production mode but web dist not found at ${webDistPath}. Run "bun run build:web" first.`,
  );
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
    try {
      return serveFile(filePath);
    } catch {
      /* fall through */
    }
  }
  if (existsSync(join(webDistPath, 'index.html'))) return serveIndex();
  return undefined;
}

// ── App — onError registered FIRST so it applies to all plugins ──
const app = new Elysia().onError(({ code, request, set }) => {
  if (code !== 'NOT_FOUND') return;
  const res = spaFallback(request);
  if (res) {
    set.status = 200;
    return res;
  }
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
    'manifest.webmanifest',
    'registerSW.js',
    'sw.js',
    'icon.svg',
    'icon-192.png',
    'icon-512.png',
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
  .use(healthRoutes)
  .use(systemRoutes)
  .use(authRoutes)
  .use(projectsRoutes)
  .use(harnessesRoutes)
  .use(sessionsRoutes)
  .use(tasksRoutes)
  .use(labelsRoutes)
  .use(kanbanColumnsRoutes)
  .use(taskActivityRoutes)
  .use(taskLinksRoutes)
  .use(agentsRoutes)
  .use(resourcesRoutes)
  .use(filesRoutes)
  .use(filesBaseRoutes)
  .use(githubRoutes)
  .use(canvasesRoutes)
  .use(eventsWsRoutes)
  .use(wsRoutes);

// Observability — server metrics + db stats
app.get('/api/status', () => {
  const mem = process.memoryUsage();

  const dbPath = getDbPath();
  let walSizeBytes = 0;
  if (dbPath && dbPath !== ':memory:') {
    try {
      walSizeBytes = statSync(dbPath + '-wal').size;
    } catch {
      /* wal file absent */
    }
  }

  let sessionCount = 0;
  try {
    const row = getDb().query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    sessionCount = row.count;
  } catch {
    /* db not ready */
  }

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
    database: {
      path: dbPath,
      walSizeBytes,
      integrity: getDbIntegrityResult(),
      sessionCount,
    },
  };
});

/**
 * Worker-lost handler: when the pty-worker dies or is restarted (self-heal),
 * the tmux daemon keeps every session's processes alive. Re-attach each
 * session whose tmux session is still live (zero data loss — existing WS
 * connections keep streaming) and mark the rest exited.
 */
function installWorkerReattach(): void {
  const manager = getPtyManager();
  manager.setWorkerLostHandler(() => {
    void (async () => {
      const ids = manager.getReattachableSessions();
      if (ids.length === 0) return;
      console.error(`[server] worker lost — reattaching ${ids.length} tmux session(s)`);
      for (const id of ids) {
        try {
          if (await tmuxHasSession(id)) {
            await manager.reattachSession(id);
          } else {
            manager.markSessionExited(id);
          }
        } catch (err) {
          console.error(`[server] reattach failed for ${id}:`, (err as Error).message);
          manager.markSessionExited(id);
        }
      }
    })();
  });
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  getPtyManager().startStatusMonitor(1000);
  installWorkerReattach();
  startGithubPolling();

  // tmux-backed sessions survive a server restart. Verify tmux is reachable,
  // then reconcile in-memory/DB metadata with the live daemon (re-adopt live
  // sessions, reap orphans). Best-effort — never blocks startup.
  void (async () => {
    if (!(await tmuxAvailable())) {
      console.warn(
        '[server] tmux not available — sessions will NOT be resilient to worker/server restarts',
      );
      return;
    }
    await reconcileTmuxSessions();
  })();

  // Signal PM2 that the process is ready (required when wait_ready: true)
  if (typeof process.send === 'function') process.send('ready');
});
