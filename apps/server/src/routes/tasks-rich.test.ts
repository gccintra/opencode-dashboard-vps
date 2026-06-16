/**
 * Tests for the rich-task extensions: labels apply, attachments
 * (upload/serve/delete + path traversal), session association, and the
 * implement prompt injection.
 *
 * The PTY manager is mocked so we can control session status and assert
 * on writeToSession without spawning a real worker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock the PTY manager (controllable session status + write spy) ──
const ptyState: { status: string | null; writes: Array<{ id: string; data: string }> } = {
  status: 'active',
  writes: [],
};

vi.mock('../pty/manager', () => {
  return {
    getPtyManager: () => ({
      getSessionStatus: () => ptyState.status,
      writeToSession: (id: string, data: string) => {
        ptyState.writes.push({ id, data });
      },
    }),
  };
});

const OLD_ENV = { ...process.env };

describe('tasks rich extensions', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let dataDir: string;
  let projectDir: string;
  let projectId: string;
  let token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessions: any;

  async function getToken(): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct-password' }),
      }),
    );
    return ((await res.json()) as { token: string }).token;
  }

  function authReq(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      raw?: FormData;
    } = {},
  ) {
    const { method = 'GET', body, headers = {}, raw } = options;
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  }

  async function createProject() {
    const res = await app.handle(
      authReq('/api/projects', {
        method: 'POST',
        body: { name: `rich-${Date.now()}-${Math.random()}`, directory: projectDir },
      }),
    );
    return (await res.json()) as { id: string };
  }

  async function createTask(): Promise<string> {
    const res = await app.handle(
      authReq(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: { title: 'Rich task', description: 'body **markdown**' },
      }),
    );
    return ((await res.json()) as { id: string }).id;
  }

  async function createLabel(name: string): Promise<string> {
    const res = await app.handle(
      authReq('/api/labels', {
        method: 'POST',
        body: { name, color: '#0a0' },
      }),
    );
    return ((await res.json()) as { id: string }).id;
  }

  beforeEach(async () => {
    vi.resetModules();
    ptyState.status = 'active';
    ptyState.writes = [];

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    // Point the neutral data dir at a temp directory via DATABASE_PATH.
    dataDir = mkdtempSync(join(tmpdir(), 'opencode-rich-data-'));
    process.env.DATABASE_PATH = join(dataDir, 'opencode.db');

    projectDir = mkdtempSync(join(tmpdir(), 'opencode-rich-proj-'));

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { tasksRoutes } = await import('./tasks');
    const { labelsRoutes } = await import('./labels');
    sessions = await import('./sessions');
    sessions.resetSessionMeta();

    app = new Elysia()
      .use(authRoutes)
      .use(projectsRoutes)
      .use(tasksRoutes)
      .use(labelsRoutes);

    token = await getToken();
    const project = await createProject();
    projectId = project.id;
    // Activate fake timers AFTER all async setup so module imports
    // and promise resolution use real timers during initialization.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = OLD_ENV;
    for (const d of [dataDir, projectDir]) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  /* ── Enriched toTask shape ── */
  describe('enriched task shape', () => {
    it('includes labels, attachments, and sessionStatus fields', async () => {
      const taskId = await createTask();
      const res = await app.handle(authReq(`/api/projects/${projectId}/tasks`));
      const tasks = (await res.json()) as Array<{
        id: string;
        labels: unknown[];
        attachments: unknown[];
        sessionStatus: string | null;
      }>;
      const task = tasks.find((t) => t.id === taskId)!;
      expect(Array.isArray(task.labels)).toBe(true);
      expect(Array.isArray(task.attachments)).toBe(true);
      expect(task.sessionStatus).toBeNull();
    });
  });

  /* ── PUT /api/tasks/:id/labels ── */
  describe('PUT /api/tasks/:id/labels', () => {
    it('applies labels to a task', async () => {
      const taskId = await createTask();
      const l1 = await createLabel('bug');
      const l2 = await createLabel('feature');
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, {
          method: 'PUT',
          body: { labelIds: [l1, l2] },
        }),
      );
      expect(res.status).toBe(200);
      const task = (await res.json()) as { labels: Array<{ id: string; name: string }> };
      expect(task.labels).toHaveLength(2);
      const names = task.labels.map((l) => l.name).sort();
      expect(names).toEqual(['bug', 'feature']);
    });

    it('replaces the previous label set', async () => {
      const taskId = await createTask();
      const l1 = await createLabel('one');
      const l2 = await createLabel('two');
      await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, { method: 'PUT', body: { labelIds: [l1] } }),
      );
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, { method: 'PUT', body: { labelIds: [l2] } }),
      );
      const task = (await res.json()) as { labels: Array<{ id: string }> };
      expect(task.labels).toHaveLength(1);
      expect(task.labels[0].id).toBe(l2);
    });

    it('clears labels with empty array', async () => {
      const taskId = await createTask();
      const l1 = await createLabel('temp');
      await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, { method: 'PUT', body: { labelIds: [l1] } }),
      );
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, { method: 'PUT', body: { labelIds: [] } }),
      );
      const task = (await res.json()) as { labels: unknown[] };
      expect(task.labels).toHaveLength(0);
    });

    it('allows any global label to be applied to any task', async () => {
      const taskId = await createTask();
      // Labels are global — create one and apply it
      const globalLabel = await createLabel('global-tag');
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, {
          method: 'PUT',
          body: { labelIds: [globalLabel] },
        }),
      );
      expect(res.status).toBe(200);
      const task = (await res.json()) as { labels: Array<{ id: string; name: string }> };
      expect(task.labels).toHaveLength(1);
      expect(task.labels[0].name).toBe('global-tag');
    });

    it('returns 404 for unknown task', async () => {
      const res = await app.handle(
        authReq(`/api/tasks/nope/labels`, { method: 'PUT', body: { labelIds: [] } }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── Attachments ── */
  describe('attachments', () => {
    function fileForm(name: string, type: string, content = 'hello'): FormData {
      const fd = new FormData();
      fd.append('file', new File([content], name, { type }));
      return fd;
    }

    it('uploads an attachment and returns 201', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('shot.png', 'image/png'),
        }),
      );
      expect(res.status).toBe(201);
      const att = (await res.json()) as {
        id: string;
        filename: string;
        mime: string;
        size: number;
      };
      expect(att.filename).toBe('shot.png');
      expect(att.mime).toBe('image/png');
      expect(att.size).toBeGreaterThan(0);

      // file written to disk under <dataDir>/attachments/<taskId>
      const attDir = join(dataDir, 'attachments', taskId);
      expect(existsSync(attDir)).toBe(true);
      expect(readdirSync(attDir).length).toBe(1);
    });

    it('rejects unsupported mime type with 415', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('evil.exe', 'application/x-msdownload'),
        }),
      );
      expect(res.status).toBe(415);
    });

    it('rejects image/svg+xml uploads (stored-XSS vector) with 415', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('evil.svg', 'image/svg+xml', '<svg><script>alert(1)</script></svg>'),
        }),
      );
      expect(res.status).toBe(415);
    });

    it('rejects oversized file with 413', async () => {
      const taskId = await createTask();
      const big = 'x'.repeat(11 * 1024 * 1024);
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('big.png', 'image/png', big),
        }),
      );
      expect(res.status).toBe(413);
    });

    it('lists attachments', async () => {
      const taskId = await createTask();
      await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('a.png', 'image/png'),
        }),
      );
      const res = await app.handle(authReq(`/api/tasks/${taskId}/attachments`));
      expect(res.status).toBe(200);
      const list = (await res.json()) as unknown[];
      expect(list).toHaveLength(1);
    });

    it('serves the binary with correct Content-Type', async () => {
      const taskId = await createTask();
      const up = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('a.png', 'image/png', 'PNGDATA'),
        }),
      );
      const att = (await up.json()) as { id: string };
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments/${att.id}`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      // Defense-in-depth: serve handler must always set nosniff.
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const text = await res.text();
      expect(text).toBe('PNGDATA');
    });

    it('returns 404 serving an unknown attachment', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments/nope`),
      );
      expect(res.status).toBe(404);
    });

    it('deletes an attachment (row + file)', async () => {
      const taskId = await createTask();
      const up = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          raw: fileForm('a.png', 'image/png'),
        }),
      );
      const att = (await up.json()) as { id: string };
      const attDir = join(dataDir, 'attachments', taskId);
      expect(readdirSync(attDir).length).toBe(1);

      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments/${att.id}`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: true });
      expect(readdirSync(attDir).length).toBe(0);
    });

    it('rejects path traversal in stored rel_path (defense in depth)', async () => {
      const taskId = await createTask();
      const { getDb } = await import('../db/client');
      const db = getDb();
      // Inject a malicious rel_path directly into the DB row
      db.run(
        `INSERT INTO task_attachments (id, task_id, filename, rel_path, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['evil-att', taskId, 'evil', '../../../../etc/passwd', 'text/plain', 1, '2020-01-01'],
      );
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/attachments/evil-att`),
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 uploading to unknown task', async () => {
      const res = await app.handle(
        authReq(`/api/tasks/nope/attachments`, {
          method: 'POST',
          raw: fileForm('a.png', 'image/png'),
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── PUT /api/tasks/:id/session ── */
  describe('PUT /api/tasks/:id/session', () => {
    function injectSession(sessionId: string, pid: string) {
      sessions.setSessionMeta(sessionId, {
        sessionId,
        projectId: pid,
        name: 'S1',
        status: 'active',
        type: 'project',
        createdAt: Date.now(),
      });
    }

    it('associates a session that belongs to the project', async () => {
      const taskId = await createTask();
      injectSession('sess-1', projectId);
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: 'sess-1' },
        }),
      );
      expect(res.status).toBe(200);
      const task = (await res.json()) as { sessionId: string };
      expect(task.sessionId).toBe('sess-1');
    });

    it('dissociates with null', async () => {
      const taskId = await createTask();
      injectSession('sess-1', projectId);
      await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: 'sess-1' },
        }),
      );
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: null },
        }),
      );
      expect(res.status).toBe(200);
      const task = (await res.json()) as { sessionId: string | null };
      expect(task.sessionId).toBeNull();
    });

    it('rejects a session from a different project with 400', async () => {
      const taskId = await createTask();
      injectSession('sess-other', 'different-project');
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: 'sess-other' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects an unknown session with 400', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: 'ghost' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown task', async () => {
      const res = await app.handle(
        authReq(`/api/tasks/nope/session`, {
          method: 'PUT',
          body: { sessionId: null },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── POST /api/tasks/:id/implement ── */
  describe('POST /api/tasks/:id/implement', () => {
    async function associate(taskId: string) {
      sessions.setSessionMeta('live-sess', {
        sessionId: 'live-sess',
        projectId,
        name: 'S1',
        status: 'active',
        type: 'project',
        createdAt: Date.now(),
      });
      await app.handle(
        authReq(`/api/tasks/${taskId}/session`, {
          method: 'PUT',
          body: { sessionId: 'live-sess' },
        }),
      );
    }

    it('returns 409 when no session is associated', async () => {
      const taskId = await createTask();
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }),
      );
      expect(res.status).toBe(409);
      expect(ptyState.writes).toHaveLength(0);
    });

    it('returns 409 when the associated session has expired', async () => {
      const taskId = await createTask();
      await associate(taskId);
      ptyState.status = null; // session gone from manager
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }),
      );
      expect(res.status).toBe(409);
      expect(ptyState.writes).toHaveLength(0);
    });

    it('injects a prompt and returns started when session is live', async () => {
      const taskId = await createTask();
      await associate(taskId);
      ptyState.status = 'active';
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()) as { started: boolean }).toEqual({ started: true });
      // First write is the prompt text; the \r fires after the 50ms inner timer.
      expect(ptyState.writes).toHaveLength(1);
      expect(ptyState.writes[0].id).toBe('live-sess');
      expect(ptyState.writes[0].data).toContain('Rich task');
      vi.advanceTimersByTime(50);
      expect(ptyState.writes).toHaveLength(2);
      expect(ptyState.writes[1].data).toBe('\r');
    });

    it('includes attachment absolute paths in the prompt', async () => {
      const taskId = await createTask();
      const fd = new FormData();
      fd.append('file', new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
      await app.handle(
        authReq(`/api/tasks/${taskId}/attachments`, { method: 'POST', raw: fd }),
      );
      await associate(taskId);
      ptyState.status = 'active';
      await app.handle(authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }));
      expect(ptyState.writes[0].data).toContain('doc.pdf');
      expect(ptyState.writes[0].data).toContain(join('attachments', taskId));
    });

    it('returns 404 for unknown task', async () => {
      const res = await app.handle(
        authReq(`/api/tasks/nope/implement`, { method: 'POST' }),
      );
      expect(res.status).toBe(404);
    });

    it('prefixes a slash-command when the task uses a claude command', async () => {
      const taskId = await createTask();
      await app.handle(
        authReq(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: 'claude', agentSource: 'commands', agentName: 'plan' },
        }),
      );
      await associate(taskId);
      ptyState.status = 'active';
      await app.handle(authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }));
      expect(ptyState.writes).toHaveLength(1);
      expect(ptyState.writes[0].data.startsWith('/plan ')).toBe(true);
    });

    it('does NOT prefix a slash-command for an agent source', async () => {
      const taskId = await createTask();
      await app.handle(
        authReq(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: 'claude', agentSource: 'agents', agentName: 'executor' },
        }),
      );
      await associate(taskId);
      ptyState.status = 'active';
      await app.handle(authReq(`/api/tasks/${taskId}/implement`, { method: 'POST' }));
      expect(ptyState.writes[0].data.startsWith('/')).toBe(false);
    });

    it('defers the prompt write by delayMs and reports it', async () => {
      const taskId = await createTask();
      await associate(taskId);
      ptyState.status = 'active';
      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/implement`, { method: 'POST', body: { delayMs: 120 } }),
      );
      expect((await res.json()) as { delayedMs?: number }).toMatchObject({
        started: true,
        delayedMs: 120,
      });
      // Not written yet — the delayMs=120 outer timer hasn't fired.
      expect(ptyState.writes).toHaveLength(0);
      vi.advanceTimersByTime(120); // fires outer delay → text write
      expect(ptyState.writes).toHaveLength(1);
      vi.advanceTimersByTime(50);  // fires inner 50ms → \r write
      expect(ptyState.writes).toHaveLength(2);
      expect(ptyState.writes[1].data).toBe('\r');
    });
  });

  /* ── GET /api/projects/:id/agent-catalog ── */
  describe('GET /api/projects/:id/agent-catalog', () => {
    function writeAgent(rel: string, name: string, body: string) {
      const dir = join(projectDir, rel);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${name}.md`), body, 'utf-8');
    }

    it('lists opencode built-ins plus project agents and claude agents/commands', async () => {
      writeAgent('.opencode/agent', 'custom-agent', '---\nname: custom-agent\n---\nDoes custom stuff');
      writeAgent('.claude/agents', 'executor', '# Executor\n\nImplements code');
      writeAgent('.claude/commands', 'deploy', '---\n---\nDeploy the work');

      const res = await app.handle(authReq(`/api/projects/${projectId}/agent-catalog`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        opencode: { agents: Array<{ name: string; description: string }> };
        claude: {
          agents: Array<{ name: string }>;
          commands: Array<{ name: string }>;
        };
      };
      // Always has build + plan built-ins
      const names = body.opencode.agents.map((a) => a.name);
      expect(names).toContain('build');
      expect(names).toContain('plan');
      expect(names).toContain('custom-agent');
      expect(body.claude.agents.map((a) => a.name)).toContain('executor');
      expect(body.claude.commands.map((a) => a.name)).toContain('deploy');
    });

    it('returns built-in opencode agents even when project has no agent dirs', async () => {
      const res = await app.handle(authReq(`/api/projects/${projectId}/agent-catalog`));
      const body = (await res.json()) as {
        opencode: { agents: Array<{ name: string }> };
        claude: { agents: unknown[]; commands: unknown[] };
      };
      const names = body.opencode.agents.map((a) => a.name);
      expect(names).toContain('build');
      expect(names).toContain('plan');
      expect(body.claude.agents).toEqual([]);
      expect(body.claude.commands).toEqual([]);
    });

    it('returns 404 for an unknown project', async () => {
      const res = await app.handle(authReq('/api/projects/nope/agent-catalog'));
      expect(res.status).toBe(404);
    });
  });

  /* ── GET /api/agent-models ── */
  describe('GET /api/agent-models', () => {
    it('returns the static claude model aliases', async () => {
      const res = await app.handle(authReq('/api/agent-models?runtime=claude'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { models: Array<{ id: string }> };
      expect(body.models.map((m) => m.id)).toContain('opus');
      expect(body.models.map((m) => m.id)).toContain('sonnet');
    });
  });
});
