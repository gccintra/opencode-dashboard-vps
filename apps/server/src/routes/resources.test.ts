/**
 * Tests for the resources API routes and scan logic.
 *
 * Because the scanner reads from `homedir()/.config/opencode/...`,
 * tests create a temp directory structure and mock `homedir()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OLD_ENV = { ...process.env };

// hoisted mock path — must be above vi.mock() so the factory can reference it
const mockPaths = vi.hoisted(() => ({ homeDir: '' }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let testHomeDir: string;

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

function authReq(token: string, path: string, options: { method?: string; body?: unknown } = {}) {
  const { method = 'GET', body } = options;
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Build a temp directory structure mimicking ~/.config/opencode/
 */
function setupMockOpenCodeDir(): void {
  const skillsDir = join(testHomeDir, '.config', 'opencode', 'skills');
  const mySkillDir = join(skillsDir, 'my-skill');
  mkdirSync(mySkillDir, { recursive: true });
  writeFileSync(
    join(mySkillDir, 'SKILL.md'),
    '---\nname: my-skill\n---\n\nA custom skill for testing\n\nMore content...\n',
  );

  const otherSkillDir = join(skillsDir, 'other-skill');
  mkdirSync(otherSkillDir, { recursive: true });
  writeFileSync(join(otherSkillDir, 'SKILL.md'), 'Another skill description');

  const agentsDir = join(testHomeDir, '.config', 'opencode', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'my-agent.md'), '# My Agent\n\nHandles automated tasks\n');

  const mcpsDir = join(testHomeDir, '.config', 'opencode', 'mcps');
  mkdirSync(mcpsDir, { recursive: true });
  writeFileSync(
    join(mcpsDir, 'test-mcp.json'),
    JSON.stringify({ name: 'test-mcp', description: 'A test MCP server' }),
  );
}

/** Directly insert a project into the DB. Uses dynamic import because
 * modules are reset between tests, so we can't capture getDb at file level. */
async function insertProject(id: string, name: string) {
  const { getDb } = await import('../db/client');
  getDb().run(
    'INSERT INTO projects (id, name, directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, testHomeDir, new Date().toISOString(), new Date().toISOString()],
  );
}

