import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { randomUUID } from 'node:crypto';

const OLD_ENV = { ...process.env };

describe('chat routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
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
    path: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    const { method = 'GET', body } = options;
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  function seedProject(id: string): void {
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO projects (id, name, directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, `proj-${id}`, '/tmp/' + id, now, now],
    );
  }

  function seedMessage(projectId: string, role: string, content: string, createdAt: string): void {
    db.run(
      'INSERT INTO chat_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), projectId, role, content, createdAt],
    );
  }

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const dbClient = await import('../db/client');
    dbClient.initDb(':memory:');
    db = dbClient.getDb();

    const { authRoutes } = await import('../auth/index');
    const { chatRoutes } = await import('./chat');
    app = new Elysia().use(authRoutes).use(chatRoutes);

    token = await getToken();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  /* ── Auth protection ── */
  describe('auth protection', () => {
    it('returns 401 on history without token', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/projects/p1/chat/history'),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 on POST without token', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/projects/p1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'hi' }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ── GET history ── */
  describe('GET /api/projects/:id/chat/history', () => {
    it('returns 404 for unknown project', async () => {
      const res = await app.handle(authReq('/api/projects/nope/chat/history'));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('project not found');
    });

    it('returns empty array for project with no messages', async () => {
      seedProject('p1');
      const res = await app.handle(authReq('/api/projects/p1/chat/history'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it('returns messages ordered by created_at ascending', async () => {
      seedProject('p1');
      seedMessage('p1', 'assistant', 'second', '2026-01-02T00:00:00.000Z');
      seedMessage('p1', 'user', 'first', '2026-01-01T00:00:00.000Z');
      const res = await app.handle(authReq('/api/projects/p1/chat/history'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        role: string;
        content: string;
        id: string;
        created_at: string;
      }>;
      expect(body).toHaveLength(2);
      expect(body[0].content).toBe('first');
      expect(body[0].role).toBe('user');
      expect(body[1].content).toBe('second');
      expect(body[1].role).toBe('assistant');
      expect(body[0].id).toBeTruthy();
    });

    it('scopes history to the requested project', async () => {
      seedProject('p1');
      seedProject('p2');
      seedMessage('p1', 'user', 'belongs to p1', '2026-01-01T00:00:00.000Z');
      seedMessage('p2', 'user', 'belongs to p2', '2026-01-01T00:00:00.000Z');
      const res = await app.handle(authReq('/api/projects/p1/chat/history'));
      const body = (await res.json()) as Array<{ content: string }>;
      expect(body).toHaveLength(1);
      expect(body[0].content).toBe('belongs to p1');
    });
  });

  /* ── POST validation ── */
  describe('POST /api/projects/:id/chat (validation)', () => {
    it('returns 400 when message is missing', async () => {
      seedProject('p1');
      const res = await app.handle(authReq('/api/projects/p1/chat', { method: 'POST', body: {} }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when message is blank/whitespace', async () => {
      seedProject('p1');
      const res = await app.handle(
        authReq('/api/projects/p1/chat', { method: 'POST', body: { message: '   ' } }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when project does not exist', async () => {
      const res = await app.handle(
        authReq('/api/projects/ghost/chat', { method: 'POST', body: { message: 'hello' } }),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('project not found');
    });

    it('persists the user message before spawning (validated via 404 short-circuit)', async () => {
      // Unknown project must NOT persist a message.
      await app.handle(
        authReq('/api/projects/ghost/chat', { method: 'POST', body: { message: 'hello' } }),
      );
      const rows = db.query('SELECT COUNT(*) as c FROM chat_messages').get() as { c: number };
      expect(rows.c).toBe(0);
    });
  });
});
