/**
 * WebSocket handler tests.
 *
 * The Elysia `app.ws()` lifecycle (open/message/close) doesn't expose
 * a clean unit-test surface through `app.handle()` — those hooks fire
 * on real WS upgrades, not on HTTP requests. So this suite takes two
 * complementary approaches:
 *
 *  1. **Direct handler tests** — call the exported `handleOpen`,
 *     `handleMessage`, and `handleClose` functions with a mock
 *     `WSLike` object. The PTY manager is mocked via `vi.mock()` so
 *     the Bun-only `BunWorkerTransport` is never instantiated.
 *
 *  2. **Route registration** — verify that the `wsRoutes` plugin
 *     actually registers a `/terminal/:sessionId` WS route on the
 *     Elysia app. This catches accidental route name/path typos.
 *
 * Coverage:
 *  - open: multiple clients per session (no more 4001 rejection),
 *    unknown session rejected (4004), buffer replay, data relay,
 *    exit relay, callback registration.
 *  - message: string pass-through, ArrayBuffer decode, unknown session.
 *  - close: callback cleanup via removeSessionData/Exit/Status,
 *    connection tracking cleared, other clients unaffected.
 *  - helpers: `hasConnection`, `resetConnectedClients`, `sessionExists`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  removeSessionData: vi.fn(),
  removeSessionExit: vi.fn(),
  removeSessionStatus: vi.fn(),
  getSessionBuffer: vi.fn(() => ''),
  getSessionStatus: vi.fn(() => 'active'),
  getDetectedStatus: vi.fn(() => 'finished'),
  listSessions: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('../pty/manager', () => ({
  getPtyManager: () => mockManager,
  PtyManager: class {},
  resetPtyManager: vi.fn(),
}));

// ── suite ───────────────────────────────────────────────────────────

describe('WebSocket handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  // Tracks all callbacks the manager has been told about, indexed
  // by sessionId. Lets us simulate data/exit events.
  const dataCallbacks = new Map<string, Array<(chunk: string) => void>>();
  const exitCallbacks = new Map<string, Array<(code: number) => void>>();

  /**
   * Create a minimal mock WS object. Tests can inspect `.sent` and
   * `.closed` after invoking the handler.
   */
  function makeMockWs(sessionId: string, readyState = 1 /* OPEN */) {
    return {
      data: { params: { sessionId } },
      readyState,
      sent: [] as Array<string | ArrayBufferLike | ArrayBufferView>,
      closed: null as { code?: number; reason?: string } | null,
      send(data: string | ArrayBufferLike | ArrayBufferView) {
        this.sent.push(data);
        return 1;
      },
      close(code?: number, reason?: string) {
        this.closed = { code, reason };
        this.readyState = 3; // CLOSED
      },
      // Helper to get sent data decoded as latin1/binary strings for assertions.
      // Buffer.isBuffer must be checked first: Buffer's .buffer property points
      // to a pooled ArrayBuffer, so constructing Uint8Array from it would read
      // thousands of bytes instead of just this Buffer's slice.
      getSentStrings() {
        return this.sent.map((s): string => {
          if (typeof s === 'string') return s;
          if (Buffer.isBuffer(s)) return (s as Buffer).toString('binary');
          if (s instanceof ArrayBuffer) return Buffer.from(s).toString('binary');
          const v = s as ArrayBufferView;
          return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('binary');
        });
      },
    };
  }

  beforeEach(async () => {
    for (const fn of Object.values(mockManager)) {
      fn.mockReset();
    }
    // Defaults: writeToSession succeeds (so sessionExists returns
    // true), buffer is empty, no callbacks are pre-registered,
    // session status is 'active' (not finished).
    mockManager.writeToSession.mockImplementation(() => {});
    mockManager.getSessionBuffer.mockReturnValue('');
    mockManager.getSessionStatus.mockReturnValue('active');
    // 'finished' so handleOpen skips the connect-time status send by default;
    // tests that care about the status message override this.
    mockManager.getDetectedStatus.mockReturnValue('finished');
    mockManager.onSessionData.mockImplementation((id: string, cb: (chunk: string) => void) => {
      if (!dataCallbacks.has(id)) dataCallbacks.set(id, []);
      dataCallbacks.get(id)!.push(cb);
    });
    mockManager.onSessionExit.mockImplementation((id: string, cb: (code: number) => void) => {
      if (!exitCallbacks.has(id)) exitCallbacks.set(id, []);
      exitCallbacks.get(id)!.push(cb);
    });

    dataCallbacks.clear();
    exitCallbacks.clear();

    const { resetConnectedClients } = await import('./handler');
    resetConnectedClients();

    const { wsRoutes } = await import('./handler');
    app = new Elysia().use(wsRoutes);
  });

  afterEach(() => {
    dataCallbacks.clear();
    exitCallbacks.clear();
  });

  // ── Route registration ──────────────────────────────────────────

  describe('route registration', () => {
    it('wsRoutes is a usable Elysia plugin', () => {
      // The Node test adapter does not support WebSockets (Elysia logs
      // a warning and skips registration), so we can't introspect the
      // compiled routes here. What we CAN assert is that the plugin
      // is a valid Elysia instance, mounts cleanly, and exposes the
      // handler functions. The actual lifecycle behaviour is covered
      // by the handler tests below.
      expect(app).toBeDefined();
      expect(typeof app.handle).toBe('function');
    });
  });

  // ── Helpers ─────────────────────────────────────────────────────

  describe('helpers', () => {
    it('hasConnection() returns false when no client is connected', async () => {
      const { hasConnection } = await import('./handler');
      expect(hasConnection('nonexistent')).toBe(false);
    });

    it('hasConnection() returns true after a connection is registered', async () => {
      const { handleOpen, hasConnection } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);
      expect(hasConnection('s-1')).toBe(true);
    });

    it('resetConnectedClients() drops all tracked connections', async () => {
      const { handleOpen, hasConnection, resetConnectedClients } = await import('./handler');
      handleOpen(makeMockWs('s-1'));
      handleOpen(makeMockWs('s-2'));
      expect(hasConnection('s-1')).toBe(true);
      expect(hasConnection('s-2')).toBe(true);

      resetConnectedClients();
      expect(hasConnection('s-1')).toBe(false);
      expect(hasConnection('s-2')).toBe(false);
    });

    it('sessionExists() returns true when the manager accepts a write', async () => {
      const { sessionExists } = await import('./handler');
      expect(sessionExists('live')).toBe(true);
    });

    it('sessionExists() returns false when the session is unknown to the manager', async () => {
      mockManager.getSessionStatus.mockReturnValue(null);
      const { sessionExists } = await import('./handler');
      expect(sessionExists('ghost')).toBe(false);
    });
  });

  // ── handleOpen ─────────────────────────────────────────────────

  describe('handleOpen', () => {
    it('registers the connection and replays the buffer', async () => {
      mockManager.getSessionBuffer.mockReturnValue('hello\nworld\n');
      const { handleOpen, hasConnection } = await import('./handler');

      const ws = makeMockWs('s-1');
      handleOpen(ws);

      expect(hasConnection('s-1')).toBe(true);
      expect(ws.getSentStrings()).toEqual(['hello\nworld\n']);
    });

    it('does not send anything when the buffer is empty', async () => {
      mockManager.getSessionBuffer.mockReturnValue('');
      const { handleOpen } = await import('./handler');

      const ws = makeMockWs('s-1');
      handleOpen(ws);

      expect(ws.sent).toEqual([]);
    });

    it('registers onSessionData and onSessionExit callbacks', async () => {
      const { handleOpen } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      expect(mockManager.onSessionData).toHaveBeenCalledWith('s-1', expect.any(Function));
      expect(mockManager.onSessionExit).toHaveBeenCalledWith('s-1', expect.any(Function));
    });

    it('allows a second client to connect to the same session (multi-tab)', async () => {
      const { handleOpen, hasConnection } = await import('./handler');

      const first = makeMockWs('s-1');
      handleOpen(first);
      expect(first.closed).toBeNull();
      expect(hasConnection('s-1')).toBe(true);

      const second = makeMockWs('s-1');
      handleOpen(second);
      // Second connection is accepted — no 4001 close.
      expect(second.closed).toBeNull();
      expect(hasConnection('s-1')).toBe(true);
      // Both WS instances should be registered.
      expect(mockManager.onSessionData).toHaveBeenCalledTimes(2);
      expect(mockManager.onSessionExit).toHaveBeenCalledTimes(2);
    });

    it('closes with 4004 when the session does not exist', async () => {
      mockManager.getSessionStatus.mockReturnValue(null);
      const { handleOpen, hasConnection } = await import('./handler');

      const ws = makeMockWs('ghost');
      handleOpen(ws);

      expect(ws.closed).toEqual({
        code: 4004,
        reason: 'Session not found',
      });
      expect(hasConnection('ghost')).toBe(false);
    });

    it('forwards PTY data to the WS client when the manager fires it', async () => {
      const { handleOpen } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      // Simulate PTY data arriving from the worker.
      const dataCb = dataCallbacks.get('s-1')?.[0];
      dataCb?.('terminal output');

      expect(ws.getSentStrings()).toContain('terminal output');
    });

    it('skips sending when the socket is already CLOSED (race protection)', async () => {
      const { handleOpen } = await import('./handler');
      const ws = makeMockWs('s-1', 3 /* CLOSED */);
      handleOpen(ws);

      const dataCb = dataCallbacks.get('s-1')?.[0];
      dataCb?.('should be dropped');

      // Nothing was sent (other than the initial buffer replay,
      // which was also skipped because readyState=3 prevents the
      // replay path — but the handler is the same).
      // Verify there is no 'should be dropped' message.
      expect(ws.sent.some((s) => s === 'should be dropped')).toBe(false);
    });

    it('forwards PTY exit to the client and closes the socket', async () => {
      const { handleOpen } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      const exitCb = exitCallbacks.get('s-1')?.[0];
      exitCb?.(0);

      expect(ws.sent).toContain(JSON.stringify({ type: 'exit', code: 0 }));
      expect(ws.closed).not.toBeNull();
    });
  });

  // ── handleMessage ──────────────────────────────────────────────

  describe('handleMessage', () => {
    it('forwards string messages to writeToSession', async () => {
      const { handleOpen, handleMessage } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      handleMessage(ws, 'ls\n');

      expect(mockManager.writeToSession).toHaveBeenCalledWith('s-1', 'ls\n');
    });

    it('decodes ArrayBuffer messages as UTF-8', async () => {
      const { handleOpen, handleMessage } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      const bytes = new TextEncoder().encode('café');
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      handleMessage(ws, buf);

      expect(mockManager.writeToSession).toHaveBeenCalledWith('s-1', 'café');
    });

    it('decodes typed-array messages as UTF-8', async () => {
      const { handleOpen, handleMessage } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      handleMessage(ws, new TextEncoder().encode('typed'));

      expect(mockManager.writeToSession).toHaveBeenCalledWith('s-1', 'typed');
    });

    it('coerces unknown types via String()', async () => {
      const { handleOpen, handleMessage } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      handleMessage(ws, 42);

      expect(mockManager.writeToSession).toHaveBeenCalledWith('s-1', '42');
    });

    it('closes the socket with 1011 when the session is gone', async () => {
      const { handleOpen, handleMessage } = await import('./handler');
      const ws = makeMockWs('s-1');
      // open succeeds (status 'active'); the session is then killed, so the
      // write during message throws.
      handleOpen(ws);

      mockManager.writeToSession.mockImplementationOnce(() => {
        throw new Error('session not found');
      });
      handleMessage(ws, 'ping');

      expect(ws.closed).toEqual({ code: 1011, reason: 'Session unavailable' });
    });
  });

  // ── handleClose ────────────────────────────────────────────────

  describe('handleClose', () => {
    it('removes the connection from the tracking map and cleans up manager callbacks', async () => {
      const { handleOpen, handleClose, hasConnection } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);
      expect(hasConnection('s-1')).toBe(true);

      handleClose(ws);
      expect(hasConnection('s-1')).toBe(false);
      // Verify callback cleanup was invoked.
      expect(mockManager.removeSessionData).toHaveBeenCalledWith('s-1', expect.any(Function));
      expect(mockManager.removeSessionExit).toHaveBeenCalledWith('s-1', expect.any(Function));
      expect(mockManager.removeSessionStatus).toHaveBeenCalledWith('s-1', expect.any(Function));
    });

    it('does NOT kill the PTY (no killSession call) and removes callbacks', async () => {
      const { handleOpen, handleClose } = await import('./handler');
      const ws = makeMockWs('s-1');
      handleOpen(ws);

      handleClose(ws);

      expect(mockManager.killSession).not.toHaveBeenCalled();
      expect(mockManager.removeSessionData).toHaveBeenCalled();
    });

    it('is a no-op when called for a session not currently tracked', async () => {
      const { handleClose } = await import('./handler');
      const ws = makeMockWs('unknown');
      // Should not throw.
      expect(() => handleClose(ws)).not.toThrow();
    });

    it('does not affect other connections to different sessions', async () => {
      const { handleOpen, handleClose, hasConnection } = await import('./handler');
      const a = makeMockWs('s-a');
      const b = makeMockWs('s-b');
      handleOpen(a);
      handleOpen(b);

      handleClose(a);

      expect(hasConnection('s-a')).toBe(false);
      expect(hasConnection('s-b')).toBe(true);
      // Callbacks for s-a were removed.
      expect(mockManager.removeSessionData).toHaveBeenCalledWith('s-a', expect.any(Function));
      // But onSessionData was called twice (once per session).
      expect(mockManager.onSessionData).toHaveBeenCalledTimes(2);
    });

    it('closing one client keeps the other alive for the same session', async () => {
      const { handleOpen, handleClose, hasConnection } = await import('./handler');

      const client1 = makeMockWs('s-1');
      const client2 = makeMockWs('s-1');
      handleOpen(client1);
      handleOpen(client2);
      expect(hasConnection('s-1')).toBe(true);

      handleClose(client1);
      // Session still has a connection (client2).
      expect(hasConnection('s-1')).toBe(true);
      // Only client1's callbacks were removed.
      expect(mockManager.removeSessionData).toHaveBeenCalledTimes(1);
      expect(mockManager.removeSessionData).toHaveBeenCalledWith('s-1', expect.any(Function));

      handleClose(client2);
      // Both clients gone now.
      expect(hasConnection('s-1')).toBe(false);
      expect(mockManager.removeSessionData).toHaveBeenCalledTimes(2);
    });

    it('broadcasts PTY data to all connected clients', async () => {
      const { handleOpen } = await import('./handler');

      const client1 = makeMockWs('s-1');
      const client2 = makeMockWs('s-1');
      handleOpen(client1);
      handleOpen(client2);

      // Both clients should have data callbacks registered.
      const dataCbs1 = dataCallbacks.get('s-1') ?? [];
      expect(dataCbs1.length).toBeGreaterThanOrEqual(2);

      // Simulate PTY data.
      for (const cb of dataCbs1) {
        cb('shared output');
      }

      expect(client1.getSentStrings()).toContain('shared output');
      expect(client2.getSentStrings()).toContain('shared output');
    });
  });
});
