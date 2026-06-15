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
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
      authReq(`/api/projects/${projectId}/labels`, {
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
  });

  afterEach(() => {
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

    it('rejects a label from a different project with 400', async () => {
      const taskId = await createTask();
      // create a second project + label
      const otherDir = mkdtempSync(join(tmpdir(), 'opencode-other-'));
      const otherRes = await app.handle(
        authReq('/api/projects', {
          method: 'POST',
          body: { name: `other-${Date.now()}`, directory: otherDir },
        }),
      );
      const otherProject = (await otherRes.json()) as { id: string };
      const otherLabelRes = await app.handle(
        authReq(`/api/projects/${otherProject.id}/labels`, {
          method: 'POST',
          body: { name: 'foreign', color: '#f00' },
        }),
      );
      const otherLabel = (await otherLabelRes.json()) as { id: string };

      const res = await app.handle(
        authReq(`/api/tasks/${taskId}/labels`, {
          method: 'PUT',
          body: { labelIds: [otherLabel.id] },
        }),
      );
      expect(res.status).toBe(400);
      rmSync(otherDir, { recursive: true, force: true });
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
      expect(ptyState.writes).toHaveLength(1);
      expect(ptyState.writes[0].id).toBe('live-sess');
      expect(ptyState.writes[0].data).toContain('Rich task');
      expect(ptyState.writes[0].data.endsWith('\n')).toBe(true);
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
  });
});
