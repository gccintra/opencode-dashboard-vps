import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useSessionEvents, type SessionEvent } from './useSessionEvents';

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
  simulateOpen: () => void;
  simulateMessage: (data: string) => void;
  simulateClose: (code?: number, reason?: string) => void;
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

  static instances: MockWSInstance[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this as unknown as MockWSInstance);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  simulateClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

/* ── Setup ── */

const buildUrl = () => 'ws://test/ws/events';

async function flushInitial(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

let renderResult: RenderHookResult<ReturnType<typeof useSessionEvents>, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function mount(extra: Record<string, unknown> = {}) {
  renderResult = renderHook(() =>
    useSessionEvents({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      buildUrl,
      ...extra,
    }),
  );
  return renderResult;
}

/* ── Tests ── */

describe('useSessionEvents', () => {
  describe('connection lifecycle', () => {
    it('connects on mount and transitions to connected on open', async () => {
      mount();
      await flushInitial();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('ws://test/ws/events');
      expect(renderResult.result.current.status).toBe('connecting');

      await act(async () => {
        MockWebSocket.instances[0].simulateOpen();
      });
      expect(renderResult.result.current.status).toBe('connected');
      expect(renderResult.result.current.attempt).toBe(0);
    });

    it('does not connect when enabled is false', async () => {
      mount({ enabled: false });
      await flushInitial();
      expect(MockWebSocket.instances).toHaveLength(0);
      expect(renderResult.result.current.status).toBe('idle');
    });

    it('closes the socket on unmount without flipping to disconnected', async () => {
      mount();
      await flushInitial();
      const ws = MockWebSocket.instances[0];
      await act(async () => ws.simulateOpen());

      await act(async () => {
        renderResult.unmount();
      });
      expect(ws.close).toHaveBeenCalled();
      // cleanedUpRef short-circuits onclose; status stays 'connected'.
      expect(renderResult.result.current.status).toBe('connected');
    });
  });

  describe('reconnection', () => {
    it('reconnects with backoff after an abnormal close', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      // Abnormal close (1006) → schedule reconnect.
      await act(async () => MockWebSocket.instances[0].simulateClose(1006));
      expect(renderResult.result.current.status).toBe('reconnecting');
      expect(renderResult.result.current.attempt).toBe(1);

      // Advance past the first backoff window (1000ms).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('does NOT reconnect after a normal close (1000) on first attempt', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      await act(async () => MockWebSocket.instances[0].simulateClose(1000));
      expect(renderResult.result.current.status).toBe('disconnected');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('transitions to error on permanent close codes (4001, 4004)', async () => {
      for (const code of [4001, 4004]) {
        MockWebSocket.instances.length = 0;
        mount();
        await flushInitial();
        await act(async () => MockWebSocket.instances[0].simulateOpen());
        await act(async () => MockWebSocket.instances[0].simulateClose(code));
        expect(renderResult.result.current.status).toBe('error');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(MockWebSocket.instances).toHaveLength(1);
        renderResult.unmount();
      }
    });

    it('transitions to error when max attempts are exhausted', async () => {
      mount({ maxAttempts: 2, backoffSequence: [10, 10, 10] });
      await flushInitial();

      // attempt 1
      await act(async () => MockWebSocket.instances[0].simulateClose(1006));
      await act(async () => vi.advanceTimersByTimeAsync(10));
      // attempt 2
      await act(async () => MockWebSocket.instances[1].simulateClose(1006));
      await act(async () => vi.advanceTimersByTimeAsync(10));
      // attempt 3 → exceeds max (2) → error
      await act(async () => MockWebSocket.instances[2].simulateClose(1006));
      expect(renderResult.result.current.status).toBe('error');
    });
  });

  describe('onSessionEvent', () => {
    it('dispatches a sessions-changed frame to registered handlers', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const handler = vi.fn();
      act(() => {
        renderResult.result.current.onSessionEvent(handler);
      });

      const event: SessionEvent = {
        type: 'sessions-changed',
        action: 'created',
        sessionId: 's1',
        projectId: 'p1',
        name: 'Sessão 1',
      };
      await act(async () => {
        MockWebSocket.instances[0].simulateMessage(JSON.stringify(event));
      });
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does NOT dispatch the connected heartbeat as a session event', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const handler = vi.fn();
      act(() => {
        renderResult.result.current.onSessionEvent(handler);
      });
      await act(async () => {
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'connected' }));
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores non-JSON and unrelated frames', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const handler = vi.fn();
      act(() => {
        renderResult.result.current.onSessionEvent(handler);
      });
      await act(async () => {
        MockWebSocket.instances[0].simulateMessage('not json');
        MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: 'status', status: 'x' }));
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe stops further dispatches', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());

      const handler = vi.fn();
      let unsubscribe = () => {};
      act(() => {
        unsubscribe = renderResult.result.current.onSessionEvent(handler);
      });
      act(() => unsubscribe());

      await act(async () => {
        MockWebSocket.instances[0].simulateMessage(
          JSON.stringify({ type: 'sessions-changed', action: 'closed', sessionId: 's1' }),
        );
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('manual controls', () => {
    it('terminate() closes the socket and stops reconnecting', async () => {
      mount();
      await flushInitial();
      const ws = MockWebSocket.instances[0];
      await act(async () => ws.simulateOpen());

      act(() => {
        renderResult.result.current.terminate();
      });
      expect(ws.close).toHaveBeenCalled();
      expect(renderResult.result.current.status).toBe('error');

      // A subsequent close must not schedule a reconnect.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('reconnect() resets the attempt counter and dials a fresh socket', async () => {
      mount();
      await flushInitial();
      await act(async () => MockWebSocket.instances[0].simulateOpen());
      await act(async () => MockWebSocket.instances[0].simulateClose(1006));
      expect(renderResult.result.current.attempt).toBe(1);

      act(() => {
        renderResult.result.current.reconnect();
      });
      expect(renderResult.result.current.attempt).toBe(0);
      // A new socket was opened immediately (no backoff wait).
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });
  });
});
