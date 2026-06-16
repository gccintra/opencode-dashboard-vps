/**
 * Tests for task enrichments: priority field, the unified activity timeline
 * (created / moved / title / priority events + comments), and typed task links
 * (with inverse resolution).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

describe('task enrichments (priority / activity / links)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let dataDir: string;
  let projectDir: string;
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
    return ((await res.json()) as { token: string }).token;
  }

  function authReq(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Request {
    const { method = 'GET', body } = options;
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function createTask(body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = await app.handle(
      authReq(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: { title: 'Task', ...body },
      }),
    );
    return (await res.json()) as Record<string, unknown>;
  }

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    dataDir = mkdtempSync(join(tmpdir(), 'opencode-enrich-data-'));
    process.env.DATABASE_PATH = join(dataDir, 'opencode.db');
    projectDir = mkdtempSync(join(tmpdir(), 'opencode-enrich-proj-'));

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();
    const { initDb } = await import('../db/client');
    initDb(':memory:');

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { tasksRoutes } = await import('./tasks');
    const { taskActivityRoutes } = await import('./task-activity');
    const { taskLinksRoutes } = await import('./task-links');

    app = new Elysia()
      .use(authRoutes)
      .use(projectsRoutes)
      .use(tasksRoutes)
      .use(taskActivityRoutes)
      .use(taskLinksRoutes);

    token = await getToken();
    const res = await app.handle(
      authReq('/api/projects', {
        method: 'POST',
        body: { name: `enrich-${Date.now()}-${Math.random()}`, directory: projectDir },
      }),
    );
    projectId = ((await res.json()) as { id: string }).id;
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

  /* ── Priority ── */

  it('defaults priority to medium', async () => {
    const task = await createTask();
    expect(task.priority).toBe('medium');
  });

  it('persists a priority supplied at creation', async () => {
    const task = await createTask({ priority: 'high' });
    expect(task.priority).toBe('high');
  });

  it('updates priority via PUT', async () => {
    const task = await createTask();
    const res = await app.handle(
      authReq(`/api/tasks/${task.id}`, { method: 'PUT', body: { priority: 'low' } }),
    );
    const updated = (await res.json()) as { priority: string };
    expect(updated.priority).toBe('low');
  });

  /* ── Activity timeline ── */

  it('logs a created event', async () => {
    const task = await createTask();
    const res = await app.handle(authReq(`/api/tasks/${task.id}/activity`));
    const events = (await res.json()) as Array<{ type: string }>;
    expect(events.some((e) => e.type === 'created')).toBe(true);
  });

  it('logs title, priority and move changes', async () => {
    const task = await createTask();
    await app.handle(
      authReq(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: { title: 'Renamed', priority: 'high' },
      }),
    );
    await app.handle(
      authReq(`/api/tasks/${task.id}/move`, { method: 'PUT', body: { column: 'done' } }),
    );
    const res = await app.handle(authReq(`/api/tasks/${task.id}/activity`));
    const types = ((await res.json()) as Array<{ type: string }>).map((e) => e.type);
    expect(types).toContain('title_changed');
    expect(types).toContain('priority_changed');
    expect(types).toContain('moved');
  });

  it('does not log an event when value is unchanged', async () => {
    const task = await createTask({ priority: 'medium' });
    await app.handle(
      authReq(`/api/tasks/${task.id}`, { method: 'PUT', body: { priority: 'medium' } }),
    );
    const res = await app.handle(authReq(`/api/tasks/${task.id}/activity`));
    const types = ((await res.json()) as Array<{ type: string }>).map((e) => e.type);
    expect(types.filter((t) => t === 'priority_changed')).toHaveLength(0);
  });

  /* ── Comments ── */

  it('creates, edits and deletes a comment', async () => {
    const task = await createTask();

    const createRes = await app.handle(
      authReq(`/api/tasks/${task.id}/comments`, { method: 'POST', body: { body: 'first note' } }),
    );
    expect(createRes.status).toBe(201);
    const comment = (await createRes.json()) as { id: string; type: string; body: string };
    expect(comment.type).toBe('comment');
    expect(comment.body).toBe('first note');

    const editRes = await app.handle(
      authReq(`/api/tasks/${task.id}/comments/${comment.id}`, {
        method: 'PUT',
        body: { body: 'edited note' },
      }),
    );
    const edited = (await editRes.json()) as { body: string; updatedAt: string; createdAt: string };
    expect(edited.body).toBe('edited note');

    const delRes = await app.handle(
      authReq(`/api/tasks/${task.id}/comments/${comment.id}`, { method: 'DELETE' }),
    );
    expect(delRes.status).toBe(200);

    const listRes = await app.handle(authReq(`/api/tasks/${task.id}/activity`));
    const types = ((await listRes.json()) as Array<{ type: string }>).map((e) => e.type);
    expect(types.filter((t) => t === 'comment')).toHaveLength(0);
  });

  it('increments commentCount on the task list', async () => {
    const task = await createTask();
    await app.handle(
      authReq(`/api/tasks/${task.id}/comments`, { method: 'POST', body: { body: 'hi' } }),
    );
    const res = await app.handle(authReq('/api/tasks'));
    const list = (await res.json()) as Array<{ id: string; commentCount: number }>;
    const found = list.find((t) => t.id === task.id);
    expect(found?.commentCount).toBe(1);
  });

  /* ── Links ── */

  it('creates a typed link and resolves the inverse on the other task', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });

    const res = await app.handle(
      authReq(`/api/tasks/${a.id}/links`, {
        method: 'POST',
        body: { targetTaskId: b.id, type: 'blocks' },
      }),
    );
    expect(res.status).toBe(201);

    const aLinks = (await (await app.handle(authReq(`/api/tasks/${a.id}/links`))).json()) as Array<{
      type: string;
      task: { id: string };
    }>;
    expect(aLinks).toHaveLength(1);
    expect(aLinks[0].type).toBe('blocks');
    expect(aLinks[0].task.id).toBe(b.id);

    const bLinks = (await (await app.handle(authReq(`/api/tasks/${b.id}/links`))).json()) as Array<{
      type: string;
      task: { id: string };
    }>;
    expect(bLinks).toHaveLength(1);
    expect(bLinks[0].type).toBe('blocked_by');
    expect(bLinks[0].task.id).toBe(a.id);
  });

  it('rejects self-links and duplicates', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });

    const self = await app.handle(
      authReq(`/api/tasks/${a.id}/links`, {
        method: 'POST',
        body: { targetTaskId: a.id, type: 'relates_to' },
      }),
    );
    expect(self.status).toBe(400);

    await app.handle(
      authReq(`/api/tasks/${a.id}/links`, {
        method: 'POST',
        body: { targetTaskId: b.id, type: 'relates_to' },
      }),
    );
    const dup = await app.handle(
      authReq(`/api/tasks/${a.id}/links`, {
        method: 'POST',
        body: { targetTaskId: b.id, type: 'relates_to' },
      }),
    );
    expect(dup.status).toBe(409);
  });

  it('deletes a link and reflects linkCount in the task list', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });
    const created = (await (
      await app.handle(
        authReq(`/api/tasks/${a.id}/links`, {
          method: 'POST',
          body: { targetTaskId: b.id, type: 'relates_to' },
        }),
      )
    ).json()) as { id: string };

    let list = (await (await app.handle(authReq('/api/tasks'))).json()) as Array<{
      id: string;
      linkCount: number;
    }>;
    expect(list.find((t) => t.id === a.id)?.linkCount).toBe(1);

    const del = await app.handle(
      authReq(`/api/tasks/${a.id}/links/${created.id}`, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);

    list = (await (await app.handle(authReq('/api/tasks'))).json()) as Array<{
      id: string;
      linkCount: number;
    }>;
    expect(list.find((t) => t.id === a.id)?.linkCount).toBe(0);
  });
});
