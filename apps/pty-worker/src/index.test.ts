/**
 * pty-worker handler tests.
 *
 * These tests exercise the pure handler functions in `./index.ts` without
 * spawning a real node-pty process. `node-pty` is mocked so we never
 * trigger the native addon initialisation that would segfault on the wrong
 * Node ABI (see Task 08 — node-pty requires Node 18's `libnode.so.109`).
 *
 * Strategy: build a `FakePty` that mimics node-pty's `IPty` interface
 * (pid, onData, onExit, write, resize, kill) backed by an EventEmitter,
 * inject it via the `ptySpawn` dependency, then assert that each handler
 * produces the correct `ServerMessage` responses and routes PTY events
 * through the response writer.
 *
 * We also test the IPC loop (`startIpcLoop`) with an in-memory
 * readline.Interface fed by a Readable stream, so the full
 * stdin → JSON parse → handler → stdout path is covered.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';

// Mock node-pty BEFORE importing the index. The mock factory returns the
// minimum surface used by the source: just `spawn`. We capture the function
// reference so individual tests can configure its return value.
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

import * as pty from 'node-pty';
import { handleMessage, startIpcLoop, type HandleDeps, type PtySpawnFn } from './index';
import type { IPty } from 'node-pty';
import type { ClientMessage, ServerMessage } from './protocol';

// ── Fake IPty ──────────────────────────────────────────────────────

/**
 * A stand-in for node-pty's `IPty`. We can't construct a real one in this
 * test environment (Node ABI may mismatch, the prebuild may be missing, etc.)
 * and we don't need to — we just need an EventEmitter-shaped object that
 * the worker can wire up via `onData` / `onExit` and drive via `write` /
 * `resize` / `kill`.
 */
class FakePty extends EventEmitter {
  pid = 12345;
  cols = 80;
  rows = 24;
  writes: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  killed = false;

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
    // Real node-pty emits an 'exit' event after kill; mirror that.
    queueMicrotask(() => this.emit('exit', { exitCode: 0, signal: 0 }));
  }
  // node-pty's onData/onExit are direct method aliases on IPty, not the
  // EventEmitter pattern. Provide them to match the interface.
  onData(cb: (data: string) => void): void {
    this.on('data', cb);
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.on('exit', cb);
  }
}

// ── Test context builder ───────────────────────────────────────────

interface Ctx {
  deps: HandleDeps;
  map: Map<string, IPty>;
  fake: FakePty;
  responses: ServerMessage[];
  ptySpawn: Mock;
}

function makeContext(opts: { fake?: FakePty; map?: Map<string, IPty> } = {}): Ctx {
  const map = opts.map ?? new Map<string, IPty>();
  const fake = opts.fake ?? new FakePty();
  const responses: ServerMessage[] = [];
  const ptySpawn = pty.spawn as unknown as Mock;
  ptySpawn.mockReset();
  ptySpawn.mockImplementation(() => fake as unknown as IPty);
  const write = (m: ServerMessage) => responses.push(m);
  const deps: HandleDeps = { ptySpawn: ptySpawn as unknown as PtySpawnFn, sessionsMap: map, write };
  return { deps, map, fake, responses, ptySpawn };
}

// ── spawn ──────────────────────────────────────────────────────────