describe('resources routes', () => {
  beforeEach(async () => {
    vi.resetModules();

    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    testHomeDir = join(tmpdir(), `opencode-test-home-${Date.now()}`);
    mkdirSync(testHomeDir, { recursive: true });
    mockPaths.homeDir = testHomeDir;

    vi.mock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, homedir: () => mockPaths.homeDir };
    });

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { initDb } = await import('../db/client');
    initDb(':memory:');

    setupMockOpenCodeDir();

    const { scanResources, resourcesRoutes } = await import('./resources');
    scanResources();

    const { authRoutes } = await import('../auth');
    app = new Elysia().use(authRoutes).use(resourcesRoutes);
  });

  afterEach(() => {
    try {
      rmSync(testHomeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /* ── GET /api/resources ─────────────────────────────────────── */

  describe('GET /api/resources', () => {
    it('returns all scanned resources', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/resources'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { resources: unknown[]; count: number };
      expect(body.resources).toHaveLength(4);
      expect(body.count).toBe(4);
    });

    it('filters by type=skill', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/resources?type=skill'));
      const body = (await res.json()) as { resources: { type: string }[] };
      expect(body.resources).toHaveLength(2);
      expect(body.resources.every((r) => r.type === 'skill')).toBe(true);
    });

    it('filters by type=agent', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/resources?type=agent'));
      const body = (await res.json()) as { resources: { type: string }[] };
      expect(body.resources).toHaveLength(1);
      expect(body.resources[0].type).toBe('agent');
    });

    it('filters by type=mcp', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/resources?type=mcp'));
      const body = (await res.json()) as { resources: { type: string }[] };
      expect(body.resources).toHaveLength(1);
      expect(body.resources[0].type).toBe('mcp');
    });

    it('returns 401 without auth', async () => {
      const res = await app.handle(new Request('http://localhost/api/resources'));
      expect(res.status).toBe(401);
    });
  });

  /* ── POST /api/resources/scan ───────────────────────────────── */

  describe('POST /api/resources/scan', () => {
    it('rescans and returns updated resources', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/resources/scan', { method: 'POST' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { resources: unknown[]; scannedAt: string };
      expect(body.resources).toHaveLength(4);
      expect(typeof body.scannedAt).toBe('string');
    });
  });

  /* ── GET /api/projects/:id/resources ─────────────────────────── */

  describe('GET /api/projects/:id/resources', () => {
    beforeEach(async () => {
      await insertProject('rc-test', 'rc-test');
    });

    it('returns resources for an existing project', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/projects/rc-test/resources'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        resources: { resourceId: string; active: boolean; available: boolean }[];
      };
      expect(body.resources).toHaveLength(4);
      expect(body.resources.every((r) => r.active === false)).toBe(true);
    });

    it('returns 404 for nonexistent project', async () => {
      const token = await getToken();
      const res = await app.handle(authReq(token, '/api/projects/no-such/res'));
      expect(res.status).toBe(404);
    });
  });

  /* ── PUT /api/projects/:id/resources/:resourceId ─────────────── */

  describe('PUT /api/projects/:id/resources/:resourceId', () => {
    beforeEach(async () => {
      await insertProject('rc-toggle', 'rc-toggle');
    });

    it('activates a resource (first toggle = insert + active)', async () => {
      const token = await getToken();
      const res = await app.handle(
        authReq(token, '/api/projects/rc-toggle/resources/skill%3Amy-skill', { method: 'PUT' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { active: boolean };
      expect(body.active).toBe(true);
    });

    it('toggles a resource off and on', async () => {
      const token = await getToken();

      const r1 = await app.handle(
        authReq(token, '/api/projects/rc-toggle/resources/skill%3Amy-skill', { method: 'PUT' }),
      );
      expect(((await r1.json()) as { active: boolean }).active).toBe(true);

      const r2 = await app.handle(
        authReq(token, '/api/projects/rc-toggle/resources/skill%3Amy-skill', { method: 'PUT' }),
      );
      expect(((await r2.json()) as { active: boolean }).active).toBe(false);

      const r3 = await app.handle(
        authReq(token, '/api/projects/rc-toggle/resources/skill%3Amy-skill', { method: 'PUT' }),
      );
      expect(((await r3.json()) as { active: boolean }).active).toBe(true);
    });

    it('reflects toggled state in GET', async () => {
      const token = await getToken();
      await app.handle(
        authReq(token, '/api/projects/rc-toggle/resources/skill%3Amy-skill', { method: 'PUT' }),
      );

      const res = await app.handle(authReq(token, '/api/projects/rc-toggle/resources'));
      const body = (await res.json()) as {
        resources: { resourceId: string; active: boolean }[];
      };

      const toggled = body.resources.find((r) => r.resourceId === 'skill:my-skill');
      expect(toggled?.active).toBe(true);
    });
  });

  /* ── DELETE /api/projects/:id/resources/unavailable ──────────── */

  describe('DELETE /api/projects/:id/resources/unavailable', () => {
    it('removes orphan configs for resources no longer on disk', async () => {
      await insertProject('rc-cleanup', 'rc-cleanup');

      // Directly insert an orphan resource row
      const { getDb } = await import('../db/client');
      getDb().run(
        'INSERT INTO project_resources (project_id, resource_id, active) VALUES (?, ?, 1)',
        ['rc-cleanup', 'skill:deleted-skill'],
      );

      const token = await getToken();

      // Verify orphan shows as unavailable
      const r1 = await app.handle(authReq(token, '/api/projects/rc-cleanup/resources'));
      const body1 = (await r1.json()) as {
        resources: { resourceId: string; available: boolean }[];
      };
      const orphan = body1.resources.find((r) => r.resourceId === 'skill:deleted-skill');
      expect(orphan?.available).toBe(false);

      // Clean up
      const r2 = await app.handle(
        authReq(token, '/api/projects/rc-cleanup/resources/unavailable', { method: 'DELETE' }),
      );
      expect(r2.status).toBe(200);
      const body2 = (await r2.json()) as { removed: number };
      expect(body2.removed).toBe(1);

      // Verify orphan is gone
      const r3 = await app.handle(authReq(token, '/api/projects/rc-cleanup/resources'));
      const body3 = (await r3.json()) as { resources: { resourceId: string }[] };
      expect(body3.resources.find((r) => r.resourceId === 'skill:deleted-skill')).toBeUndefined();
    });
  });

  /* ── Scan functions (unit) ──────────────────────────────────── */

  describe('scanResources', () => {
    it('populates the cache with skills, agents, and mcps', async () => {
      const { scanResources, getCachedResources } = await import('./resources');
      const results = scanResources();
      expect(results.some((r) => r.id === 'skill:my-skill')).toBe(true);
      expect(results.some((r) => r.id === 'skill:other-skill')).toBe(true);
      expect(results.some((r) => r.id === 'agent:my-agent')).toBe(true);
      expect(results.some((r) => r.id === 'mcp:test-mcp')).toBe(true);
      expect(getCachedResources()).toEqual(results);
    });

    it('handles missing directories gracefully', async () => {
      const emptyHomeDir = join(tmpdir(), `opencode-empty-${Date.now()}`);
      mkdirSync(emptyHomeDir, { recursive: true });
      mockPaths.homeDir = emptyHomeDir;

      vi.resetModules();
      const { scanResources } = await import('./resources');
      const results = scanResources();
      expect(results).toEqual([]);

      try {
        rmSync(emptyHomeDir, { recursive: true, force: true });
      } catch {
        //
      }
      mockPaths.homeDir = testHomeDir;
    });
  });

  /* ── getActiveResourcesForProject ───────────────────────────── */

  describe('getActiveResourcesForProject', () => {
    it('returns empty arrays when no resources are active', async () => {
      const { getActiveResourcesForProject, scanResources } = await import('./resources');
      scanResources();
      const result = getActiveResourcesForProject('no-such-project');
      expect(result.skills).toEqual([]);
      expect(result.agents).toEqual([]);
      expect(result.mcps).toEqual([]);
    });

    it('returns active resource names', async () => {
      await insertProject('rc-env', 'rc-env');

      const token = await getToken();
      await app.handle(
        authReq(token, '/api/projects/rc-env/resources/skill%3Amy-skill', { method: 'PUT' }),
      );
      await app.handle(
        authReq(token, '/api/projects/rc-env/resources/agent%3Amy-agent', { method: 'PUT' }),
      );

      const { getActiveResourcesForProject } = await import('./resources');
      const result = getActiveResourcesForProject('rc-env');
      expect(result.skills).toContain('my-skill');
      expect(result.agents).toContain('my-agent');
      expect(result.mcps).toEqual([]);
    });
  });
});
