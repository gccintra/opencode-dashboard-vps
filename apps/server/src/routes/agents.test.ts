/**
 * Tests for the Agents Panel API.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Elysia } from 'elysia';

// ── PTY manager mock ────────────────────────────────────────────────
const mockManager = vi.hoisted(() => ({
  spawnSession: vi.fn(),
  killSession: vi.fn(),
  writeToSession: vi.fn(),
  resizeSession: vi.fn(),
  onSessionData: vi.fn(),
  onSessionExit: vi.fn(),
  onSessionStatus: vi.fn(),
  getSessionBuffer: vi.fn(() => ''),
  getSessionStatus: vi.fn(() => null),
  listSessions: vi.fn(),
  shutdown: vi.fn(),
  startStatusMonitor: vi.fn(),
  start: vi.fn(),
}));

vi.mock('../pty/manager', () => ({
  getPtyManager: () => mockManager,
  PtyManager: class {},
  resetPtyManager: vi.fn(),
}));

// ── env save/restore ────────────────────────────────────────────────
const OLD_ENV = { ...process.env };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
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

function authReq(token: string, path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

describe('Agents API', () => {
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    // Dynamic imports after env vars and mocks are set.
    const { authRoutes } = await import('../auth');
    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv(); // Initialize the auth module's in-memory env vars.
    const { agentsRoutes } = await import('./agents');
    const { initDb, getDb } = await import('../db/client');

    try {
      initDb();
    } catch {
      /* already */
    }
    const db = getDb();
    db.run('DELETE FROM tasks');
    db.run('DELETE FROM project_resources');
    db.run('DELETE FROM projects');
    db.run(
      "INSERT INTO projects (id, name, directory, created_at, updated_at) VALUES ('proj-1', 'Test Project', '/tmp/test', datetime('now'), datetime('now'))",
    );

    app = new Elysia().use(authRoutes).use(agentsRoutes);
    token = await getToken();
  });

  afterAll(async () => {
    const { closeDb } = await import('../db/client');
    try {
      closeDb();
    } catch {
      /* */
    }
    process.env = { ...OLD_ENV };
  });

  beforeEach(async () => {
    const { resetSessionMeta } = await import('./sessions');
    resetSessionMeta();
    // Reset mock return values.
    mockManager.getSessionBuffer.mockReturnValue('');
    mockManager.getSessionStatus.mockReturnValue(null);
  });

  // ── GET /api/agents ──

  it('returns empty array when no sessions exist', async () => {
    const res = await app.handle(authReq(token, '/api/agents'));
    const body = (await res.json()) as unknown[];
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns agents for all sessions across projects', async () => {
    const { setSessionMeta } = await import('./sessions');

    setSessionMeta('s1', {
      sessionId: 's1',
      projectId: 'proj-1',
      name: 'Session One',
      status: 'active',
      type: 'project',
      createdAt: Date.now(),
    });
    setSessionMeta('s2', {
      sessionId: 's2',
      projectId: null,
      name: 'Emergency Root',
      status: 'active',
      type: 'emergency',
      createdAt: Date.now(),
    });

    const res = await app.handle(authReq(token, '/api/agents'));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(res.status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(2);

    const s1 = body.find((a) => a.id === 's1');
    expect(s1).toBeDefined();
    expect(s1!.name).toBe('Session One');
    expect(s1!.projectName).toBe('Test Project');

    const s2 = body.find((a) => a.id === 's2');
    expect(s2).toBeDefined();
    expect(s2!.type).toBe('emergency');
  });

  it('filters by projectId', async () => {
    const { setSessionMeta } = await import('./sessions');

    setSessionMeta('p1', {
      sessionId: 'p1',
      projectId: 'proj-1',
      name: 'P1',
      status: 'active',
      type: 'project',
      createdAt: Date.now(),
    });
    setSessionMeta('p2', {
      sessionId: 'p2',
      projectId: 'other',
      name: 'P2',
      status: 'active',
      type: 'project',
      createdAt: Date.now(),
    });

    const res = await app.handle(authReq(token, '/api/agents?projectId=proj-1'));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('p1');
  });

  it('filters by status query param', async () => {
    const { setSessionMeta } = await import('./sessions');

    setSessionMeta('s-active', {
      sessionId: 's-active',
      projectId: 'proj-1',
      name: 'Active',
      status: 'active',
      type: 'project',
      createdAt: Date.now(),
    });

    const res = await app.handle(authReq(token, '/api/agents?status=active'));
    const body = (await res.json()) as unknown[];
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('has output preview on every agent', async () => {
    const { setSessionMeta } = await import('./sessions');

    setSessionMeta('s-out', {
      sessionId: 's-out',
      projectId: 'proj-1',
      name: 'Output',
      status: 'active',
      type: 'project',
      createdAt: Date.now(),
    });

    const res = await app.handle(authReq(token, '/api/agents'));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const agent = body.find((a) => a.id === 's-out');
    expect(agent).toBeDefined();
    expect(typeof (agent as Record<string, unknown>).outputPreview).toBe('string');
  });

  it('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/api/agents'));
    expect(res.status).toBe(401);
  });

  // ── GET /api/agents/metrics ──

  it('returns zero metrics when no sessions', async () => {
    const res = await app.handle(authReq(token, '/api/agents/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(res.status).toBe(200);
    expect(body).toEqual({ total: 0, active: 0, waiting: 0, finished: 0, emergency: 0 });
  });

  it('counts emergency separately from total', async () => {
    const { setSessionMeta } = await import('./sessions');

    setSessionMeta('emerg', {
      sessionId: 'emerg',
      projectId: null,
      name: 'Root',
      status: 'active',
      type: 'emergency',
      createdAt: Date.now(),
    });

    const res = await app.handle(authReq(token, '/api/agents/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(body.emergency).toBe(1);
    expect(body.total).toBe(0);
  });

  it('metrics returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/api/agents/metrics'));
    expect(res.status).toBe(401);
  });
});
