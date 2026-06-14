import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const OLD_ENV = { ...process.env };

describe('harnesses routes — GET /api/harnesses', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let testDir: string;

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    // Validate auth env
    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    // Create a temp harnesses directory
    const { mkdtempSync } = await import('node:fs');
    testDir = mkdtempSync(path.join(tmpdir(), 'opencode-test-harnesses-'));
    process.env.HARNESSES_PATH = testDir;

    // Build the app with both auth and harnesses routes
    const { authRoutes } = await import('../auth/index');
    const { harnessesRoutes } = await import('./harnesses');
    app = new Elysia().use(authRoutes).use(harnessesRoutes);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /** Helper: get a valid JWT token by logging in */
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

  /** Helper: build an authenticated request */
  function authReq(token: string, path: string) {
    return new Request(`http://localhost${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('returns an empty array when harnesses directory does not exist', async () => {
    // Delete the temp dir to simulate nonexistent harnesses dir
    rmSync(testDir, { recursive: true, force: true });

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it('returns an empty array when harnesses directory is empty', async () => {
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it('discovers harnesses from subdirectories with manifest', async () => {
    // Create a harness subdirectory with a manifest.json
    const templateDir = path.join(testDir, 'my-template');
    mkdirSync(templateDir);
    writeFileSync(
      path.join(templateDir, 'manifest.json'),
      JSON.stringify({ name: 'My Template', description: 'A test harness template' }),
    );

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('my-template');
    expect(body[0].name).toBe('My Template');
    expect(body[0].description).toBe('A test harness template');
  });

  it('reads harness.json as an alternative manifest', async () => {
    // Create a harness subdirectory with harness.json
    const templateDir = path.join(testDir, 'alt-template');
    mkdirSync(templateDir);
    writeFileSync(
      path.join(templateDir, 'harness.json'),
      JSON.stringify({ name: 'Alt Template', description: 'Using harness.json' }),
    );

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('alt-template');
    expect(body[0].name).toBe('Alt Template');
    expect(body[0].description).toBe('Using harness.json');
  });

  it('falls back to directory name when no manifest exists', async () => {
    const templateDir = path.join(testDir, 'bare-template');
    mkdirSync(templateDir);

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('bare-template');
    expect(body[0].name).toBe('bare-template');
    expect(body[0].description).toBe('');
  });

  it('handles malformed JSON gracefully', async () => {
    const templateDir = path.join(testDir, 'bad-json');
    mkdirSync(templateDir);
    writeFileSync(path.join(templateDir, 'manifest.json'), '{ not valid json }');

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(1);
    // Falls back to directory name
    expect(body[0].name).toBe('bad-json');
    expect(body[0].description).toBe('');
  });

  it('discovers multiple harnesses', async () => {
    mkdirSync(path.join(testDir, 'react-starter'));
    writeFileSync(
      path.join(testDir, 'react-starter', 'manifest.json'),
      JSON.stringify({ name: 'React Starter', description: 'React + Vite' }),
    );
    mkdirSync(path.join(testDir, 'node-cli'));
    writeFileSync(
      path.join(testDir, 'node-cli', 'manifest.json'),
      JSON.stringify({ name: 'Node CLI', description: 'CLI tool template' }),
    );
    mkdirSync(path.join(testDir, 'bare'));

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(3);
    expect(body.map((h) => h.id).sort()).toEqual(['bare', 'node-cli', 'react-starter']);
  });

  it('skips files (non-directories) in the harnesses root', async () => {
    writeFileSync(path.join(testDir, 'README.md'), '# Harnesses');
    mkdirSync(path.join(testDir, 'real-harness'));
    writeFileSync(
      path.join(testDir, 'real-harness', 'manifest.json'),
      JSON.stringify({ name: 'Real' }),
    );

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('real-harness');
  });

  it('uses harness.json over manifest.json when both exist', async () => {
    const templateDir = path.join(testDir, 'dual');
    mkdirSync(templateDir);
    writeFileSync(
      path.join(templateDir, 'harness.json'),
      JSON.stringify({ name: 'Harness JSON', description: 'from harness.json' }),
    );
    writeFileSync(
      path.join(templateDir, 'manifest.json'),
      JSON.stringify({ name: 'Manifest JSON', description: 'from manifest.json' }),
    );

    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/harnesses'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Harness JSON');
    expect(body[0].description).toBe('from harness.json');
  });

  it('returns 401 without auth token', async () => {
    const res = await app.handle(new Request('http://localhost/api/harnesses'));
    expect(res.status).toBe(401);
  });
});

describe('harness copy on project creation (POST /api/projects integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let testDir: string;
  let harnessDir: string;
  let projectDir: string;

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    const { mkdtempSync } = await import('node:fs');
    testDir = mkdtempSync(path.join(tmpdir(), 'opencode-test-harness-copy-'));

    // Create harness directory
    harnessDir = path.join(testDir, 'harnesses', 'test-harness');
    mkdirSync(path.join(testDir, 'harnesses', 'test-harness'), { recursive: true });
    writeFileSync(
      path.join(harnessDir, 'manifest.json'),
      JSON.stringify({ name: 'Test Harness', description: 'For testing' }),
    );
    writeFileSync(path.join(harnessDir, '.env.example'), 'SECRET=changeme');
    writeFileSync(path.join(harnessDir, 'README.md'), '# Test Harness');
    mkdirSync(path.join(harnessDir, 'src'));
    writeFileSync(path.join(harnessDir, 'src', 'index.ts'), 'console.log("hello");');

    process.env.HARNESSES_PATH = path.join(testDir, 'harnesses');

    // Create empty project directory
    projectDir = path.join(testDir, 'projects', 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { harnessesRoutes } = await import('./harnesses');
    app = new Elysia().use(authRoutes).use(harnessesRoutes).use(projectsRoutes);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

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
    token: string,
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
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it('copies harness files into project directory', async () => {
    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Harnessed Project',
          directory: projectDir,
          harnessId: 'test-harness',
        },
      }),
    );

    expect(res.status).toBe(201);
    const project = (await res.json()) as Record<string, unknown>;
    expect(project.harnessId).toBe('test-harness');

    // Verify files were copied
    const { readFileSync, readdirSync } = await import('node:fs');
    expect(readFileSync(path.join(projectDir, '.env.example'), 'utf-8')).toBe('SECRET=changeme');
    expect(readFileSync(path.join(projectDir, 'README.md'), 'utf-8')).toBe('# Test Harness');
    expect(readFileSync(path.join(projectDir, 'src', 'index.ts'), 'utf-8')).toBe(
      'console.log("hello");',
    );
  });

  it('returns 409 when directory is non-empty and overwrite is not set', async () => {
    // Put a file in the project directory
    writeFileSync(path.join(projectDir, 'existing.txt'), 'already here');

    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Non-empty Project',
          directory: projectDir,
          harnessId: 'test-harness',
        },
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Directory not empty. Set overwrite=true to proceed.');
  });

  it('proceeds with overwrite when overwrite=true and directory is non-empty', async () => {
    // Put a file in the project directory
    writeFileSync(path.join(projectDir, 'existing.txt'), 'already here');

    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Overwrite Project',
          directory: projectDir,
          harnessId: 'test-harness',
          overwrite: true,
        },
      }),
    );

    expect(res.status).toBe(201);
    const project = (await res.json()) as Record<string, unknown>;
    expect(project.harnessId).toBe('test-harness');

    // Verify harness files are present
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path.join(projectDir, 'README.md'), 'utf-8')).toBe('# Test Harness');
  });

  it('returns 400 when harnessId does not exist', async () => {
    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Bad Harness',
          directory: projectDir,
          harnessId: 'nonexistent',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('harness not found: nonexistent');
  });

  it('creates project without harness when harnessId is not provided', async () => {
    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'No Harness',
          directory: projectDir,
        },
      }),
    );

    expect(res.status).toBe(201);
    const project = (await res.json()) as Record<string, unknown>;
    expect(project.harnessId).toBeNull();

    // Verify project directory is empty (no harness files copied)
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(projectDir).length).toBe(0);
  });

  it('copies hidden files (dotfiles)', async () => {
    // Add a .gitignore to harness
    writeFileSync(path.join(harnessDir, '.gitignore'), 'node_modules/');

    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Dotfile Project',
          directory: projectDir,
          harnessId: 'test-harness',
        },
      }),
    );

    expect(res.status).toBe(201);

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path.join(projectDir, '.gitignore'), 'utf-8')).toBe('node_modules/');
  });

  it('copies subdirectory recursively', async () => {
    const token = await getToken();
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: {
          name: 'Recursive Project',
          directory: projectDir,
          harnessId: 'test-harness',
        },
      }),
    );

    expect(res.status).toBe(201);

    // Verify subdirectory was copied
    const { existsSync } = await import('node:fs');
    expect(existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true);
  });
});

// ── Harness CRUD + File Operations ─────────────────────────────────────
describe('harnesses CRUD routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let harnessesDir: string;

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    const { mkdtempSync } = await import('node:fs');
    harnessesDir = mkdtempSync(path.join(tmpdir(), 'opencode-test-crud-'));
    process.env.HARNESSES_PATH = harnessesDir;

    const { authRoutes } = await import('../auth/index');
    const { harnessesRoutes } = await import('./harnesses');
    app = new Elysia().use(authRoutes).use(harnessesRoutes);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(harnessesDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

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
    token: string,
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

  // ── POST /api/harnesses ─────────────────────────────────────────────
  describe('POST /api/harnesses', () => {
    it('creates a harness with name only', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'my-template' },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('my-template');
      expect(body.name).toBe('my-template');
      expect(body.description).toBe('');
      expect(body.fileCount).toBe(0);
    });

    it('creates a harness with name and description', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'described', description: 'A harness with description' },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('described');
      expect(body.description).toBe('A harness with description');
    });

    it('creates a harness and persists harness.json on disk and DB row', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'disk-check', description: 'Check disk and DB' },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('disk-check');
      expect(body.name).toBe('disk-check');
      expect(body.description).toBe('Check disk and DB');
      expect(body.fileCount).toBe(0);

      // Verify directory and harness.json on disk
      const { existsSync, readFileSync } = await import('node:fs');
      const harnessDir = path.join(harnessesDir, 'disk-check');
      expect(existsSync(harnessDir)).toBe(true);
      expect(existsSync(path.join(harnessDir, 'harness.json'))).toBe(true);
      const manifest = JSON.parse(
        readFileSync(path.join(harnessDir, 'harness.json'), 'utf-8'),
      );
      expect(manifest.name).toBe('disk-check');
      expect(manifest.description).toBe('Check disk and DB');

      // Verify DB row
      const { getDb } = await import('../db/client');
      const row = getDb()
        .query('SELECT id, name, description, file_count FROM harnesses WHERE id = ?')
        .get('disk-check') as {
        id: string;
        name: string;
        description: string;
        file_count: number;
      };
      expect(row.id).toBe('disk-check');
      expect(row.name).toBe('disk-check');
      expect(row.description).toBe('Check disk and DB');
      expect(row.file_count).toBe(0);
    });

    it('creates a harness with initial files', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'with-files',
            description: 'Has files',
            files: [
              { path: 'README.md', content: Buffer.from('# My Template').toString('base64') },
              { path: 'src/index.ts', content: Buffer.from('console.log("hi");').toString('base64') },
            ],
          },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.fileCount).toBe(2);

      // Verify files were written to disk
      const { readFileSync, existsSync } = await import('node:fs');
      const harnessDir = path.join(harnessesDir, 'with-files');
      expect(existsSync(path.join(harnessDir, 'README.md'))).toBe(true);
      expect(readFileSync(path.join(harnessDir, 'README.md'), 'utf-8')).toBe('# My Template');
      expect(existsSync(path.join(harnessDir, 'src', 'index.ts'))).toBe(true);
    });

    it('returns 409 for duplicate name', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'duplicate' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'duplicate' },
        }),
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already exists/);
    });

    it('returns 400 when name is missing', async () => {
      const token = await getToken();
      // Elysia validation will catch missing required field
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { description: 'no name' },
        }),
      );

      // Elysia returns 422 for schema validation errors
      expect(res.status).toBe(422);
    });

    it('returns 400 when name is empty', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: '' },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('name is required');
    });
  });

  // ── PUT /api/harnesses/:id ──────────────────────────────────────────
  describe('PUT /api/harnesses/:id', () => {
    async function createHarness(name: string, description?: string) {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name, description: description || '' },
        }),
      );
    }

    it('updates harness description', async () => {
      await createHarness('update-me');
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/update-me', {
          method: 'PUT',
          body: { description: 'Updated description' },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('update-me');
      expect(body.description).toBe('Updated description');
    });

    it('renames harness', async () => {
      await createHarness('old-name');
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/old-name', {
          method: 'PUT',
          body: { name: 'new-name' },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('new-name');
      expect(body.name).toBe('new-name');

      // Verify directory was renamed
      const { existsSync } = await import('node:fs');
      expect(existsSync(path.join(harnessesDir, 'old-name'))).toBe(false);
      expect(existsSync(path.join(harnessesDir, 'new-name'))).toBe(true);
    });

    it('returns 409 when renaming to an existing name', async () => {
      await createHarness('first');
      await createHarness('second');
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/first', {
          method: 'PUT',
          body: { name: 'second' },
        }),
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already exists/);
    });

    it('returns 404 for non-existent harness', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/nonexistent', {
          method: 'PUT',
          body: { description: 'ghost' },
        }),
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('harness not found');
    });
  });

  // ── DELETE /api/harnesses/:id ───────────────────────────────────────
  describe('DELETE /api/harnesses/:id', () => {
    it('deletes an existing harness', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'delete-me' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/delete-me', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(200);

      // Verify directory is gone
      const { existsSync } = await import('node:fs');
      expect(existsSync(path.join(harnessesDir, 'delete-me'))).toBe(false);
    });

    it('returns 404 for non-existent harness', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/nonexistent', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('harness not found');
    });
  });

  // ── GET /api/harnesses/:id/files ────────────────────────────────────
  describe('GET /api/harnesses/:id/files', () => {
    it('returns empty files for a new harness', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'empty-harness' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/empty-harness/files'),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe('empty-harness');
      expect(Array.isArray(body.files)).toBe(true);
      expect((body.files as unknown[]).length).toBe(0);
    });

    it('returns file tree for harness with files', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'tree-harness',
            files: [
              { path: 'README.md', content: Buffer.from('# Readme').toString('base64') },
              { path: 'src/index.ts', content: Buffer.from('const x = 1;').toString('base64') },
              { path: 'src/lib/helper.ts', content: Buffer.from('export const h = () => {};').toString('base64') },
            ],
          },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/tree-harness/files'),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const files = body.files as Array<{ path: string; isDirectory: boolean; children?: unknown[] }>;

      // Should have README.md at root and src/ directory
      const readme = files.find((f) => f.path === 'README.md');
      expect(readme).toBeDefined();
      expect(readme!.isDirectory).toBe(false);

      const srcDir = files.find((f) => f.path === 'src' && f.isDirectory);
      expect(srcDir).toBeDefined();
      expect(srcDir!.children).toBeDefined();
    });

    it('returns file tree with recursive structure and correct sort order', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'deep-tree',
            files: [
              { path: 'README.md', content: Buffer.from('# Readme').toString('base64') },
              { path: 'src/index.ts', content: Buffer.from('const x = 1;').toString('base64') },
              {
                path: 'src/lib/helper.ts',
                content: Buffer.from('export const h = () => {};').toString('base64'),
              },
            ],
          },
        }),
      );

      const res = await app.handle(authReq(token, '/api/harnesses/deep-tree/files'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const files = body.files as Array<{
        path: string;
        isDirectory: boolean;
        size: number;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children?: any[];
      }>;

      // Top level: directory "src" first (directories sort before files), then file "README.md"
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('src');
      expect(files[0].isDirectory).toBe(true);
      expect(files[1].path).toBe('README.md');
      expect(files[1].isDirectory).toBe(false);

      // src has: directory "lib" first (directories sort before files), then file "index.ts"
      const srcChildren = files[0].children as Array<{
        path: string;
        isDirectory: boolean;
        size: number;
        children?: unknown[];
      }>;
      expect(srcChildren).toHaveLength(2);
      expect(srcChildren[0].path).toBe('src/lib');
      expect(srcChildren[0].isDirectory).toBe(true);
      expect(srcChildren[1].path).toBe('src/index.ts');
      expect(srcChildren[1].isDirectory).toBe(false);
      expect(srcChildren[1].size).toBeGreaterThan(0);

      // lib (directory at index 0) has helper.ts
      const libChildren = srcChildren[0].children as Array<{
        path: string;
        isDirectory: boolean;
      }>;
      expect(libChildren).toHaveLength(1);
      expect(libChildren[0].path).toBe('src/lib/helper.ts');
      expect(libChildren[0].isDirectory).toBe(false);
    });

    it('returns 404 for non-existent harness', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/nonexistent/files'),
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('harness not found');
    });
  });

  // ── POST /api/harnesses/:id/files ───────────────────────────────────
  describe('POST /api/harnesses/:id/files', () => {
    it('uploads a file to an existing harness', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'file-upload' },
        }),
      );

      const content = Buffer.from('Hello, World!').toString('base64');
      const res = await app.handle(
        authReq(token, '/api/harnesses/file-upload/files', {
          method: 'POST',
          body: { path: 'greeting.txt', content },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { path: string; size: number };
      expect(body.path).toBe('greeting.txt');
      expect(body.size).toBeGreaterThan(0);

      // Verify file on disk
      const { readFileSync } = await import('node:fs');
      const fileContent = readFileSync(path.join(harnessesDir, 'file-upload', 'greeting.txt'), 'utf-8');
      expect(fileContent).toBe('Hello, World!');
    });

    it('uploads a file in a subdirectory', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'subdir-upload' },
        }),
      );

      const content = Buffer.from('nested').toString('base64');
      const res = await app.handle(
        authReq(token, '/api/harnesses/subdir-upload/files', {
          method: 'POST',
          body: { path: 'deep/nested/file.txt', content },
        }),
      );

      expect(res.status).toBe(201);

      const { existsSync } = await import('node:fs');
      expect(existsSync(path.join(harnessesDir, 'subdir-upload', 'deep', 'nested', 'file.txt'))).toBe(true);
    });

    it('returns 409 when file already exists', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'dup-file',
            files: [
              { path: 'exists.txt', content: Buffer.from('original').toString('base64') },
            ],
          },
        }),
      );

      const content = Buffer.from('overwrite').toString('base64');
      const res = await app.handle(
        authReq(token, '/api/harnesses/dup-file/files', {
          method: 'POST',
          body: { path: 'exists.txt', content },
        }),
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('file already exists');
    });

    it('returns 404 for non-existent harness', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/harnesses/nonexistent/files', {
          method: 'POST',
          body: { path: 'test.txt', content: Buffer.from('test').toString('base64') },
        }),
      );

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/harnesses/:id/files ─────────────────────────────────
  describe('DELETE /api/harnesses/:id/files', () => {
    it('deletes a file from a harness', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'delete-file',
            files: [
              { path: 'remove-me.txt', content: Buffer.from('bye').toString('base64') },
            ],
          },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/delete-file/files?path=remove-me.txt', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(200);

      const { existsSync } = await import('node:fs');
      expect(existsSync(path.join(harnessesDir, 'delete-file', 'remove-me.txt'))).toBe(false);
    });

    it('returns 404 when file does not exist', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'no-file-here' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/no-file-here/files?path=nonexistent.txt', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('file not found');
    });

    it('returns 400 when path query is missing', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'missing-path' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/missing-path/files', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('path query parameter is required');
    });
  });

  // ── Security: Path Traversal Protection ─────────────────────────────
  describe('security — path traversal protection', () => {
    it('rejects file upload with ../ traversal', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'secure-harness' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/secure-harness/files', {
          method: 'POST',
          body: {
            path: '../../../etc/passwd',
            content: Buffer.from('evil').toString('base64'),
          },
        }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('path traversal detected');
    });

    it('rejects file upload with null byte', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'null-byte-harness' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/null-byte-harness/files', {
          method: 'POST',
          body: {
            path: 'safe.txt\0../../../etc/passwd',
            content: Buffer.from('evil').toString('base64'),
          },
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('path contains invalid characters');
    });

    it('rejects file upload with absolute path', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'abs-path-harness' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/abs-path-harness/files', {
          method: 'POST',
          body: {
            path: '/etc/passwd',
            content: Buffer.from('evil').toString('base64'),
          },
        }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('absolute paths are not allowed');
    });

    it('rejects file delete with path traversal', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: {
            name: 'traversal-delete',
            files: [
              { path: 'safe.txt', content: Buffer.from('safe').toString('base64') },
            ],
          },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/traversal-delete/files?path=../safe.txt', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('path traversal detected');
    });

    it('rejects file delete with absolute path', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/harnesses', {
          method: 'POST',
          body: { name: 'abs-delete-harness' },
        }),
      );

      const res = await app.handle(
        authReq(token, '/api/harnesses/abs-delete-harness/files?path=/etc/passwd', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('absolute paths are not allowed');
    });
  });
});
