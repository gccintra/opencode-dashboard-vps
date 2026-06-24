/**
 * Conversations route tests.
 *
 * GET /api/conversations scans ~/.claude/projects/<dir>/*.jsonl. The scan
 * directory is resolved via os.homedir() at MODULE LOAD time, so each test
 * sets process.env.HOME to a temp dir and re-imports the route module
 * (vi.resetModules) before building the app. This isolates the test from the
 * real machine's conversation history.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface Conversation {
  id: string;
  cwd: string;
  firstMessage: string;
  timestamp: string;
  mtime: number;
}

const OLD_ENV = { ...process.env };
const VALID_UUID = '00ec27b6-3151-4763-8a74-7a80b648ca87';

describe('conversations route', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let homeDir: string;
  let projectsDir: string;

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
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Write a conversation JSONL file with the given lines (objects). */
  function writeConversation(dir: string, id: string, lines: unknown[]): void {
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    writeFileSync(join(projectsDir, dir, `${id}.jsonl`), text);
  }

  async function buildApp(): Promise<void> {
    vi.resetModules();

    // Mutate process.env in place — reassigning it to a fresh object detaches
    // it from the native environ, so os.homedir() would ignore HOME.
    process.env.HOME = homeDir;
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

    const { validateAuthEnv } = await import('../auth/env');
    validateAuthEnv();

    const { authRoutes } = await import('../auth/index');
    const { conversationsRoutes } = await import('./conversations');
    app = new Elysia().use(authRoutes).use(conversationsRoutes);
  }

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'opencode-test-conv-home-'));
    projectsDir = join(homeDir, '.claude', 'projects');
  });

  afterEach(() => {
    // Restore env in place (see buildApp note on not reassigning process.env).
    if (OLD_ENV.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = OLD_ENV.HOME;
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns 401 without a token', async () => {
    mkdirSync(projectsDir, { recursive: true });
    await buildApp();
    const res = await app.handle(new Request('http://localhost/api/conversations'));
    expect(res.status).toBe(401);
  });

  it('returns an empty array when ~/.claude/projects does not exist', async () => {
    // Intentionally do NOT create projectsDir.
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations).toEqual([]);
  });

  it('parses a conversation and extracts id, cwd, timestamp, and firstMessage', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    writeConversation('-root-proj', VALID_UUID, [
      { type: 'last-prompt', leafUuid: 'x' },
      { type: 'mode', mode: 'default' },
      {
        type: 'user',
        cwd: '/root/code_projects/app',
        timestamp: '2026-06-21T17:48:46.770Z',
        message: { role: 'user', content: 'pq o pty node ta subindo no bun run dev?' },
      },
    ]);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };

    expect(body.conversations).toHaveLength(1);
    const c = body.conversations[0];
    expect(c.id).toBe(VALID_UUID);
    expect(c.cwd).toBe('/root/code_projects/app');
    expect(c.timestamp).toBe('2026-06-21T17:48:46.770Z');
    expect(c.firstMessage).toBe('pq o pty node ta subindo no bun run dev?');
    expect(typeof c.mtime).toBe('number');
  });

  it('extracts firstMessage from array-style content (text block)', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    writeConversation('-root-proj', VALID_UUID, [
      {
        type: 'user',
        cwd: '/root/app',
        timestamp: '2026-06-21T00:00:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'image', source: {} },
            { type: 'text', text: 'hello from an array block' },
          ],
        },
      },
    ]);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations[0].firstMessage).toBe('hello from an array block');
  });

  it('truncates firstMessage to 120 chars', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    const long = 'a'.repeat(300);
    writeConversation('-root-proj', VALID_UUID, [
      { type: 'user', cwd: '/x', message: { role: 'user', content: long } },
    ]);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations[0].firstMessage.length).toBe(120);
  });

  it('falls back to "[no message]" when no user message exists', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    writeConversation('-root-proj', VALID_UUID, [
      { type: 'mode', mode: 'default' },
      { type: 'assistant', message: { role: 'assistant', content: 'hi' } },
    ]);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations[0].firstMessage).toBe('[no message]');
  });

  it('ignores files whose stem is not a valid UUID', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    writeConversation('-root-proj', 'not-a-uuid', [
      { type: 'user', cwd: '/x', message: { role: 'user', content: 'hi' } },
    ]);
    writeConversation('-root-proj', VALID_UUID, [
      { type: 'user', cwd: '/y', message: { role: 'user', content: 'valid' } },
    ]);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].id).toBe(VALID_UUID);
  });

  it('skips non-jsonl files', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    writeFileSync(join(projectsDir, '-root-proj', 'readme.txt'), 'not jsonl');
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations).toEqual([]);
  });

  it('sorts conversations by mtime descending across project dirs', async () => {
    mkdirSync(join(projectsDir, '-proj-a'), { recursive: true });
    mkdirSync(join(projectsDir, '-proj-b'), { recursive: true });
    const idA = '11111111-1111-4111-8111-111111111111';
    const idB = '22222222-2222-4222-8222-222222222222';
    writeConversation('-proj-a', idA, [
      { type: 'user', cwd: '/a', message: { role: 'user', content: 'older' } },
    ]);
    writeConversation('-proj-b', idB, [
      { type: 'user', cwd: '/b', message: { role: 'user', content: 'newer' } },
    ]);
    // Bump idB's mtime to be clearly newer than idA's.
    const { utimesSync } = await import('node:fs');
    const now = Date.now() / 1000;
    utimesSync(join(projectsDir, '-proj-a', `${idA}.jsonl`), now - 100, now - 100);
    utimesSync(join(projectsDir, '-proj-b', `${idB}.jsonl`), now, now);

    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations.map((c) => c.id)).toEqual([idB, idA]);
  });

  it('skips malformed JSON lines gracefully', async () => {
    mkdirSync(join(projectsDir, '-root-proj'), { recursive: true });
    const text =
      'not json at all\n' +
      JSON.stringify({
        type: 'user',
        cwd: '/x',
        message: { role: 'user', content: 'recovered after bad line' },
      }) +
      '\n';
    writeFileSync(join(projectsDir, '-root-proj', `${VALID_UUID}.jsonl`), text);
    await buildApp();
    const token = await getToken();
    const res = await app.handle(authReq(token, '/api/conversations'));
    const body = (await res.json()) as { conversations: Conversation[] };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].firstMessage).toBe('recovered after bad line');
  });
});
