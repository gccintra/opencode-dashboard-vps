import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

describe('tasks routes', () => {
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
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
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
        body: { name: `test-project-${Date.now()}`, directory: testDir },
      }),
    );
    const body = (await res.json()) as { id: string; name: string };
    return body;
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

    testDir = mkdtempSync(join(tmpdir(), 'opencode-test-tasks-'));

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { tasksRoutes } = await import('./tasks');
    app = new Elysia().use(authRoutes).use(projectsRoutes).use(tasksRoutes);

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
    it('returns 401 without token on GET tasks', async () => {
      const res = await app.handle(new Request(`http://localhost/api/projects/${projectId}/tasks`));
      expect(res.status).toBe(401);
    });

    it('returns 401 without token on POST task', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test' }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 without token on PUT task', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/tasks/fake-id', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test' }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 without token on DELETE task', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/tasks/fake-id', { method: 'DELETE' }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ── POST /api/projects/:id/tasks ── */
  describe('POST /api/projects/:id/tasks', () => {
    it('creates a task and returns 201', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'My Task', description: 'Do the thing' },
        }),
      );
      expect(res.status).toBe(201);
      const task = (await res.json()) as {
        id: string;
        title: string;
        column: string;
        source: string;
      };
      expect(task.title).toBe('My Task');
      expect(task.column).toBe('backlog');
      expect(task.source).toBe('local');
    });

    it('saves task to SQLite database', async () => {
      const { getDb } = await import('../db/client');
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'DB Test' },
        }),
      );
      const task = (await res.json()) as { id: string };
      const db = getDb();
      const row = db.query('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<
        string,
        unknown
      > | null;
      expect(row).not.toBeNull();
      expect(row?.title).toBe('DB Test');
    });

    it('does not write a .md sidecar file on create', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'File Test' },
        }),
      );
      const task = (await res.json()) as { id: string };
      // The .opencode/tasks/*.md sidecar is no longer written — tasks live in SQLite.
      const mdPath = join(testDir, '.opencode', 'tasks', `${task.id}.md`);
      expect(existsSync(mdPath)).toBe(false);
    });

    it('returns 400 when title is empty', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: '' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent/tasks', {
          method: 'POST',
          body: { title: 'Test' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('defaults column to backlog', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Default Col' },
        }),
      );
      const task = (await res.json()) as { column: string };
      expect(task.column).toBe('backlog');
    });

    it('accepts custom column', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'In Progress Task', column: 'in_progress' },
        }),
      );
      const task = (await res.json()) as { column: string };
      expect(task.column).toBe('in_progress');
    });
  });

  /* ── GET /api/projects/:id/tasks ── */
  describe('GET /api/projects/:id/tasks', () => {
    it('returns tasks ordered by sort_order', async () => {
      await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'First' },
        }),
      );
      await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Second' },
        }),
      );

      const res = await app.handle(authReq(token, `/api/projects/${projectId}/tasks`));
      const tasks = (await res.json()) as Array<{ title: string }>;
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('First');
      expect(tasks[1].title).toBe('Second');
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.handle(authReq(token, '/api/projects/nonexistent/tasks'));
      expect(res.status).toBe(404);
    });

    it('returns empty array when no tasks', async () => {
      const res = await app.handle(authReq(token, `/api/projects/${projectId}/tasks`));
      const tasks = await res.json();
      expect(tasks).toEqual([]);
    });
  });

  /* ── GET /api/tasks (global) ── */
  describe('GET /api/tasks', () => {
    it('returns tasks from all projects with projectName', async () => {
      await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Global Task' },
        }),
      );

      const res = await app.handle(authReq(token, '/api/tasks'));
      const tasks = (await res.json()) as Array<{ title: string; projectName: string }>;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Global Task');
      expect(tasks[0].projectName).toBeTruthy();
    });
  });

  /* ── PUT /api/tasks/:id ── */
  describe('PUT /api/tasks/:id', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Original', description: 'desc' },
        }),
      );
      const task = (await res.json()) as { id: string };
      taskId = task.id;
    });

    it('updates title', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { title: 'Updated' },
        }),
      );
      const updated = (await res.json()) as { title: string };
      expect(updated.title).toBe('Updated');
    });

    it('updates description', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { description: 'new desc' },
        }),
      );
      const updated = (await res.json()) as { description: string };
      expect(updated.description).toBe('new desc');
    });

    it('does not write a .md sidecar file on edit', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { title: 'Edited Title' },
        }),
      );
      const updated = (await res.json()) as { title: string };
      expect(updated.title).toBe('Edited Title');
      // No .md sidecar — the edit is persisted only in SQLite.
      const mdPath = join(testDir, '.opencode', 'tasks', `${taskId}.md`);
      expect(existsSync(mdPath)).toBe(false);
    });

    it('returns 400 for empty title', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { title: '  ' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent task', async () => {
      const res = await app.handle(
        authReq(token, '/api/tasks/nonexistent', {
          method: 'PUT',
          body: { title: 'X' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('returns current state when no changes', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: {},
        }),
      );
      const task = (await res.json()) as { title: string };
      expect(task.title).toBe('Original');
    });
  });

  /* ── DELETE /api/tasks/:id ── */
  describe('DELETE /api/tasks/:id', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'To Delete' },
        }),
      );
      const task = (await res.json()) as { id: string };
      taskId = task.id;
    });

    it('deletes a task', async () => {
      const res = await app.handle(authReq(token, `/api/tasks/${taskId}`, { method: 'DELETE' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);
    });

    it('removes task from database', async () => {
      await app.handle(authReq(token, `/api/tasks/${taskId}`, { method: 'DELETE' }));
      const { getDb } = await import('../db/client');
      const db = getDb();
      const row = db.query('SELECT id FROM tasks WHERE id = ?').get(taskId);
      expect(row).toBeNull();
    });

    it('removes .md file', async () => {
      await app.handle(authReq(token, `/api/tasks/${taskId}`, { method: 'DELETE' }));
      const mdPath = join(testDir, '.opencode', 'tasks', `${taskId}.md`);
      expect(existsSync(mdPath)).toBe(false);
    });

    it('returns 404 for non-existent task', async () => {
      const res = await app.handle(authReq(token, '/api/tasks/nonexistent', { method: 'DELETE' }));
      expect(res.status).toBe(404);
    });
  });

  /* ── PUT /api/tasks/:id/move ── */
  describe('PUT /api/tasks/:id/move', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Movable' },
        }),
      );
      const task = (await res.json()) as { id: string };
      taskId = task.id;
    });

    it('moves task to in_progress', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/move`, {
          method: 'PUT',
          body: { column: 'in_progress' },
        }),
      );
      const task = (await res.json()) as { column: string };
      expect(task.column).toBe('in_progress');
    });

    it('moves task to done', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/move`, {
          method: 'PUT',
          body: { column: 'done' },
        }),
      );
      const task = (await res.json()) as { column: string };
      expect(task.column).toBe('done');
    });

    it('returns 400 for invalid column', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/move`, {
          method: 'PUT',
          body: { column: 'invalid' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent task', async () => {
      const res = await app.handle(
        authReq(token, '/api/tasks/nonexistent/move', {
          method: 'PUT',
          body: { column: 'done' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('does not write a .md sidecar file after move', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/move`, {
          method: 'PUT',
          body: { column: 'done' },
        }),
      );
      expect(res.status).toBe(200);
      // No .md sidecar — the move is persisted only in SQLite.
      const mdPath = join(testDir, '.opencode', 'tasks', `${taskId}.md`);
      expect(existsSync(mdPath)).toBe(false);
    });
  });

  /* ── PUT /api/tasks/:id/reorder ── */
  describe('PUT /api/tasks/:id/reorder', () => {
    it('changes sort_order', async () => {
      // Create two tasks
      const r1 = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'T1' },
        }),
      );
      const t1 = (await r1.json()) as { id: string };
      await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'T2' },
        }),
      );

      const res = await app.handle(
        authReq(token, `/api/tasks/${t1.id}/reorder`, {
          method: 'PUT',
          body: { sortOrder: 5 },
        }),
      );
      const task = (await res.json()) as { sortOrder: number };
      expect(task.sortOrder).toBe(5);
    });

    it('returns 404 for non-existent task', async () => {
      const res = await app.handle(
        authReq(token, '/api/tasks/nonexistent/reorder', {
          method: 'PUT',
          body: { sortOrder: 0 },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── POST /api/projects/:id/tasks/sync ── */
  describe('POST /api/projects/:id/tasks/sync', () => {
    it('imports .md files from project directory', async () => {
      const tasksDir = join(testDir, '.opencode', 'tasks');
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(
        join(tasksDir, 'imported-task-1.md'),
        '---\ntitle: "Imported File"\nstatus: in_progress\n---\n\nDescription here.',
      );

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as {
        imported: number;
        tasks: Array<{ title: string; column: string }>;
      };
      expect(result.imported).toBe(1);
      expect(result.tasks[0].title).toBe('Imported File');
      expect(result.tasks[0].column).toBe('in_progress');
    });

    it('does not duplicate existing tasks', async () => {
      // Create task first
      const r = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Existing' },
        }),
      );
      const _task = (await r.json()) as { id: string };

      // Sync (should skip existing)
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as { imported: number };
      expect(result.imported).toBe(0);
    });

    it('skips files with no title', async () => {
      const tasksDir = join(testDir, '.opencode', 'tasks');
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(join(tasksDir, 'bad.md'), '---\ndescription: "no title"\n---');

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as { imported: number };
      expect(result.imported).toBe(0);
    });

    it('returns empty when no .opencode/tasks directory', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as { imported: number };
      expect(result.imported).toBe(0);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent/tasks/sync', { method: 'POST' }),
      );
      expect(res.status).toBe(404);
    });

    it('imports tasks with status done', async () => {
      const tasksDir = join(testDir, '.opencode', 'tasks');
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(
        join(tasksDir, 'done-task.md'),
        '---\ntitle: "Done Item"\nstatus: done\n---\n\nDone.',
      );

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as { imported: number; tasks: Array<{ column: string }> };
      expect(result.imported).toBe(1);
      expect(result.tasks[0].column).toBe('done');
    });
  });

  /* ── PUT /api/tasks/:id/link-issue ── */
  describe('PUT /api/tasks/:id/link-issue', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Linkable' },
        }),
      );
      const task = (await res.json()) as { id: string };
      taskId = task.id;
    });

    it('links a GitHub issue to a task', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/link-issue`, {
          method: 'PUT',
          body: { githubIssueUrl: 'https://github.com/user/repo/issues/42', githubIssueNumber: 42 },
        }),
      );
      const task = (await res.json()) as { githubIssueUrl: string; githubIssueNumber: number };
      expect(task.githubIssueUrl).toBe('https://github.com/user/repo/issues/42');
      expect(task.githubIssueNumber).toBe(42);
    });

    it('returns 422 when no githubIssueUrl', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}/link-issue`, {
          method: 'PUT',
          body: {},
        }),
      );
      expect(res.status).toBe(422);
    });

    it('returns 404 for non-existent task', async () => {
      const res = await app.handle(
        authReq(token, '/api/tasks/nonexistent/link-issue', {
          method: 'PUT',
          body: { githubIssueUrl: 'https://github.com/x/y/issues/1' },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ── PUT /api/tasks/:id (agentType) ── */
  describe('PUT /api/tasks/:id — agentType field', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'Agent Task' },
        }),
      );
      const task = (await res.json()) as { id: string };
      taskId = task.id;
    });

    it('sets agentType to opencode', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: 'opencode' },
        }),
      );
      expect(res.status).toBe(200);
      const task = (await res.json()) as { agentType: string | null };
      expect(task.agentType).toBe('opencode');
    });

    it('sets agentType to claude', async () => {
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: 'claude' },
        }),
      );
      const task = (await res.json()) as { agentType: string | null };
      expect(task.agentType).toBe('claude');
    });

    it('clears agentType with null', async () => {
      // First set it
      await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: 'opencode' },
        }),
      );
      // Then clear it
      const res = await app.handle(
        authReq(token, `/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { agentType: null },
        }),
      );
      const task = (await res.json()) as { agentType: string | null };
      expect(task.agentType).toBeNull();
    });

    it('returns agentType: null for newly created tasks', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/tasks`, {
          method: 'POST',
          body: { title: 'No Agent Task' },
        }),
      );
      const task = (await res.json()) as { agentType: string | null };
      expect(res.status).toBe(201);
      expect(task.agentType).toBeNull();
    });
  });

  /* ── GET /api/projects/:id/agent-hint ── */
  describe('GET /api/projects/:id/agent-hint', () => {
    it('returns hint: null when neither .opencode nor .claude exists', async () => {
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/agent-hint`),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hint: string | null;
        hasOpencode: boolean;
        hasClaude: boolean;
      };
      expect(body.hint).toBeNull();
      expect(body.hasOpencode).toBe(false);
      expect(body.hasClaude).toBe(false);
    });

    it('returns hint: opencode when .opencode dir exists', async () => {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(testDir, '.opencode'), { recursive: true });

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/agent-hint`),
      );
      const body = (await res.json()) as {
        hint: string | null;
        hasOpencode: boolean;
        hasClaude: boolean;
      };
      expect(body.hint).toBe('opencode');
      expect(body.hasOpencode).toBe(true);
      expect(body.hasClaude).toBe(false);
    });

    it('returns hint: claude when .claude dir exists', async () => {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(testDir, '.claude'), { recursive: true });

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/agent-hint`),
      );
      const body = (await res.json()) as {
        hint: string | null;
        hasOpencode: boolean;
        hasClaude: boolean;
      };
      expect(body.hint).toBe('claude');
      expect(body.hasOpencode).toBe(false);
      expect(body.hasClaude).toBe(true);
    });

    it('returns hint: both when both .opencode and .claude exist', async () => {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(testDir, '.opencode'), { recursive: true });
      mkdirSync(join(testDir, '.claude'), { recursive: true });

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/agent-hint`),
      );
      const body = (await res.json()) as {
        hint: string | null;
        hasOpencode: boolean;
        hasClaude: boolean;
      };
      expect(body.hint).toBe('both');
      expect(body.hasOpencode).toBe(true);
      expect(body.hasClaude).toBe(true);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent/agent-hint'),
      );
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/agent-hint`),
      );
      expect(res.status).toBe(401);
    });
  });
});
