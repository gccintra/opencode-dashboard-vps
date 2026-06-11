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
 * Timing: all tests use `vi.useFakeTimers()` (mocking setTimeout/setInterval
 * but NOT setImmediate) so the hedge settle period is under test control.
 * Use `hedgeCount: 1, hedgeSettleMs: 0` in `makeContext` to get deterministic
 * single-PTY spawning; advance fake time with `vi.advanceTimersByTimeAsync(1)`
 * to trigger the settle callback.
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
import { handleMessage, startIpcLoop, resetGlobalState, type HandleDeps, type PtySpawnFn } from './index';
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

/**
 * Build a test context. Pass `hedgeCount: 1, hedgeSettleMs: 0` to get
 * deterministic single-PTY spawning (advance time by 1ms to trigger settle).
 * Leave defaults to test production hedging behaviour (hedgeCount=3, settleMs=1000).
 */
function makeContext(opts: {
  map?: Map<string, IPty>;
  hedgeCount?: number;
  hedgeSettleMs?: number;
} = {}): Ctx {
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
    hedgeCount: opts.hedgeCount,
    hedgeSettleMs: opts.hedgeSettleMs,
  };
  return { deps, map, fakes, responses, ptySpawn };
}

// ── Global timer / state setup ─────────────────────────────────────
//
// Fake only setTimeout/setInterval (not setImmediate) so:
//   - hedge settle period is under test control via vi.advanceTimersByTimeAsync()
//   - readline 'line' events (which rely on setImmediate internally) work as-is
//
// resetGlobalState() ensures gLastKillTime, circuit-breaker, and failure
// counter are at a clean baseline before every test.

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  });
  resetGlobalState();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helper ─────────────────────────────────────────────────────────

