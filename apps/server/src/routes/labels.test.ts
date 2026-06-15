import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

describe('labels routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let testDir: string;
  let projectId: string;
  let token: string;

  async function getToken(): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct-password' }),
      }),
    );
    const body = (await res.json()) as { token: string };
    return body.token;
  }

  function authReq(
    tkn: string,
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const { method = 'GET', body, headers = {} } = options;
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tkn}`,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function createProject() {
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: { name: `test-project-${Date.now()}-${Math.random()}`, directory: testDir },
      }),
    );
    return (await res.json()) as { id: string; name: string };
  }

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    testDir = mkdtempSync(join(tmpdir(), 'opencode-test-labels-'));

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { labelsRoutes } = await import('./labels');
    app = new Elysia().use(authRoutes).use(projectsRoutes).use(labelsRoutes);

    token = await getToken();
    const project = await createProject();
    projectId = project.id;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /* ── Auth protection ── */
  describe('auth protection', () => {
    it('returns 401 without token on list', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/labels`),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 without token on create', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'bug', color: '#f00' }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 without token on delete', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/labels/fake', { method: 'DELETE' }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ── POST create ── */
  describe('POST /api/projects/:id/labels', () => {
    it('creates a label and returns 201', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'bug', color: '#ff0000' },
        }),
      );
      expect(res.status).toBe(201);
      const label = (await res.json()) as {
        id: string;
        projectId: string;
        name: string;
        color: string;
      };
      expect(label.name).toBe('bug');
      expect(label.color).toBe('#ff0000');
      expect(label.projectId).toBe(projectId);
      expect(label.id).toBeTruthy();
    });

    it('accepts 3-digit hex color', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'feature', color: '#0f0' },
        }),
      );
      expect(res.status).toBe(201);
    });

    it('trims whitespace from name', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: '  spaced  ', color: '#abc' },
        }),
      );
      const label = (await res.json()) as { name: string };
      expect(label.name).toBe('spaced');
    });

    it('rejects empty name with 400', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: '   ', color: '#abc' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects invalid color with 400', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'bad', color: 'red' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects color without # prefix', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'bad2', color: 'ff0000' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects color with invalid length', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'bad3', color: '#ff00' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate name (case-insensitive)', async () => {
      await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'Bug', color: '#f00' },
        }),
      );
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'bug', color: '#0f0' },
        }),
      );
      expect(res.status).toBe(409);
    });

    it('returns 404 for unknown project', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/nonexistent/labels`, {
          method: 'POST',
          body: { name: 'x', color: '#000' },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── GET list ── */
  describe('GET /api/projects/:id/labels', () => {
    it('lists labels for the project', async () => {
      await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'b-second', color: '#111' },
        }),
      );
      await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'a-first', color: '#222' },
        }),
      );
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`),
      );
      expect(res.status).toBe(200);
      const labels = (await res.json()) as Array<{ name: string }>;
      expect(labels).toHaveLength(2);
      // ordered by name COLLATE NOCASE
      expect(labels[0].name).toBe('a-first');
      expect(labels[1].name).toBe('b-second');
    });

    it('returns 404 for unknown project', async () => {
      const res = await app.handle(authReq(token, `/api/projects/nope/labels`));
      expect(res.status).toBe(404);
    });
  });

  /* ── PUT update ── */
  describe('PUT /api/labels/:id', () => {
    async function createLabel(name: string, color: string) {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name, color },
        }),
      );
      return (await res.json()) as { id: string };
    }

    it('updates name and color', async () => {
      const label = await createLabel('old', '#000');
      const res = await app.handle(
        authReq(token, `/api/labels/${label.id}`, {
          method: 'PUT',
          body: { name: 'new', color: '#fff' },
        }),
      );
      expect(res.status).toBe(200);
      const updated = (await res.json()) as { name: string; color: string };
      expect(updated.name).toBe('new');
      expect(updated.color).toBe('#fff');
    });

    it('rejects invalid color on update', async () => {
      const label = await createLabel('clr', '#000');
      const res = await app.handle(
        authReq(token, `/api/labels/${label.id}`, {
          method: 'PUT',
          body: { color: 'notacolor' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects empty name on update', async () => {
      const label = await createLabel('nm', '#000');
      const res = await app.handle(
        authReq(token, `/api/labels/${label.id}`, {
          method: 'PUT',
          body: { name: '  ' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 409 when renaming to an existing name', async () => {
      await createLabel('existing', '#000');
      const other = await createLabel('other', '#111');
      const res = await app.handle(
        authReq(token, `/api/labels/${other.id}`, {
          method: 'PUT',
          body: { name: 'existing' },
        }),
      );
      expect(res.status).toBe(409);
    });

    it('returns 404 for unknown label', async () => {
      const res = await app.handle(
        authReq(token, `/api/labels/nope`, {
          method: 'PUT',
          body: { name: 'x' },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── DELETE ── */
  describe('DELETE /api/labels/:id', () => {
    it('deletes a label', async () => {
      const createRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'todelete', color: '#000' },
        }),
      );
      const label = (await createRes.json()) as { id: string };
      const res = await app.handle(
        authReq(token, `/api/labels/${label.id}`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // gone from list
      const listRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`),
      );
      const labels = (await listRes.json()) as unknown[];
      expect(labels).toHaveLength(0);
    });

    it('returns 404 for unknown label', async () => {
      const res = await app.handle(
        authReq(token, `/api/labels/nope`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('cascade deletes task_labels rows when label removed', async () => {
      const { getDb } = await import('../db/client');
      const db = getDb();

      // create a task and a label, apply the label
      db.run(
        `INSERT INTO tasks (id, project_id, title, source, "column", sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'local', 'backlog', 0, ?, ?)`,
        ['task-cascade', projectId, 'Cascade task', '2020-01-01', '2020-01-01'],
      );
      const createRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/labels`, {
          method: 'POST',
          body: { name: 'cascade-label', color: '#000' },
        }),
      );
      const label = (await createRes.json()) as { id: string };
      db.run('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)', [
        'task-cascade',
        label.id,
      ]);

      // sanity: row exists
      const before = db
        .query('SELECT COUNT(*) as c FROM task_labels WHERE label_id = ?')
        .get(label.id) as { c: number };
      expect(before.c).toBe(1);

      await app.handle(authReq(token, `/api/labels/${label.id}`, { method: 'DELETE' }));

      const after = db
        .query('SELECT COUNT(*) as c FROM task_labels WHERE label_id = ?')
        .get(label.id) as { c: number };
      expect(after.c).toBe(0);
    });
  });
});
