import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

/** Helper: return a mock successful GitHub API response */
function mockGhResponse(issues: unknown[], remaining = 59) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'x-ratelimit-remaining': String(remaining),
    }),
    json: () => Promise.resolve(issues),
  };
}

/** Helper: return an empty page (stops pagination) */
function mockGhEmpty() {
  return mockGhResponse([]);
}

describe('github routes', () => {
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
    } = {},
  ) {
    const { method = 'GET', body } = options;
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tkn}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function createProject(opts: { githubRepo?: string } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyObj: Record<string, any> = {
      name: `gh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      directory: testDir,
    };
    if (opts.githubRepo) {
      bodyObj.githubRepo = opts.githubRepo;
    }
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: bodyObj,
      }),
    );
    const body = (await res.json()) as { id: string };
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

    testDir = mkdtempSync(join(tmpdir(), 'opencode-test-gh-'));

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { githubRoutes } = await import('./github');
    app = new Elysia().use(authRoutes).use(projectsRoutes).use(githubRoutes);

    token = await getToken();
    const project = await createProject({ githubRepo: 'testuser/testrepo' });
    projectId = project.id;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  /* ── Auth ── */
  it('returns 401 without token', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/projects/${projectId}/github/sync`, { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  /* ── POST /api/projects/:id/github/sync ── */
  describe('POST /api/projects/:id/github/sync', () => {
    it('returns 400 when project has no github_repo', async () => {
      const p = await createProject();
      const res = await app.handle(
        authReq(token, `/api/projects/${p.id}/github/sync`, { method: 'POST' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent/github/sync', { method: 'POST' }),
      );
      expect(res.status).toBe(404);
    });

    it('syncs issues and saves as tasks', async () => {
      const mockIssues = [
        {
          number: 1,
          title: 'Test Issue',
          body: 'Issue body',
          state: 'open',
          html_url: 'https://github.com/testuser/testrepo/issues/1',
          labels: [{ name: 'bug', color: 'ff0000' }],
        },
        {
          number: 2,
          title: 'Closed Issue',
          body: null,
          state: 'closed',
          html_url: 'https://github.com/testuser/testrepo/issues/2',
          labels: [],
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi
        .fn()
        .mockResolvedValueOnce(mockGhResponse(mockIssues))
        .mockResolvedValueOnce(mockGhEmpty());

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );
      expect(res.status).toBe(200);
      const result = (await res.json()) as { synced: number };
      expect(result.synced).toBe(2);

      // Verify tasks
      const { getDb } = await import('../db/client');
      const db = getDb();
      const tasks = db.query('SELECT * FROM tasks WHERE project_id = ?').all(projectId) as Array<
        Record<string, unknown>
      >;
      expect(tasks).toHaveLength(2);

      const openTask = tasks.find((t) => t.github_issue_number === 1);
      expect(openTask).toBeDefined();
      expect(openTask?.column).toBe('backlog');
      expect(openTask?.source).toBe('github');
      expect(openTask?.title).toBe('Test Issue');

      const closedTask = tasks.find((t) => t.github_issue_number === 2);
      expect(closedTask?.column).toBe('done');

      const labels = JSON.parse(openTask?.github_labels as string);
      expect(labels).toEqual([{ name: 'bug', color: 'ff0000' }]);
    });

    it('handles GitHub API errors gracefully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'x-ratelimit-remaining': '59' }),
        text: () => Promise.resolve('Forbidden'),
      });

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );
      expect(res.status).toBe(500);
    });

    it('respects rate limits', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1),
          }),
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce(
          mockGhResponse([
            {
              number: 1,
              title: 'After Rate Limit',
              body: null,
              state: 'open',
              html_url: 'https://github.com/testuser/testrepo/issues/1',
              labels: [],
            },
          ]),
        )
        .mockResolvedValueOnce(mockGhEmpty());

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );
      expect(res.status).toBe(200);
      const result = (await res.json()) as { synced: number };
      expect(result.synced).toBe(1);
    });

    it('filters out pull requests', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockGhResponse([
            {
              number: 1,
              title: 'Issue',
              body: null,
              state: 'open',
              html_url: 'https://github.com/testuser/testrepo/issues/1',
              labels: [],
            },
            {
              number: 2,
              title: 'PR',
              body: null,
              state: 'open',
              html_url: 'https://github.com/testuser/testrepo/pull/2',
              labels: [],
              pull_request: { url: 'https://api.github.com/repos/testuser/testrepo/pulls/2' },
            },
          ]),
        )
        .mockResolvedValueOnce(mockGhEmpty());

      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );
      const result = (await res.json()) as { synced: number };
      expect(result.synced).toBe(1);
    });

    it('updates existing tasks on re-sync', async () => {
      // First sync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockGhResponse([
            {
              number: 1,
              title: 'Original Title',
              body: null,
              state: 'open',
              html_url: 'https://github.com/testuser/testrepo/issues/1',
              labels: [],
            },
          ]),
        )
        .mockResolvedValueOnce(mockGhEmpty());

      await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );

      // Second sync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockGhResponse([
            {
              number: 1,
              title: 'Updated Title',
              body: 'New body',
              state: 'closed',
              html_url: 'https://github.com/testuser/testrepo/issues/1',
              labels: [{ name: 'done', color: '00ff00' }],
            },
          ]),
        )
        .mockResolvedValueOnce(mockGhEmpty());

      await app.handle(
        authReq(token, `/api/projects/${projectId}/github/sync`, { method: 'POST' }),
      );

      const { getDb } = await import('../db/client');
      const db = getDb();
      const task = db
        .query('SELECT * FROM tasks WHERE project_id = ? AND github_issue_number = 1')
        .get(projectId) as Record<string, unknown>;
      expect(task.title).toBe('Updated Title');
      expect(task.column).toBe('done');
    });
  });
});
