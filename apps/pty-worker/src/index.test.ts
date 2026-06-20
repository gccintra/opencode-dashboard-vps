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
 * Spawn is direct and synchronous now (no hedging / settle window): the
 * SIGHUP race is solved at the source by pty-sighup-exec, so a `spawn`
 * message creates exactly one PTY and emits `spawned` immediately.
 *
 * We also test the IPC loop (`startIpcLoop`) with an in-memory
 * readline.Interface fed by a Readable stream, so the full
 * stdin → JSON parse → handler → stdout path is covered.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

// Mock node-pty BEFORE importing the index. The mock factory returns the
// minimum surface used by the source: just `spawn`. We capture the function
// reference so individual tests can configure its return value.
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

import * as pty from 'node-pty';
import {
  handleMessage,
  startIpcLoop,
  resetGlobalState,
  type HandleDeps,
  type PtySpawnFn,
} from './index';
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
  destroyed = false;

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  // node-pty's onData/onExit are direct method aliases on IPty, not the
  // EventEmitter pattern. Provide them to match the interface.
  onData(cb: (data: string) => void): void {
    this.on('data', cb);
  }
  onExit(cb: (e: { exitCode: number | null; signal?: number | null }) => void): void {
    this.on('exit', cb);
  }
}

// ── Test context builder ───────────────────────────────────────────

interface Ctx {
  deps: HandleDeps;
  map: Map<string, IPty>;
  /** All FakePty instances created by ptySpawn, in call order. */
  fakes: FakePty[];
  responses: ServerMessage[];
  ptySpawn: Mock;
}

function makeContext(opts: { map?: Map<string, IPty> } = {}): Ctx {
  const map = opts.map ?? new Map<string, IPty>();
  const fakes: FakePty[] = [];
  const responses: ServerMessage[] = [];
  const ptySpawn = pty.spawn as unknown as Mock;
  ptySpawn.mockReset();
  ptySpawn.mockImplementation(() => {
    const f = new FakePty();
    fakes.push(f);
    return f as unknown as IPty;
  });
  const write = (m: ServerMessage) => responses.push(m);
  const deps: HandleDeps = {
    ptySpawn: ptySpawn as unknown as PtySpawnFn,
    sessionsMap: map,
    write,
  };
  return { deps, map, fakes, responses, ptySpawn };
}

beforeEach(() => {
  resetGlobalState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── spawn ──────────────────────────────────────────────────────────

describe('handleMessage — spawn', () => {
  it('creates a PTY and emits a `spawned` response with the pid', () => {
    const { deps, responses, map, fakes } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/srv/p1', command: 'bash' }, deps);

    expect(pty.spawn).toHaveBeenCalledTimes(1);
    expect(responses).toContainEqual({ type: 'spawned', id: 's1', pid: 12345 });
    expect(map.get('s1')).toBe(fakes[0]);
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
    const { deps, fakes, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    fakes[0].emit('data', 'hello world');
    const encoded = Buffer.from('hello world', 'utf8').toString('base64');
    expect(responses).toContainEqual({
      type: 'data',
      id: 's1',
      chunk: encoded,
      encoding: 'base64',
    });
  });

  it('forwards PTY exit events as `exit` responses and removes the session', () => {
    const { deps, fakes, responses, map } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    fakes[0].emit('exit', { exitCode: 0, signal: null });
    expect(responses).toContainEqual({ type: 'exit', id: 's1', code: 0 });
    expect(map.has('s1')).toBe(false);
  });

  it('maps a signal death to code 128+signal on exit', () => {
    const { deps, fakes, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    fakes[0].emit('exit', { exitCode: null, signal: 9 });
    expect(responses).toContainEqual({ type: 'exit', id: 's1', code: 137 });
  });

  it('emits an `error` response if pty.spawn throws', () => {
    const throwingSpawn = vi.fn(() => {
      throw new Error('boom');
    });
    const responses: ServerMessage[] = [];
    const deps: HandleDeps = {
      ptySpawn: throwingSpawn as unknown as PtySpawnFn,
      sessionsMap: new Map(),
      write: (m) => responses.push(m),
    };
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({ type: 'error', id: 's1', message: 'spawn failed: boom' });
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
    const { deps, fakes } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    handleMessage({ type: 'write', id: 's1', data: 'ls\r' }, deps);
    expect(fakes[0].writes).toEqual(['ls\r']);
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
    const { deps, fakes } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    handleMessage({ type: 'resize', id: 's1', cols: 120, rows: 40 }, deps);
    expect(fakes[0].resized).toContainEqual({ cols: 120, rows: 40 });
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
    const { deps, fakes, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    fakes[0].resize = () => {
      throw new Error('EINVAL');
    };
    handleMessage({ type: 'resize', id: 's1', cols: 0, rows: 0 }, deps);
    expect(responses.at(-1)).toEqual({
      type: 'error',
      id: 's1',
      message: 'resize failed: EINVAL',
    });
  });

  it('emits a synthetic exit when resize fails with EBADF (dead fd)', () => {
    const { deps, fakes, responses, map } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    fakes[0].resize = () => {
      throw new Error('resize EBADF');
    };
    handleMessage({ type: 'resize', id: 's1', cols: 120, rows: 40 }, deps);
    expect(responses).toContainEqual({ type: 'exit', id: 's1', code: -1 });
    expect(map.has('s1')).toBe(false);
  });
});

// ── kill ───────────────────────────────────────────────────────────

describe('handleMessage — kill', () => {
  it('kills the PTY, removes the session, and emits `killed`', () => {
    const { deps, map, fakes, responses } = makeContext();
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);

    responses.length = 0;
    handleMessage({ type: 'kill', id: 's1' }, deps);

    expect(fakes[0].killed).toBe(true);
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
    const { deps, fakes } = makeContext();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'spawn', id: 's2', cwd: '/tmp', command: 'bash' }, deps);

    handleMessage({ type: 'shutdown' }, deps);
    expect(fakes[0].killed).toBe(true);
    expect(fakes[1].killed).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});

// ── IPC loop end-to-end ────────────────────────────────────────────

/**
 * Readline processes pushed data asynchronously via setImmediate internally.
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

    input.push(JSON.stringify({ type: 'list' } satisfies ClientMessage) + '\n');
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
