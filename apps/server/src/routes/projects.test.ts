import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

describe('projects routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let testDir: string;
  let harnessesDir: string;

  /**
   * Helper: get a valid JWT token by logging in
   */
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

  /**
   * Helper: build an authenticated request
   */
  function authReq(
    token: string,
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
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    // Validate auth env
    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    // Initialize DB (:memory:)
    const { initDb } = await import('../db/client');
    initDb(':memory:');

    // Create a real temp directory for testing directory validation
    testDir = mkdtempSync(join(tmpdir(), 'opencode-test-project-'));

    // Set up a harness directory (separate from testDir so testDir stays empty)
    harnessesDir = mkdtempSync(join(tmpdir(), 'opencode-test-harnesses-'));
    mkdirSync(join(harnessesDir, 'some-harness-id'));
    writeFileSync(
      join(harnessesDir, 'some-harness-id', 'manifest.json'),
      JSON.stringify({ name: 'Test Harness' }),
    );
    mkdirSync(join(harnessesDir, 'h1'));
    writeFileSync(join(harnessesDir, 'h1', 'manifest.json'), JSON.stringify({ name: 'h1' }));
    process.env.HARNESSES_PATH = harnessesDir;

    // Build the app with both auth and projects routes
    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    app = new Elysia().use(authRoutes).use(projectsRoutes);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    // Clean up temp directories
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(harnessesDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── POST /api/projects ─────────────────────────────────────────────
  describe('POST /api/projects', () => {
    it('creates a project and returns 201', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'My Project', directory: testDir, description: 'A test project' },
        }),
      );

      expect(res.status).toBe(201);
      const project = (await res.json()) as Record<string, unknown>;
      expect(project.id).toBeDefined();
      expect(project.name).toBe('My Project');
      expect(project.directory).toBe(testDir);
      expect(project.description).toBe('A test project');
      expect(project.harnessId).toBeNull();
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it('creates a project without optional fields', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Minimal', directory: testDir },
        }),
      );

      expect(res.status).toBe(201);
      const project = (await res.json()) as Record<string, unknown>;
      expect(project.description).toBeNull();
      expect(project.harnessId).toBeNull();
    });

    it('creates a project with harnessId', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: {
            name: 'Harnessed Project',
            directory: testDir,
            harnessId: 'some-harness-id',
          },
        }),
      );

      expect(res.status).toBe(201);
      const project = (await res.json()) as Record<string, unknown>;
      expect(project.harnessId).toBe('some-harness-id');
    });

    it('returns 400 when name is missing', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { directory: testDir },
        }),
      );

      // Elysia body validation returns 422 for missing required fields
      expect(res.status).toBe(422);
    });

    it('returns 400 when name is empty string', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: '', directory: testDir },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('name is required');
    });

    it('returns 400 when directory is missing', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Test' },
        }),
      );

      expect(res.status).toBe(422);
    });

    it('returns 400 when directory does not exist', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Ghost', directory: '/tmp/nonexistent-dir-xyz-12345' },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('does not exist');
    });

    it('returns 409 on duplicate name (case-insensitive)', async () => {
      const token = await getToken();
      // Create first project
      await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Duplicate', directory: testDir },
        }),
      );

      // Try to create with same name, different case
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'DUPLICATE', directory: testDir },
        }),
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('project name already exists');
    });

    it('sanitizes directory path by resolving .. and .', async () => {
      const { join } = await import('node:path');
      const token = await getToken();
      // Use a path with . and .. that resolves to testDir
      const trickyPath = join(testDir, '.', '..', '..', testDir.slice(1));

      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Sanitized', directory: trickyPath },
        }),
      );

      // The response should have the resolved (clean) path
      const project = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(201);
      expect(project.directory).not.toContain('..');
    });

    it('trims whitespace from name and directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: '  Trimmed Name  ', directory: `  ${testDir}  ` },
        }),
      );

      expect(res.status).toBe(201);
      const project = (await res.json()) as Record<string, unknown>;
      expect(project.name).toBe('Trimmed Name');
      expect(project.directory).toBe(testDir);
    });
  });

  // ── GET /api/projects ──────────────────────────────────────────────
  describe('GET /api/projects', () => {
    it('returns an empty array when no projects exist', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/projects'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it('returns all projects sorted by name', async () => {
      const token = await getToken();
      // Create projects in non-alphabetical order
      await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Charlie', directory: testDir },
        }),
      );
      await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Alpha', directory: testDir },
        }),
      );
      await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Bravo', directory: testDir },
        }),
      );

      const res = await app.handle(authReq(token, '/api/projects'));

      expect(res.status).toBe(200);
      const projects = (await res.json()) as Array<{ name: string }>;
      expect(projects).toHaveLength(3);
      expect(projects[0].name).toBe('Alpha');
      expect(projects[1].name).toBe('Bravo');
      expect(projects[2].name).toBe('Charlie');
    });

    it('returns correct fields for each project', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: {
            name: 'Field Test',
            directory: testDir,
            description: 'desc',
            harnessId: 'h1',
          },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(authReq(token, '/api/projects'));
      const projects = (await res.json()) as Array<Record<string, unknown>>;

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(created.id);
      expect(projects[0].name).toBe('Field Test');
      expect(projects[0].directory).toBe(testDir);
      expect(projects[0].description).toBe('desc');
      expect(projects[0].harnessId).toBe('h1');
      expect(projects[0].createdAt).toBeDefined();
      expect(projects[0].updatedAt).toBeDefined();
    });
  });

  // ── GET /api/projects/:id ──────────────────────────────────────────
  describe('GET /api/projects/:id', () => {
    it('returns a project by id', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Get Me', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(authReq(token, `/api/projects/${created.id}`));

      expect(res.status).toBe(200);
      const project = (await res.json()) as Record<string, unknown>;
      expect(project.id).toBe(created.id);
      expect(project.name).toBe('Get Me');
    });

    it('returns 404 for non-existent project', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/projects/nonexistent-id'));

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('project not found');
    });
  });

  // ── PUT /api/projects/:id ──────────────────────────────────────────
  describe('PUT /api/projects/:id', () => {
    it('updates project name', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Old Name', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: { name: 'New Name' },
        }),
      );

      expect(res.status).toBe(200);
      const updated = (await res.json()) as Record<string, unknown>;
      expect(updated.name).toBe('New Name');
      expect(updated.directory).toBe(testDir); // unchanged
    });

    it('updates project directory', async () => {
      const token = await getToken();
      // Create second temp dir
      const { mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const secondDir = mkdtempSync(join(tmpdir(), 'opencode-test-second-'));

      try {
        const createRes = await app.handle(
          authReq(token, '/api/projects', {
            method: 'POST',
            body: { name: 'Dir Test', directory: testDir },
          }),
        );
        const created = (await createRes.json()) as Record<string, unknown>;

        const res = await app.handle(
          authReq(token, `/api/projects/${created.id}`, {
            method: 'PUT',
            body: { directory: secondDir },
          }),
        );

        expect(res.status).toBe(200);
        const updated = (await res.json()) as Record<string, unknown>;
        expect(updated.directory).toBe(secondDir);
      } finally {
        try {
          rmSync(secondDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });

    it('updates multiple fields at once', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Multi Field', directory: testDir, description: 'old' },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: { name: 'Multi Updated', description: 'new desc' },
        }),
      );

      expect(res.status).toBe(200);
      const updated = (await res.json()) as Record<string, unknown>;
      expect(updated.name).toBe('Multi Updated');
      expect(updated.description).toBe('new desc');
      expect(updated.directory).toBe(testDir); // unchanged
    });

    it('updates updated_at on change', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Timestamp', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 50));

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: { name: 'Timestamp Updated' },
        }),
      );

      const updated = (await res.json()) as Record<string, unknown>;
      expect(updated.updatedAt).not.toBe(created.updatedAt);
      expect(updated.createdAt).toBe(created.createdAt); // unchanged
    });

    it('returns current state when no fields provided', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'No Change', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: {},
        }),
      );

      expect(res.status).toBe(200);
      const current = (await res.json()) as Record<string, unknown>;
      expect(current.name).toBe('No Change');
      expect(current.directory).toBe(testDir);
    });

    it('returns 400 when directory does not exist on update', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Dir Update', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: { directory: '/tmp/nonexistent-dir-xyz-67890' },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('does not exist');
    });

    it('returns 400 when name is empty on update', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Name Update', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'PUT',
          body: { name: '' },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('name cannot be empty');
    });

    it('returns 409 when updating name to existing one', async () => {
      const token = await getToken();
      // Create two projects
      await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'First', directory: testDir },
        }),
      );
      const secondRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Second', directory: testDir },
        }),
      );
      const second = (await secondRes.json()) as Record<string, unknown>;

      // Try to rename Second to First (case-insensitive)
      const res = await app.handle(
        authReq(token, `/api/projects/${second.id}`, {
          method: 'PUT',
          body: { name: 'FIRST' },
        }),
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('project name already exists');
    });

    it('returns 404 when project not found', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent-id', {
          method: 'PUT',
          body: { name: 'Ghost' },
        }),
      );

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/projects/:id ───────────────────────────────────────
  describe('DELETE /api/projects/:id', () => {
    it('deletes a project and returns success', async () => {
      const token = await getToken();
      const createRes = await app.handle(
        authReq(token, '/api/projects', {
          method: 'POST',
          body: { name: 'Delete Me', directory: testDir },
        }),
      );
      const created = (await createRes.json()) as Record<string, unknown>;

      const res = await app.handle(
        authReq(token, `/api/projects/${created.id}`, {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify it's gone
      const getRes = await app.handle(authReq(token, `/api/projects/${created.id}`));
      expect(getRes.status).toBe(404);
    });

    it('returns 404 when project not found', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent-id', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(404);
    });
  });

  // ── Auth protection ────────────────────────────────────────────────
  describe('auth protection', () => {
    function unauthReq(method: string, path: string, body?: unknown) {
      return new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    it('returns 401 for GET /api/projects without token', async () => {
      const res = await app.handle(unauthReq('GET', '/api/projects'));
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /api/projects without token', async () => {
      const res = await app.handle(
        unauthReq('POST', '/api/projects', {
          name: 'Test',
          directory: testDir,
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /api/projects/:id without token', async () => {
      const res = await app.handle(unauthReq('GET', '/api/projects/some-id'));
      expect(res.status).toBe(401);
    });

    it('returns 401 for PUT /api/projects/:id without token', async () => {
      const res = await app.handle(unauthReq('PUT', '/api/projects/some-id', { name: 'New' }));
      expect(res.status).toBe(401);
    });

    it('returns 401 for DELETE /api/projects/:id without token', async () => {
      const res = await app.handle(unauthReq('DELETE', '/api/projects/some-id'));
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed token', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/projects', {
          headers: { Authorization: 'Bearer bad-token' },
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 with expired token', async () => {
      const { getJwtSecret } = await import('../auth/env');
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(getJwtSecret());
      const expiredToken = await new SignJWT({ sub: 'dashboard' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(-1)
        .sign(secret);
      await new Promise((r) => setTimeout(r, 50));

      const res = await app.handle(
        new Request('http://localhost/api/projects', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
      );
      expect(res.status).toBe(401);
    });
  });
});