describe('handleMessage — spawn', () => {
  it('creates a PTY and emits a `spawned` response with the pid', async () => {
    const { deps, responses, map, fake } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/srv/p1', command: 'bash' }, deps);
    // `spawned` is deferred via setImmediate so the event loop can process any
    // immediate exits before declaring the spawn successful.
    await new Promise<void>((r) => setImmediate(r));

    expect(pty.spawn).toHaveBeenCalledTimes(1);
    expect(responses[0]).toEqual({ type: 'spawned', id: 's1', pid: 12345 });
    expect(map.get('s1')).toBe(fake);
  });

  it('forwards cwd, command, args, cols, rows to pty.spawn', () => {
    const { deps, ptySpawn } = makeContext();
    handleMessage(
      {
        type: 'spawn',
        id: 's1',
        cwd: '/srv',
        command: 'opencode',
        args: ['--flag', 'value'],
        cols: 120,
        rows: 40,
      },
      deps,
    );
    expect(ptySpawn).toHaveBeenCalledWith(
      'opencode',
      ['--flag', 'value'],
      expect.objectContaining({
        cwd: '/srv',
        cols: 120,
        rows: 40,
        name: 'xterm-color',
      }),
    );
  });

  it('defaults cols=80, rows=24, args=[] when not provided', () => {
    const { deps, ptySpawn } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(ptySpawn).toHaveBeenCalledWith(
      'bash',
      [],
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
  });

  it('forwards PTY data events as base64-encoded `data` responses', () => {
    const { deps, fake, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    fake.emit('data', 'hello world');

    const encoded = Buffer.from('hello world', 'utf8').toString('base64');
    expect(responses).toContainEqual({ type: 'data', id: 's1', chunk: encoded, encoding: 'base64' });
  });

  it('forwards PTY exit events as `exit` responses and removes the session', async () => {
    const { deps, fake, responses, map } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    // Real node-pty's exit fires asynchronously; the handler in our
    // FakePty uses queueMicrotask. Yield once to let the event drain.
    fake.emit('exit', { exitCode: 0, signal: 0 });
    expect(responses).toContainEqual({ type: 'exit', id: 's1', code: 0 });
    expect(map.has('s1')).toBe(false);
  });

  it('emits an `error` response if pty.spawn throws', () => {
    const ptySpawn = vi.fn(() => {
      throw new Error('spawn failed');
    });
    const responses: ServerMessage[] = [];
    const deps: HandleDeps = {
      ptySpawn: ptySpawn as unknown as PtySpawnFn,
      sessionsMap: new Map(),
      write: (m) => responses.push(m),
    };
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({ type: 'error', id: 's1', message: 'spawn failed' });
  });

  it('rejects duplicate session ids with an error', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    responses.length = 0;
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({
      type: 'error',
      id: 's1',
      message: 'session already exists: s1',
    });
  });
});

// ── write ──────────────────────────────────────────────────────────

describe('handleMessage — write', () => {
  it('writes data to the PTY (preserving \\r for line breaks)', () => {
    const { deps, fake } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'write', id: 's1', data: 'ls\r' }, deps);
    expect(fake.writes).toEqual(['ls\r']);
  });

  it('emits an error when the session does not exist', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'write', id: 'sX', data: 'x' }, deps);
    expect(responses[0]).toEqual({
      type: 'error',
      id: 'sX',
      message: 'session not found: sX',
    });
  });
});

// ── resize ─────────────────────────────────────────────────────────

describe('handleMessage — resize', () => {
  it('forwards the new dimensions to the PTY', () => {
    const { deps, fake } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'resize', id: 's1', cols: 120, rows: 40 }, deps);
    expect(fake.resized).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('emits an error when the session does not exist', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'resize', id: 'sX', cols: 80, rows: 24 }, deps);
    expect(responses[0]).toEqual({
      type: 'error',
      id: 'sX',
      message: 'session not found: sX',
    });
  });

  it('emits an error when pty.resize throws', () => {
    const { deps, fake, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    // Override resize AFTER spawn so the spawn itself succeeds.
    fake.resize = () => {
      throw new Error('EINVAL');
    };
    handleMessage({ type: 'resize', id: 's1', cols: 0, rows: 0 }, deps);
    // `spawned` is deferred via setImmediate; only the error is synchronous here.
    expect(responses.at(-1)).toEqual({
      type: 'error',
      id: 's1',
      message: 'resize failed: EINVAL',
    });
  });
});

// ── kill ───────────────────────────────────────────────────────────

describe('handleMessage — kill', () => {
  it('kills the PTY, removes the session, and emits `killed`', () => {
    const { deps, fake, map, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'kill', id: 's1' }, deps);
    expect(fake.killed).toBe(true);
    expect(map.has('s1')).toBe(false);
    expect(responses).toContainEqual({ type: 'killed', id: 's1' });
  });

  it('is idempotent — emits `killed` even for unknown sessions', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'kill', id: 'sX' }, deps);
    expect(responses[0]).toEqual({ type: 'killed', id: 'sX' });
  });
});