/** Advance fake timers by `ms` and flush all resulting microtasks/promises. */
async function tick(ms = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// ── spawn ──────────────────────────────────────────────────────────

describe('handleMessage — spawn', () => {
  it('creates a PTY and emits a `spawned` response with the pid', async () => {
    const { deps, responses, map, fakes } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/srv/p1', command: 'bash' }, deps);
    await tick();

    expect(pty.spawn).toHaveBeenCalledTimes(1);
    expect(responses).toContainEqual({ type: 'spawned', id: 's1', pid: 12345 });
    expect(map.get('s1')).toBe(fakes[0]);
  });

  it('forwards cwd, command, args, cols, rows to pty.spawn', () => {
    const { deps, ptySpawn } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
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
    const { deps, ptySpawn } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(ptySpawn).toHaveBeenCalledWith(
      'bash',
      [],
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
  });

  it('forwards PTY data events as base64-encoded `data` responses', async () => {
    const { deps, fakes, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle → winner registered, onData wired

    fakes[0].emit('data', 'hello world');
    const encoded = Buffer.from('hello world', 'utf8').toString('base64');
    expect(responses).toContainEqual({ type: 'data', id: 's1', chunk: encoded, encoding: 'base64' });
  });

  it('forwards PTY exit events as `exit` responses and removes the session', async () => {
    const { deps, fakes, responses, map } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle → winner registered, onExit wired

    fakes[0].emit('exit', { exitCode: 0, signal: null });
    expect(responses).toContainEqual({ type: 'exit', id: 's1', code: 0 });
    expect(map.has('s1')).toBe(false);
  });

  it('emits an `error` response if pty.spawn throws', () => {
    const throwingSpawn = vi.fn(() => {
      throw new Error('spawn failed');
    });
    const responses: ServerMessage[] = [];
    const deps: HandleDeps = {
      ptySpawn: throwingSpawn as unknown as PtySpawnFn,
      sessionsMap: new Map(),
      write: (m) => responses.push(m),
      hedgeCount: 1,
      hedgeSettleMs: 0,
    };
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({ type: 'error', id: 's1', message: 'All hedge spawns failed' });
  });

  it('rejects duplicate session ids with an error', async () => {
    const { deps, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    // At this point s1__h0 is in the map (hedge window, not yet promoted).
    responses.length = 0;
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({
      type: 'error',
      id: 's1',
      message: 'session already exists: s1',
    });
  });

  it('rejects duplicate session ids after winner promotion', async () => {
    const { deps, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // s1 promoted to real slot
    responses.length = 0;
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(responses[0]).toEqual({
      type: 'error',
      id: 's1',
      message: 'session already exists: s1',
    });
  });

  it('hedging: spawns HEDGE_COUNT PTYs and promotes first survivor', async () => {
    const { deps, fakes, responses, map } = makeContext({ hedgeCount: 3, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    expect(pty.spawn).toHaveBeenCalledTimes(3);
    expect(map.size).toBe(3); // three hedges in map

    await tick(); // settle → fakes[0] wins
    expect(map.get('s1')).toBe(fakes[0]);
    expect(map.size).toBe(1); // losers removed
    expect(responses).toContainEqual({ type: 'spawned', id: 's1', pid: 12345 });
  });

  it('hedging: losing hedges are killed but NOT destroyed (avoids cascading SIGHUP)', async () => {
    const { deps, fakes } = makeContext({ hedgeCount: 3, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle

    // fakes[1] and fakes[2] are the losers.
    expect(fakes[1].killed).toBe(true);
    expect(fakes[2].killed).toBe(true);
    // destroy() must NOT be called on losers — it closes the master fd and
    // queues a kernel SIGHUP that cascades to the next spawned session.
    expect(fakes[1].destroyed).toBe(false);
    expect(fakes[2].destroyed).toBe(false);
  });
});

// ── write ──────────────────────────────────────────────────────────

describe('handleMessage — write', () => {
  it('writes data to the PTY (preserving \\r for line breaks)', async () => {
    const { deps, fakes } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle → s1 promoted

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
  it('forwards the new dimensions to the PTY', async () => {
    const { deps, fakes } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle

    handleMessage({ type: 'resize', id: 's1', cols: 120, rows: 40 }, deps);
    // winner verification at settle time performs an initial resize (defaults 80×24),
    // so the resized array may have that entry first.
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

  it('emits an error when pty.resize throws', async () => {
    const { deps, fakes, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle

    // Override resize AFTER spawn so the spawn itself succeeds.
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
});

// ── kill ───────────────────────────────────────────────────────────

describe('handleMessage — kill', () => {
  it('kills the PTY, removes the session, and emits `killed`', async () => {
    const { deps, map, fakes, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // settle → s1 promoted

    responses.length = 0;
    handleMessage({ type: 'kill', id: 's1' }, deps);

    // destroy() is intentionally NOT called (avoids async SIGHUP-to-reused-PID race).
    expect(fakes[0].killed).toBe(true);
    expect(fakes[0].destroyed).toBe(false);
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
  it('returns the active session ids in insertion order', async () => {
    const { deps, responses } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'spawn', id: 's2', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // both sessions settle and get promoted

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
  it('kills all sessions and exits the process', async () => {
    const { deps, fakes } = makeContext({ hedgeCount: 1, hedgeSettleMs: 0 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    handleMessage({ type: 'spawn', id: 's1', cwd: '/tmp', command: 'bash' }, deps);
    handleMessage({ type: 'spawn', id: 's2', cwd: '/tmp', command: 'bash' }, deps);
    await tick(); // both promoted

    handleMessage({ type: 'shutdown' }, deps);
    // Shutdown sends SIGKILL to pgroups but does NOT call destroy() — destroying
    // master fds at shutdown queues tty_hangup(SIGHUP) events that can cascade
    // to sessions in the next server restart. The kernel closes all fds when
    // this Node process exits anyway.
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});

// ── IPC loop end-to-end ────────────────────────────────────────────

/**
 * Readline processes pushed data asynchronously via setImmediate internally.
 * Since we only fake setTimeout/setInterval (not setImmediate), we can flush
 * readline with a real setImmediate-based Promise.
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
