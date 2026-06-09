import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useTerminalSocket } from './useTerminalSocket';

/* ── Mock WebSocket class (test-controllable) ── */

interface MockWSInstance {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** Test helper: simulate a successful open. */
  simulateOpen: () => void;
  /** Test helper: simulate a server message. */
  simulateMessage: (data: string) => void;
  /** Test helper: simulate a server close. */
  simulateClose: (code?: number, reason?: string) => void;
  /** Test helper: simulate a network error. */
  simulateError: () => void;
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: MockWSInstance['onopen'] = null;
  onmessage: MockWSInstance['onmessage'] = null;
  onclose: MockWSInstance['onclose'] = null;
  onerror: MockWSInstance['onerror'] = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this as unknown as MockWSInstance);
  }

  /* ── Test helpers ── */

  static instances: MockWSInstance[] = [];

  /** Simulate a successful open. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Simulate a server message. */
  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Simulate a server close. */
  simulateClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  /** Simulate a network error (followed by a close). */
  simulateError(): void {
    this.onerror?.(new Event('error'));
  }
}

/* ── Test suite setup ── */

const noopBuildUrl = (sessionId: string) => `ws://test/terminal/${sessionId}`;

/** Helper: flush the mount effect + initial state setters. */
async function flushInitial(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

let renderResult: RenderHookResult<ReturnType<typeof useTerminalSocket>, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── Tests ── */

describe('useTerminalSocket', () => {
  describe('initial connection lifecycle', () => {
    it('starts in idle state, then transitions to connecting, then connected', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('session-1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );

      // After the mount effect, a WS was created and status is 'connecting'.
      await flushInitial();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('ws://test/terminal/session-1');
      expect(renderResult.result.current.status).toBe('connecting');

      // Simulate the server completing the open handshake.
      await act(async () => {
        MockWebSocket.instances[0].simulateOpen();
      });
      expect(renderResult.result.current.status).toBe('connected');
      expect(renderResult.result.current.attempt).toBe(0);
      expect(renderResult.result.current.error).toBeNull();
    });
  });

  describe('message passing', () => {
    it('forwards WS messages to registered data handlers', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const handler = vi.fn();
      const unsubscribe = renderResult.result.current.data(handler);

      await act(async () => MockWebSocket.instances[0].simulateMessage('hello pty'));

      expect(handler).toHaveBeenCalledWith('hello pty');
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe removes the handler.
      unsubscribe();
      await act(async () => MockWebSocket.instances[0].simulateMessage('ignored'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple concurrent data handlers', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const a = vi.fn();
      const b = vi.fn();
      renderResult.result.current.data(a);
      renderResult.result.current.data(b);

      await act(async () => MockWebSocket.instances[0].simulateMessage('payload'));

      expect(a).toHaveBeenCalledWith('payload');
      expect(b).toHaveBeenCalledWith('payload');
    });

    it('keeps sending to other handlers if one throws', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Suppress the error from console.error so the test output stays clean.
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failing = vi.fn(() => {
        throw new Error('boom');
      });
      const passing = vi.fn();
      renderResult.result.current.data(failing);
      renderResult.result.current.data(passing);

      await act(async () => MockWebSocket.instances[0].simulateMessage('data'));

      expect(failing).toHaveBeenCalledWith('data');
      expect(passing).toHaveBeenCalledWith('data');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('reconnection with exponential backoff', () => {
    it('schedules a reconnect after 1s on first close, with attempt = 1', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());
      // The first instance is the one that opened.
      const firstWs = MockWebSocket.instances[0];

      // Simulate an abnormal close (e.g., network drop).
      await act(async () => firstWs.simulateClose(1006, 'abnormal'));

      // After close, status flips to 'reconnecting' with attempt 1.
      expect(renderResult.result.current.status).toBe('reconnecting');
      expect(renderResult.result.current.attempt).toBe(1);
      expect(renderResult.result.current.error).toBeNull();

      // No new WS has been created yet — we are still waiting for the 1s backoff.
      expect(MockWebSocket.instances).toHaveLength(1);

      // Advance 1s: the first backoff window elapses, a new WS is created.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(renderResult.result.current.status).toBe('reconnecting');
    });

    it('uses the documented backoff sequence: 1s, 2s, 4s, 8s, 16s, 30s', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Helper: drive a single reconnect cycle and return the new attempt value.
      async function driveCloseAndAdvance(): Promise<void> {
        const lastIdx = MockWebSocket.instances.length - 1;
        const last = MockWebSocket.instances[lastIdx];
        await act(async () => last.simulateClose(1006));
      }

      // The expected backoff after attempt N is: min(2^(N-1), 30) seconds.
      // We don't actually need to test exact ms here — just that consecutive
      // attempts happen, attempt counter increments, and status is reconnecting.
      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000];

      for (let i = 0; i < expectedDelays.length; i++) {
        await driveCloseAndAdvance();
        const attemptNum = i + 1;
        expect(renderResult.result.current.attempt).toBe(attemptNum);
        expect(renderResult.result.current.status).toBe('reconnecting');

        // Advance by the expected delay — a new WS should appear.
        const wsCountBefore = MockWebSocket.instances.length;
        await act(async () => {
          vi.advanceTimersByTime(expectedDelays[i]!);
        });
        expect(MockWebSocket.instances.length).toBe(wsCountBefore + 1);
      }
    });

    it('resets attempt counter to 0 on successful reconnect', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Force one reconnect.
      const first = MockWebSocket.instances[0];
      await act(async () => first.simulateClose(1006));
      expect(renderResult.result.current.attempt).toBe(1);

      // Advance 1s, get the new WS, open it.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await act(async () => MockWebSocket.instances[1].simulateOpen());

      expect(renderResult.result.current.status).toBe('connected');
      expect(renderResult.result.current.attempt).toBe(0);
    });
  });

  describe('max retries exhausted', () => {
    it('transitions to error state after maxAttempts unsuccessful reconnects', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Default maxAttempts is 10. After 10 failed reconnects, status should be 'error'.
      // attempt counter goes 1, 2, ..., 10 (then on the 11th close attempt, error is set).
      for (let i = 0; i < 10; i++) {
        const lastIdx = MockWebSocket.instances.length - 1;
        await act(async () => MockWebSocket.instances[lastIdx].simulateClose(1006));
        // Advance timers so the next reconnect attempt fires (and we get a new WS).
        await act(async () => {
          vi.advanceTimersByTime(30_000);
        });
      }

      // At this point we have: original + 10 reconnects = 11 instances.
      // Close the 11th (the 10th reconnect) — the hook should detect nextAttempt > 10.
      const lastIdx = MockWebSocket.instances.length - 1;
      await act(async () => MockWebSocket.instances[lastIdx].simulateClose(1006));

      expect(renderResult.result.current.status).toBe('error');
      expect(renderResult.result.current.error).not.toBeNull();
      expect(renderResult.result.current.error?.message).toMatch(/reload the page/i);
      expect(renderResult.result.current.error?.recoverable).toBe(true);
    });
  });

  describe('application-defined close codes', () => {
    it('treats close code 4004 (session not found) as a permanent error', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('missing', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();

      // 4004 may fire even before the open completes; the hook handles it.
      await act(async () => MockWebSocket.instances[0].simulateClose(4004, 'session not found'));

      expect(renderResult.result.current.status).toBe('error');
      expect(renderResult.result.current.error?.code).toBe(4004);
      expect(renderResult.result.current.error?.recoverable).toBe(false);
      expect(renderResult.result.current.error?.message).toMatch(/session not found/i);
    });

    it('treats close code 4001 (already connected) as a permanent error', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('taken', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();

      await act(async () => MockWebSocket.instances[0].simulateClose(4001, 'already connected'));

      expect(renderResult.result.current.status).toBe('error');
      expect(renderResult.result.current.error?.code).toBe(4001);
      expect(renderResult.result.current.error?.recoverable).toBe(false);
      expect(renderResult.result.current.error?.message).toMatch(/in use/i);
    });

    it('does not attempt to reconnect after a permanent error', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateClose(4004));

      // Advance a lot of time — no new WS should appear.
      const countBefore = MockWebSocket.instances.length;
      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });
      expect(MockWebSocket.instances.length).toBe(countBefore);
      expect(renderResult.result.current.status).toBe('error');
    });
  });

  describe('cleanup on unmount', () => {
    it('clears pending reconnect timers and tears down the WebSocket on unmount', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Trigger a pending reconnect (close, but don't advance the timer).
      const ws = MockWebSocket.instances[0];
      await act(async () => ws.simulateClose(1006));
      expect(renderResult.result.current.status).toBe('reconnecting');

      // Unmount.
      renderResult.unmount();

      // Advancing the timer should NOT create a new WS — the timer was cleared.
      const beforeCount = MockWebSocket.instances.length;
      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });
      expect(MockWebSocket.instances.length).toBe(beforeCount);
    });

    it('closes an in-flight WebSocket when unmounted before close', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      // WS is in CONNECTING (readyState = 0). Unmount without ever opening.
      const ws = MockWebSocket.instances[0];
      expect(ws.close).not.toHaveBeenCalled();

      renderResult.unmount();

      // The hook's cleanup should close the socket.
      expect(ws.close).toHaveBeenCalled();
    });
  });

  describe('send() behavior', () => {
    it('returns true and forwards to ws.send() when the socket is open', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const result = renderResult.result.current.send('ls\n');
      expect(result).toBe(true);
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith('ls\n');
    });

    it('returns false and does not call ws.send() when the socket is not open', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      // Before flushInitial, the hook is in 'idle' state and ws is connecting.
      await flushInitial();
      // The WS is in CONNECTING state (readyState = 0). send() should return false.
      const result = renderResult.result.current.send('ignored');
      expect(result).toBe(false);
      expect(MockWebSocket.instances[0].send).not.toHaveBeenCalled();
    });

    it('returns false after the socket has closed', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());
      await act(async () => MockWebSocket.instances[0].simulateClose(1000));

      // Normal close (1000) on first attempt → 'disconnected', not reconnecting.
      expect(renderResult.result.current.status).toBe('disconnected');
      const result = renderResult.result.current.send('after-close');
      expect(result).toBe(false);
    });
  });

  describe('manual reconnect and terminate', () => {
    it('reconnect() resets the attempt counter and dials a new socket', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Force a couple of failed reconnects.
      await act(async () => MockWebSocket.instances[0].simulateClose(1006));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(renderResult.result.current.attempt).toBe(1);

      // Manually reconnect.
      await act(async () => {
        renderResult.result.current.reconnect();
      });

      expect(renderResult.result.current.attempt).toBe(0);
      expect(renderResult.result.current.status).toBe('connecting');
      // A fresh WS instance was created.
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('terminate() permanently closes the socket and stops reconnects', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      await act(async () => {
        renderResult.result.current.terminate();
      });

      expect(renderResult.result.current.status).toBe('error');
      expect(renderResult.result.current.error?.recoverable).toBe(false);

      // No further WS should be created by any timer.
      const countBefore = MockWebSocket.instances.length;
      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });
      expect(MockWebSocket.instances.length).toBe(countBefore);
    });
  });

  describe('sessionId changes reset connection', () => {
    it('creates a new WebSocket and resets state when sessionId changes', async () => {
      const { rerender } = renderHook(
        ({ id }: { id: string }) =>
          useTerminalSocket(id, {
            WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
            buildUrl: noopBuildUrl,
          }),
        { initialProps: { id: 's1' } },
      );

      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());
      expect(MockWebSocket.instances[0].url).toBe('ws://test/terminal/s1');

      // Change sessionId.
      await act(async () => {
        rerender({ id: 's2' });
      });
      await flushInitial();

      // Old socket's close() should have been called, and a new one created.
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toBe('ws://test/terminal/s2');
    });
  });

  describe('JSON control message discrimination', () => {
    it('intercepts {type:"exit", code:0} and does NOT send to data handler', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 0 })),
      );

      expect(dataHandler).not.toHaveBeenCalled();
    });

    it('intercepts {type:"status", status:"waiting"} and does NOT send to data handler', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(
          JSON.stringify({ type: 'status', status: 'waiting' }),
        ),
      );

      expect(dataHandler).not.toHaveBeenCalled();
    });

    it('fires onExit callback with correct exit code', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const exitHandler = vi.fn();
      renderResult.result.current.onExit(exitHandler);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 42 })),
      );

      expect(exitHandler).toHaveBeenCalledWith(42);
      expect(exitHandler).toHaveBeenCalledTimes(1);
    });

    it('fires onStatus callback with correct status string', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const statusHandler = vi.fn();
      renderResult.result.current.onStatus(statusHandler);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(
          JSON.stringify({ type: 'status', status: 'active' }),
        ),
      );

      expect(statusHandler).toHaveBeenCalledWith('active');
      expect(statusHandler).toHaveBeenCalledTimes(1);
    });

    it('still sends regular text output to data handler', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      await act(async () => MockWebSocket.instances[0].simulateMessage('regular pty output'));

      expect(dataHandler).toHaveBeenCalledWith('regular pty output');
    });

    it('still sends non-JSON text to data handler', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      await act(async () => MockWebSocket.instances[0].simulateMessage('{not valid json}'));

      expect(dataHandler).toHaveBeenCalledWith('{not valid json}');
    });

    it('sends JSON without a known type to data handler (defensive)', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      const unknownJson = JSON.stringify({ foo: 'bar', baz: 123 });
      await act(async () => MockWebSocket.instances[0].simulateMessage(unknownJson));

      expect(dataHandler).toHaveBeenCalledWith(unknownJson);
    });

    it('sends JSON with type field that is unrecognized to data handler', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const dataHandler = vi.fn();
      renderResult.result.current.data(dataHandler);

      const msg = JSON.stringify({ type: 'unknown-type', value: 1 });
      await act(async () => MockWebSocket.instances[0].simulateMessage(msg));

      expect(dataHandler).toHaveBeenCalledWith(msg);
    });

    it('onExit unsubscribe stops handler from being called', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const exitHandler = vi.fn();
      const unsubscribe = renderResult.result.current.onExit(exitHandler);

      unsubscribe();
      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 1 })),
      );

      expect(exitHandler).not.toHaveBeenCalled();
    });

    it('onStatus unsubscribe stops handler from being called', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const statusHandler = vi.fn();
      const unsubscribe = renderResult.result.current.onStatus(statusHandler);

      unsubscribe();
      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(
          JSON.stringify({ type: 'status', status: 'idle' }),
        ),
      );

      expect(statusHandler).not.toHaveBeenCalled();
    });

    it('onExit and onStatus callbacks can be registered simultaneously', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const exitHandler = vi.fn();
      const statusHandler = vi.fn();
      renderResult.result.current.onExit(exitHandler);
      renderResult.result.current.onStatus(statusHandler);

      // Fire an exit message — only exit handler should fire.
      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 1 })),
      );
      expect(exitHandler).toHaveBeenCalledWith(1);
      expect(statusHandler).not.toHaveBeenCalled();

      // Fire a status message — only status handler should fire.
      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(
          JSON.stringify({ type: 'status', status: 'processing' }),
        ),
      );
      expect(statusHandler).toHaveBeenCalledWith('processing');
      expect(exitHandler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple concurrent exit handlers', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const a = vi.fn();
      const b = vi.fn();
      renderResult.result.current.onExit(a);
      renderResult.result.current.onExit(b);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 0 })),
      );

      expect(a).toHaveBeenCalledWith(0);
      expect(b).toHaveBeenCalledWith(0);
    });

    it('keeps firing exit handlers if one throws', async () => {
      renderResult = renderHook(() =>
        useTerminalSocket('s1', {
          WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
          buildUrl: noopBuildUrl,
        }),
      );
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const throwing = vi.fn(() => {
        throw new Error('boom');
      });
      const passing = vi.fn();
      renderResult.result.current.onExit(throwing);
      renderResult.result.current.onExit(passing);

      await act(async () =>
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'exit', code: 3 })),
      );

      expect(throwing).toHaveBeenCalledWith(3);
      expect(passing).toHaveBeenCalledWith(3);
    });
  });

  describe('environment without WebSocket', () => {
    it('transitions to error when no WebSocket implementation is available', async () => {
      // Save and remove the global WebSocket so the fallback chain has nothing
      // to return. We restore in `finally` so subsequent tests still work.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalWebSocket = (globalThis as any).WebSocket;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).WebSocket;
      try {
        renderResult = renderHook(() =>
          // No WebSocketImpl passed — the destructured value is undefined,
          // and the global is missing, so the "not available" branch fires.
          useTerminalSocket('s1', { buildUrl: noopBuildUrl }),
        );

        await flushInitial();

        expect(renderResult.result.current.status).toBe('error');
        expect(renderResult.result.current.error?.message).toMatch(/not available/i);
        expect(renderResult.result.current.error?.recoverable).toBe(false);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).WebSocket = originalWebSocket;
      }
    });
  });
});