// ── list ───────────────────────────────────────────────────────────

describe('handleMessage — list', () => {
  it('returns the active session ids in insertion order', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'spawn', id: 's2', cwd: '/tmp', command: 'bash' }, deps);
    responses.length = 0;
    handleMessage({ type: 'list' }, deps);
    expect(responses[0]).toEqual({ type: 'list', sessions: ['s1', 's2'] });
  });

  it('returns an empty list when no sessions are active', () => {
    const { deps, responses } = makeContext();
    handleMessage({ type: 'list' }, deps);
    expect(responses[0]).toEqual({ type: 'list', sessions: [] });
  });
});

// ── shutdown ───────────────────────────────────────────────────────

describe('handleMessage — shutdown', () => {
  it('kills all sessions and exits the process', () => {
    const { deps, fake } = makeContext();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'spawn', id: 's2', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'shutdown' }, deps);
    expect(fake.killed).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});

// ── IPC loop end-to-end ────────────────────────────────────────────

/**
 * Readline processes pushed data asynchronously. These tests yield to the
 * event loop with a microtask + macrotask flush so the 'line' event has a
 * chance to fire before we assert.
 */
async function flushReadline(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('startIpcLoop — end-to-end stdin → stdout', () => {
  it('parses a `list` request and emits a `list` response', async () => {
    const input = new Readable({ read() {} });
    const responses: ServerMessage[] = [];
    const rl = createInterface({ input });

    // Pre-populate the production sessions map so the list has content.
    const map = new Map<string, IPty>();
    const fake = new FakePty();
    map.set('seeded', fake as unknown as IPty);

    startIpcLoop({
      readline: rl,
      write: (m) => responses.push(m),
      handleDeps: { sessionsMap: map },
    });

    input.push(JSON.stringify({ type: 'list' }) + '\n');
    await flushReadline();

    expect(responses[0]).toEqual({ type: 'list', sessions: ['seeded'] });
  });

  it('rejects malformed JSON with an error and continues processing', async () => {
    const input = new Readable({ read() {} });
    const responses: ServerMessage[] = [];
    const rl = createInterface({ input });
    const map = new Map<string, IPty>();
    startIpcLoop({
      readline: rl,
      write: (m) => responses.push(m),
      handleDeps: { sessionsMap: map },
    });

    input.push('not-json\n');
    input.push(JSON.stringify({ type: 'list' }) + '\n');
    await flushReadline();

    expect(responses[0]).toMatchObject({ type: 'error' });
    expect((responses[0] as { message: string }).message).toMatch(/invalid JSON/);
    expect(responses[1]).toEqual({ type: 'list', sessions: [] });
  });

  it('rejects messages missing the `type` field', async () => {
    const input = new Readable({ read() {} });
    const responses: ServerMessage[] = [];
    const rl = createInterface({ input });
    const map = new Map<string, IPty>();
    startIpcLoop({
      readline: rl,
      write: (m) => responses.push(m),
      handleDeps: { sessionsMap: map },
    });

    input.push(JSON.stringify({ id: 's1', data: 'x' }) + '\n');
    await flushReadline();

    expect(responses[0]).toMatchObject({ type: 'error' });
    expect((responses[0] as { message: string }).message).toMatch(/type/);
  });

  it('skips empty lines silently', async () => {
    const input = new Readable({ read() {} });
    const responses: ServerMessage[] = [];
    const rl = createInterface({ input });
    const map = new Map<string, IPty>();
    startIpcLoop({
      readline: rl,
      write: (m) => responses.push(m),
      handleDeps: { sessionsMap: map },
    });

    input.push('\n');
    input.push('   \n');
    input.push(JSON.stringify({ type: 'list' }) + '\n');
    await flushReadline();

    expect(responses).toEqual([{ type: 'list', sessions: [] }]);
  });
});
