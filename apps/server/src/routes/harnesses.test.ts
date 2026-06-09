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
