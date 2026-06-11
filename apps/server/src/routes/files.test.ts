import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

describe('files routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let testDir: string;
  let projectId: string;

  /* ── Helpers ── */

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

  async function createProject(token: string, dir: string): Promise<string> {
    const res = await app.handle(
      authReq(token, '/api/projects', {
        method: 'POST',
        body: { name: `test-${crypto.randomUUID().substring(0, 8)}`, directory: dir },
      }),
    );
    const body = await res.json();
    return body.id as string;
  }

  /* ── Setup ── */

  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    // Create temp project directory
    testDir = mkdtempSync(join(tmpdir(), 'opencode-test-files-'));
    // Seed with some test files and directories
    mkdirSync(join(testDir, 'src'));
    mkdirSync(join(testDir, 'src', 'components'));
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export const hello = "world";\n');
    writeFileSync(
      join(testDir, 'src', 'components', 'Button.tsx'),
      'export const Button = () => null;\n',
    );
    writeFileSync(join(testDir, 'README.md'), '# Test Project\n');
    writeFileSync(join(testDir, 'empty-file.txt'), '');
    mkdirSync(join(testDir, 'empty-dir'));

    const { authRoutes } = await import('../auth/index');
    const { projectsRoutes } = await import('./projects');
    const { filesRoutes, filesBaseRoutes } = await import('./files');
    app = new Elysia().use(authRoutes).use(projectsRoutes).use(filesRoutes).use(filesBaseRoutes);

    const token = await getToken();
    projectId = await createProject(token, testDir);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
     AUTH TESTS
     ══════════════════════════════════════════════════════════════════════ */

  describe('authentication', () => {
    it('GET /files returns 401 without token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/files?path=`),
      );
      expect(res.status).toBe(401);
    });

    it('GET /files/read returns 401 without token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/files/read?path=README.md`),
      );
      expect(res.status).toBe(401);
    });

    it('PUT /files/write returns 401 without token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/files/write?path=test.txt`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'test' }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     LIST DIRECTORY
     ══════════════════════════════════════════════════════════════════════ */

  describe('GET /:id/files — list directory', () => {
    it('returns root directory listing', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, `/api/projects/${projectId}/files?path=`));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      // dirs first, then files, sorted alphabetically
      const names = data.map((e: { name: string }) => e.name);
      expect(names).toContain('empty-dir');
      expect(names).toContain('src');
      expect(names).toContain('README.md');
      expect(names).toContain('empty-file.txt');
      // empty-dir should come before src (both dirs, alphabetical), and before any file
      const dirIdx = names.indexOf('empty-dir');
      const srcIdx = names.indexOf('src');
      const readmeIdx = names.indexOf('README.md');
      expect(dirIdx).toBeLessThan(srcIdx);
      expect(srcIdx).toBeLessThan(readmeIdx);
    });

    it('returns subdirectory listing', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, `/api/projects/${projectId}/files?path=src`));
      expect(res.status).toBe(200);
      const data = await res.json();
      const names = data.map((e: { name: string }) => e.name);
      // components (dir) before index.ts (file)
      expect(names).toEqual(['components', 'index.ts']);
    });

    it('empty dir returns empty array', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=empty-dir`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('returns 404 for missing path', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=nonexistent`),
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for missing project', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/projects/nonexistent-id/files?path='));
      expect(res.status).toBe(404);
    });

    it('returns file type and metadata', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, `/api/projects/${projectId}/files?path=`));
      const data = await res.json();
      const readme = data.find((e: { name: string }) => e.name === 'README.md');
      expect(readme).toBeDefined();
      expect(readme.type).toBe('file');
      expect(readme.size).toBeGreaterThan(0);
      expect(readme.modifiedAt).toBeTruthy();
      const src = data.find((e: { name: string }) => e.name === 'src');
      expect(src.type).toBe('directory');
      expect(src.size).toBe(0);
    });

    it('omits query param defaults to root', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, `/api/projects/${projectId}/files`));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     READ FILE
     ══════════════════════════════════════════════════════════════════════ */

  describe('GET /:id/files/read — read file', () => {
    it('reads a text file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=README.md`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe('# Test Project\n');
      expect(data.encoding).toBe('utf-8');
      expect(data.size).toBeGreaterThan(0);
      expect(data.modifiedAt).toBeTruthy();
    });

    it('returns 404 for missing file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=does-not-exist.ts`),
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 for directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=src`),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for binary file', async () => {
      const token = await getToken();
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=image.png`),
      );
      expect(res.status).toBe(400);
    });

    it('returns 413 for files over 1MB', async () => {
      const token = await getToken();
      // Create a file just over 1MB
      const bigContent = 'x'.repeat(1024 * 1024 + 10);
      writeFileSync(join(testDir, 'big.txt'), bigContent);
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=big.txt`),
      );
      expect(res.status).toBe(413);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     WRITE FILE
     ══════════════════════════════════════════════════════════════════════ */

  describe('PUT /:id/files/write — write file', () => {
    it('creates a new file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/write?path=new-file.ts`, {
          method: 'PUT',
          body: { content: 'const x = 1;' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.path).toBe('new-file.ts');
      expect(data.size).toBeGreaterThan(0);
    });

    it('overwrites existing file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/write?path=README.md`, {
          method: 'PUT',
          body: { content: '# Updated\n' },
        }),
      );
      expect(res.status).toBe(200);
      // Verify content changed
      const readRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=README.md`),
      );
      const readData = await readRes.json();
      expect(readData.content).toBe('# Updated\n');
    });

    it('returns 400 for missing parent directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/write?path=nonexistent/file.ts`, {
          method: 'PUT',
          body: { content: 'test' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for directory target', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/write?path=src`, {
          method: 'PUT',
          body: { content: 'test' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 413 for content > 1MB when overwriting', async () => {
      const token = await getToken();
      const bigContent = 'x'.repeat(1024 * 1024 + 10);
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/write?path=README.md`, {
          method: 'PUT',
          body: { content: bigContent },
        }),
      );
      expect(res.status).toBe(413);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     CREATE FILE / DIRECTORY
     ══════════════════════════════════════════════════════════════════════ */

  describe('POST /:id/files — create file/directory', () => {
    it('creates a new file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { path: 'new-file.js', type: 'file' },
        }),
      );
      expect(res.status).toBe(201);
    });

    it('creates a new directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { path: 'new-dir', type: 'directory' },
        }),
      );
      expect(res.status).toBe(201);
    });

    it('creates nested directories recursively', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { path: 'a/b/c', type: 'directory' },
        }),
      );
      expect(res.status).toBe(201);
    });

    it('returns 409 for existing path', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { path: 'src', type: 'directory' },
        }),
      );
      expect(res.status).toBe(409);
    });

    it('returns 400 for file without parent dir', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { path: 'nonexistent/file.ts', type: 'file' },
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     DELETE FILE / DIRECTORY
     ══════════════════════════════════════════════════════════════════════ */

  describe('DELETE /:id/files — delete', () => {
    it('deletes a file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=empty-file.txt`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);
    });

    it('deletes an empty directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=empty-dir`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(200);
    });

    it('returns 400 for non-empty dir without force', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=src`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(400);
    });

    it('deletes non-empty dir with force=true', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=src&force=true`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=nonexistent`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     RENAME
     ══════════════════════════════════════════════════════════════════════ */

  describe('PUT /:id/files/rename — rename', () => {
    it('renames a file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: 'README.md', newPath: 'README_renamed.md' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.oldPath).toBe('README.md');
      expect(data.newPath).toBe('README_renamed.md');
    });

    it('renames a directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: 'empty-dir', newPath: 'renamed-dir' },
        }),
      );
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing source', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: 'missing.txt', newPath: 'new.txt' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 for existing destination', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: 'README.md', newPath: 'empty-file.txt' },
        }),
      );
      expect(res.status).toBe(409);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     PATH TRAVERSAL TESTS (CRITICAL SECURITY)
     ══════════════════════════════════════════════════════════════════════ */

  describe('path traversal prevention', () => {
    it('blocks ../ traversal — ../../etc/passwd → 403', async () => {
      const token = await getToken();
      const cases = ['../../etc/passwd', '../etc/passwd', 'subdir/../../../root'];
      for (const p of cases) {
        const res = await app.handle(
          authReq(token, `/api/projects/${projectId}/files/read?path=${encodeURIComponent(p)}`),
        );
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toMatch(/traversal/i);
      }
    });

    it('blocks absolute paths — /etc/passwd → 403', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(
          token,
          `/api/projects/${projectId}/files/read?path=${encodeURIComponent('/etc/passwd')}`,
        ),
      );
      expect(res.status).toBe(403);
    });

    it('blocks null byte injection', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(
          token,
          `/api/projects/${projectId}/files/read?path=${encodeURIComponent('valid\0/etc/passwd')}`,
        ),
      );
      expect(res.status).toBe(400);
    });

    it('allows valid nested paths', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=src/components/Button.tsx`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe('export const Button = () => null;\n');
    });

    it('blocks write via traversal', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(
          token,
          `/api/projects/${projectId}/files/write?path=${encodeURIComponent('../../../danger.txt')}`,
          {
            method: 'PUT',
            body: { content: 'evil' },
          },
        ),
      );
      expect(res.status).toBe(403);
    });

    it('blocks delete via traversal', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files?path=${encodeURIComponent('../../etc')}`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(403);
    });

    it('blocks rename via traversal', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: '../etc', newPath: 'ok.txt' },
        }),
      );
      expect(res.status).toBe(403);
    });

    it('blocks rename destination traversal', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/rename`, {
          method: 'PUT',
          body: { oldPath: 'README.md', newPath: '../../etc' },
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     COPY FILE / DIRECTORY
     ══════════════════════════════════════════════════════════════════════ */

  describe('POST /:id/files/copy — copy', () => {
    it('copies a file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'README.md', destPath: 'README-copy.md' },
        }),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sourcePath).toBe('README.md');
      expect(data.destPath).toBe('README-copy.md');
      // Verify the copy exists and has same content
      const readRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=README-copy.md`),
      );
      expect(readRes.status).toBe(200);
      const readData = await readRes.json();
      expect(readData.content).toBe('# Test Project\n');
    });

    it('copies a directory recursively', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'src', destPath: 'src-copy' },
        }),
      );
      expect(res.status).toBe(201);
      // Verify nested file was copied
      const readRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=src-copy/index.ts`),
      );
      expect(readRes.status).toBe(200);
    });

    it('returns 404 for missing project', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects/nonexistent/files/copy', {
          method: 'POST',
          body: { sourcePath: 'README.md', destPath: 'out.md' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for missing source', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'nonexistent.md', destPath: 'out.md' },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 when destination already exists', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'README.md', destPath: 'empty-file.txt' },
        }),
      );
      expect(res.status).toBe(409);
    });

    it('returns 400 when parent directory does not exist', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'README.md', destPath: 'nonexistent-dir/out.md' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 403 on path traversal in sourcePath', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: '../../etc/passwd', destPath: 'out.txt' },
        }),
      );
      expect(res.status).toBe(403);
    });

    it('returns 403 on path traversal in destPath', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          body: { sourcePath: 'README.md', destPath: '../../out.md' },
        }),
      );
      expect(res.status).toBe(403);
    });

    it('returns 401 without token', async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/files/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: 'README.md', destPath: 'out.md' }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     DOWNLOAD FILE
     ══════════════════════════════════════════════════════════════════════ */

  describe('GET /:id/files/download — download', () => {
    it('downloads a text file as binary', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=README.md`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain('attachment');
      expect(res.headers.get('content-disposition')).toContain('README.md');
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      const body = await res.text();
      expect(body).toBe('# Test Project\n');
    });

    it('downloads a binary file (png)', async () => {
      const token = await getToken();
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      writeFileSync(join(testDir, 'icon.png'), pngBytes);
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=icon.png`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain('icon.png');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf).toEqual(pngBytes);
    });

    it('returns 404 for missing file', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=missing.txt`),
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 for directory', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=src`),
      );
      expect(res.status).toBe(400);
    });

    it('returns 413 for files over 50MB', async () => {
      const token = await getToken();
      const bigFile = join(testDir, 'big.bin');
      const size = 50 * 1024 * 1024 + 1;
      // Write sparse file using a buffer trick
      const buf = Buffer.alloc(1, 0);
      const { openSync, writeSync, closeSync } = await import('node:fs');
      const fd = openSync(bigFile, 'w');
      writeSync(fd, buf, 0, 1, size - 1);
      closeSync(fd);
      const res = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=big.bin`),
      );
      expect(res.status).toBe(413);
    });

    it('returns 403 on path traversal', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(
          token,
          `/api/projects/${projectId}/files/download?path=${encodeURIComponent('../../etc/passwd')}`,
        ),
      );
      expect(res.status).toBe(403);
    });

    it('returns 401 without token', async () => {
      const res = await app.handle(
        new Request(
          `http://localhost/api/projects/${projectId}/files/download?path=README.md`,
        ),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     UPLOAD FILE
     ══════════════════════════════════════════════════════════════════════ */

  describe('POST /:id/files/upload — upload', () => {
    function makeUploadReq(
      token: string,
      projectId: string,
      targetPath: string,
      fileName: string,
      fileContent: Uint8Array | string,
      contentType = 'text/plain',
    ) {
      const form = new FormData();
      const blob = new Blob([fileContent], { type: contentType });
      form.append('file', new File([blob], fileName, { type: contentType }));
      return new Request(
        `http://localhost/api/projects/${projectId}/files/upload?path=${encodeURIComponent(targetPath)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
      );
    }

    it('uploads a text file', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, projectId, '', 'uploaded.txt', 'hello world'),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.path).toBe('uploaded.txt');
      expect(data.size).toBeGreaterThan(0);
      // Verify content
      const readRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/read?path=uploaded.txt`),
      );
      expect(readRes.status).toBe(200);
      const readData = await readRes.json();
      expect(readData.content).toBe('hello world');
    });

    it('uploads a binary file without corruption', async () => {
      const token = await getToken();
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef]);
      const res = await app.handle(
        makeUploadReq(token, projectId, '', 'image.png', pngBytes, 'image/png'),
      );
      expect(res.status).toBe(201);
      // Download and verify bytes preserved
      const dlRes = await app.handle(
        authReq(token, `/api/projects/${projectId}/files/download?path=image.png`),
      );
      expect(dlRes.status).toBe(200);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      expect(Array.from(buf)).toEqual(Array.from(pngBytes));
    });

    it('uploads to a subdirectory', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, projectId, 'src', 'new-component.ts', 'export {}'),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.path).toBe('src/new-component.ts');
    });

    it('returns 409 when file already exists', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, projectId, '', 'README.md', '# collision'),
      );
      expect(res.status).toBe(409);
    });

    it('returns 400 when target directory does not exist', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, projectId, 'nonexistent-dir', 'file.txt', 'content'),
      );
      expect(res.status).toBe(400);
    });

    it('returns 403 on path traversal in path query', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, projectId, '../../etc', 'pwned.txt', 'evil'),
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 for missing project', async () => {
      const token = await getToken();
      const res = await app.handle(
        makeUploadReq(token, 'nonexistent-project', '', 'file.txt', 'content'),
      );
      expect(res.status).toBe(404);
    });

    it('returns 401 without token', async () => {
      const form = new FormData();
      form.append('file', new File(['hello'], 'test.txt', { type: 'text/plain' }));
      const res = await app.handle(
        new Request(`http://localhost/api/projects/${projectId}/files/upload?path=`, {
          method: 'POST',
          body: form,
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     GET /api/files/directories — list directories
     ══════════════════════════════════════════════════════════════════════ */

  describe('GET /api/files/directories', () => {
    it('returns list of directories for a valid path', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(testDir)}`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.directories).toBeDefined();
      expect(Array.isArray(data.directories)).toBe(true);
      const names = data.directories.map((d: { name: string }) => d.name);
      expect(names).toContain('src');
      expect(names).toContain('empty-dir');
    });

    it('returns only directories, not files', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(testDir)}`),
      );
      const data = await res.json();
      const names = data.directories.map((d: { name: string }) => d.name);
      expect(names).not.toContain('README.md');
      expect(names).not.toContain('empty-file.txt');
    });

    it('filters hidden directories starting with dot', async () => {
      mkdirSync(join(testDir, '.hidden'));
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(testDir)}`),
      );
      const data = await res.json();
      const names = data.directories.map((d: { name: string }) => d.name);
      expect(names).not.toContain('.hidden');
      expect(names).toContain('src');
    });

    it('returns 404 for non-existent path', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/files/directories?path=/nonexistent/path/xyz'),
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 for missing path parameter', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/files/directories?path='));
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-absolute path', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/files/directories?path=relative/path'));
      expect(res.status).toBe(400);
    });

    it('returns 400 when path points to a file', async () => {
      const token = await getToken();
      const filePath = join(testDir, 'README.md');
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(filePath)}`),
      );
      expect(res.status).toBe(400);
    });

    it('normalizes path and returns directories', async () => {
      // Create a subdirectory under src
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(join(testDir, 'src'))}`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      const names = data.directories.map((d: { name: string }) => d.name);
      expect(names).toContain('components');
    });

    it('returns each entry with name and full path', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, `/api/files/directories?path=${encodeURIComponent(testDir)}`),
      );
      const data = await res.json();
      const srcEntry = data.directories.find((d: { name: string }) => d.name === 'src');
      expect(srcEntry).toBeDefined();
      expect(srcEntry.name).toBe('src');
      expect(srcEntry.path).toBe(join(testDir, 'src'));
    });
  });
});
