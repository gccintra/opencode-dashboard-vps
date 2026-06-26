import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { XTermTerminal, type XTermTerminalHandle } from './XTermTerminal';
import { Terminal } from '@xterm/xterm';

/* ── Mocks ── */

// Spy-friendly mock instance accessible from tests.
/** Last constructor options passed to `new Terminal(...)`. */
let lastTerminalOptions: Record<string, unknown> | undefined;

const mockTerminal = {
  options: { fontSize: 14 },
  open: vi.fn(),
  write: vi.fn(),
  onData: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  /** xterm 6 unicode API — set by unicode11 addon */
  unicode: { activeVersion: '' },
  cols: 80,
  rows: 24,
  // Additional xterm methods used by XTermTerminal
  parser: { registerOscHandler: vi.fn(), registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })) },
  attachCustomKeyEventHandler: vi.fn(),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  onRender: vi.fn(() => ({ dispose: vi.fn() })),
  refresh: vi.fn(),
  focus: vi.fn(),
  reset: vi.fn(),
  selectAll: vi.fn(),
  getSelection: vi.fn(() => ''),
  buffer: { active: { viewportY: 0, getLine: vi.fn(() => null) } },
};
const mockFit = { fit: vi.fn(), proposeDimensions: vi.fn(), activate: vi.fn(), dispose: vi.fn() };

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation((options?: Record<string, unknown>) => {
    if (options) lastTerminalOptions = options;
    if (options?.fontSize !== undefined) {
      mockTerminal.options.fontSize = options.fontSize as number;
    }
    return mockTerminal;
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => mockFit),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn(),
  })),
}));

/* ── WebSocket mock (instance-accessible) ── */

interface MockWSInstance {
  url: string;
  readyState: number;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** Test helper: simulate a successful open. */
  simulateOpen: () => void;
  /** Test helper: simulate a server close with a specific code. */
  simulateClose: (code?: number, reason?: string) => void;
}

const wsInstances: MockWSInstance[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  readyState = 0;
  onopen: MockWSInstance['onopen'] = null;
  onmessage: MockWSInstance['onmessage'] = null;
  onclose: MockWSInstance['onclose'] = null;
  onerror: MockWSInstance['onerror'] = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    // Do NOT auto-open — tests must explicitly call simulateOpen() to drive
    // the open handshake. This is critical for reconnection tests: if a
    // stale setTimeout-based open fires after we've already closed and
    // reconnected, it would incorrectly reset the attempt counter.
    wsInstances.push(this as unknown as MockWSInstance);
  }

  /** Test helper: fire onopen manually. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).onopen?.(new Event('open'));
  }

  /** Test helper: fire onclose manually with a specific code. */
  simulateClose(code = 1006, reason = ''): void {
    this.readyState = 3;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).onclose?.(new CloseEvent('close', { code, reason }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = MockWebSocket;

/* ── ResizeObserver mock (callback-capturable) ── */

const resizeCallbacks: ResizeObserverCallback[] = [];
const mockObserver = {
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
};

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallbacks.push(cb);
  }
  observe = mockObserver.observe;
  unobserve = mockObserver.unobserve;
  disconnect = mockObserver.disconnect;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

/* ── IntersectionObserver mock (jsdom lacks it) ── */
class MockIntersectionObserver {
  constructor(_cb: IntersectionObserverCallback) {}
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

// jsdom reports clientWidth=0 for every element, which makes the terminal's
// fit/flush path (gated on `container.clientWidth > 0`) a no-op. Report a
// non-zero width so resize/flush logic actually runs under test.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 800,
});

/* ── onData mock factory (returns a disposable) ── */

// We configure `onData` per-test to return a disposable with a tracked dispose().
let onDataDisposableDisposed = false;
function resetOnDataMock(): void {
  onDataDisposableDisposed = false;
  mockTerminal.onData.mockImplementation(() => ({
    dispose: () => {
      onDataDisposableDisposed = true;
    },
  }));
}

/* ── Setup / teardown ── */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  lastTerminalOptions = undefined;
  wsInstances.length = 0;
  resizeCallbacks.length = 0;
  mockTerminal.cols = 80;
  mockTerminal.rows = 24;
  mockTerminal.unicode.activeVersion = '';
  // Ensure onSelectionChange always returns a fresh disposable after clearAllMocks
  mockTerminal.onSelectionChange.mockImplementation(() => ({ dispose: vi.fn() }));
  resetOnDataMock();
});

afterEach(() => {
  cleanup();
});

/* ── Helpers ── */

async function flushOpen(): Promise<void> {
  // Drain the microtask queue so the mount effect runs, then explicitly open
  // the most recent WS instance. We don't rely on auto-open (it could race
  // with reconnect timers in fake-timer mode).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    const last = wsInstances[wsInstances.length - 1];
    if (last && last.readyState === 0) {
      last.simulateOpen();
    }
  });
  // The buffer flush is gated on the poll measuring a STABLE container size
  // (two equal reads, ~200ms). Advance past that so terminalReady is set.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

/* ── Tests ── */

describe('XTermTerminal', () => {
  /* ── Original behavior preserved ── */

  it('renders a div container for the terminal', () => {
    render(<XTermTerminal sessionId="abc-123" />);
    expect(screen.getByTestId('xterm-container')).toBeInTheDocument();
    expect(screen.getByTestId('xterm-container').tagName).toBe('DIV');
  });

  it('creates a WebSocket with the correct URL (uses window.location.host with session path)', () => {
    render(<XTermTerminal sessionId="session-xyz" />);
    expect(wsInstances).toHaveLength(1);
    // WS URL now uses window.location.host in both dev and prod
    // (Vite/nginx proxy handles forwarding to backend).
    const expected = `ws://${window.location.host}/terminal/session-xyz`;
    expect(wsInstances[0].url).toBe(expected);
  });

  it('calls Terminal constructor, loadAddon, and open on mount', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockTerminal.loadAddon).toHaveBeenCalledTimes(4); // Fit + WebLinks + Unicode11 + WebGL
    expect(mockTerminal.open).toHaveBeenCalledTimes(1);
    expect(mockTerminal.open.mock.calls[0][0]).toBe(screen.getByTestId('xterm-container'));
  });

  it('calls terminal.dispose(), unsubscribes onData, and closes the WS on unmount', async () => {
    const { unmount } = render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0];

    unmount();

    expect(mockTerminal.dispose).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalled();
    expect(mockObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(onDataDisposableDisposed).toBe(true);
  });

  it('keeps the status badge hidden while connecting and once connected', async () => {
    render(<XTermTerminal sessionId="s1" />);

    // The badge is gated on `terminalReady`, which only flips after the
    // terminal has opened — so nothing shows during the initial connect.
    expect(screen.queryByTestId('xterm-status-badge')).not.toBeInTheDocument();

    await flushOpen();
    await act(async () => {
      // Fire the terminal-ready safety net (1500ms) so the badge would render
      // if the status warranted it.
      await vi.advanceTimersByTimeAsync(1500);
    });

    // Connected → no badge.
    expect(screen.queryByTestId('xterm-status-badge')).not.toBeInTheDocument();
  });

  it('forwards WebSocket message data to terminal.write()', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wsInstances[0] as any).onmessage?.(new MessageEvent('message', { data: 'hello-pty' }));
    });

    expect(mockTerminal.write).toHaveBeenCalledWith('hello-pty');
  });

  it('forwards terminal.onData payloads to ws.send()', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();

    expect(mockTerminal.onData).toHaveBeenCalledTimes(1);
    const onDataCallback = mockTerminal.onData.mock.calls[0][0] as (data: string) => void;
    onDataCallback('ls\n');

    expect(wsInstances[0].send).toHaveBeenCalledWith('ls\n');
  });

  it('does NOT send data to WebSocket when the connection is not OPEN', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const onDataCallback = mockTerminal.onData.mock.calls[0][0] as (data: string) => void;

    // WS is in CONNECTING (readyState = 0) by default.
    onDataCallback('ignored');

    expect(wsInstances[0].send).not.toHaveBeenCalled();
  });

  it('accepts a className prop and applies it to the wrapper element', () => {
    const { container } = render(<XTermTerminal sessionId="s1" className="custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('custom-class');
  });

  it('calls ResizeObserver.fit() and onResize callback when the container resizes', async () => {
    const onResize = vi.fn();
    render(<XTermTerminal sessionId="s1" onResize={onResize} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(resizeCallbacks).toHaveLength(1);
    expect(mockObserver.observe).toHaveBeenCalledWith(screen.getByTestId('xterm-container'));

    mockTerminal.cols = 120;
    mockTerminal.rows = 40;
    act(() => {
      resizeCallbacks[0]([] as ResizeObserverEntry[], mockObserver as unknown as ResizeObserver);
    });
    // Flush the 300ms ResizeObserver debounce (CLAUDE.md: fit ≥300ms after layout).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockFit.fit).toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledWith(120, 40);
  });

  it('observes the container with a ResizeObserver on mount', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockObserver.observe).toHaveBeenCalledWith(screen.getByTestId('xterm-container'));
  });

  it('disconnects the ResizeObserver on unmount', async () => {
    const { unmount } = render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    expect(mockObserver.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uses the latest onResize callback without re-mounting the terminal', async () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(<XTermTerminal sessionId="s1" onResize={first} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The initial doFit() fires onResize during mount — clear before testing the rerender.
    first.mockClear();
    rerender(<XTermTerminal sessionId="s1" onResize={second} />);

    expect(mockTerminal.open).toHaveBeenCalledTimes(1);

    mockTerminal.cols = 100;
    mockTerminal.rows = 30;
    act(() => {
      resizeCallbacks[0]([] as ResizeObserverEntry[], mockObserver as unknown as ResizeObserver);
    });
    // Flush the 300ms ResizeObserver debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(second).toHaveBeenCalledWith(100, 30);
    expect(first).not.toHaveBeenCalled();
  });

  /* ── Canvas garble fix: 300ms ResizeObserver debounce + resync() wiggle ── */

  // Pull the {type:'resize'} SIGWINCH messages out of the WS send mock.
  function resizeMessages(ws: MockWSInstance): Array<{ type: string; cols: number; rows: number }> {
    return ws.send.mock.calls
      .map((c) => c[0])
      .filter((d): d is string => typeof d === 'string')
      .map((d) => {
        try {
          return JSON.parse(d);
        } catch {
          return null;
        }
      })
      .filter((m): m is { type: string; cols: number; rows: number } => !!m && m.type === 'resize');
  }

  const fireResize = () =>
    resizeCallbacks[0]([] as ResizeObserverEntry[], mockObserver as unknown as ResizeObserver);

  it('debounces the ResizeObserver by 300ms (honors the CLAUDE.md fit≥300ms rule)', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();
    const ws = wsInstances[0];

    // A genuine new size is sent ONLY after the 300ms debounce settles. flushOpen
    // already sent 80x24, so 100x30 is a real change notifyResizeIfChanged emits.
    mockTerminal.cols = 100;
    mockTerminal.rows = 30;
    ws.send.mockClear();
    act(() => {
      fireResize();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(resizeMessages(ws).some((m) => m.cols === 100 && m.rows === 30)).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // total 350ms > 300ms debounce
    });
    expect(resizeMessages(ws).some((m) => m.cols === 100 && m.rows === 30)).toBe(true);
  });

  it('resize() forces a SIGWINCH (rows-1 → rows) even when cols/rows are unchanged (busts dedup)', async () => {
    const ref = createRef<XTermTerminalHandle>();
    render(<XTermTerminal ref={ref} sessionId="s1" />);
    await flushOpen();
    const ws = wsInstances[0];

    mockTerminal.cols = 120;
    mockTerminal.rows = 40;
    // First resync establishes lastSentDims = 120x40.
    act(() => {
      ref.current?.resize();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    ws.send.mockClear();
    // Second resync at the SAME size: notifyResizeIfChanged dedups (no send),
    // but forceWiggle must still emit a fresh dedup-busting SIGWINCH pair.
    act(() => {
      ref.current?.resize();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const msgs = resizeMessages(ws);
    expect(msgs).toContainEqual({ type: 'resize', cols: 120, rows: 39 });
    expect(msgs).toContainEqual({ type: 'resize', cols: 120, rows: 40 });
  });

  it('collapses rapid ResizeObserver events into a single resize send (no per-event wiggle)', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();
    const ws = wsInstances[0];

    mockTerminal.cols = 100;
    mockTerminal.rows = 30;
    ws.send.mockClear();
    // 3 rapid resize events inside the debounce window collapse into ONE settle.
    act(() => {
      fireResize();
      fireResize();
      fireResize();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // Exactly one send of the new size — and NO wiggle (rows-1) frame, since the
    // ResizeObserver path no longer fires forceWiggle.
    const sends = resizeMessages(ws).filter((m) => m.cols === 100 && m.rows === 30);
    expect(sends).toHaveLength(1);
    expect(resizeMessages(ws).some((m) => m.rows === 29)).toBe(false);
  });

  it('uses fontSize=14 by default when no prop is passed', () => {
    render(<XTermTerminal sessionId="s1" />);
    expect(mockTerminal.options.fontSize).toBe(14);
  });

  it('applies the fontSize prop at terminal creation', async () => {
    render(<XTermTerminal sessionId="s1" fontSize={12} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockTerminal.options.fontSize).toBe(12);
  });

  it('updates terminal.options.fontSize and calls fit when fontSize prop changes', async () => {
    mockFit.fit.mockClear();
    const { rerender } = render(<XTermTerminal sessionId="s1" fontSize={14} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Change fontSize
    rerender(<XTermTerminal sessionId="s1" fontSize={12} />);

    expect(mockTerminal.options.fontSize).toBe(12);
    expect(mockFit.fit).toHaveBeenCalled();
  });

  it('fires onResize callback after fontSize change', async () => {
    mockFit.fit.mockClear();
    const onResize = vi.fn();
    mockTerminal.cols = 100;
    mockTerminal.rows = 30;
    const { rerender } = render(<XTermTerminal sessionId="s1" fontSize={14} onResize={onResize} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    onResize.mockClear();

    rerender(<XTermTerminal sessionId="s1" fontSize={12} onResize={onResize} />);

    expect(onResize).toHaveBeenCalledWith(100, 30);
  });

  it('does NOT call fit when fontSize stays the same', () => {
    mockFit.fit.mockClear();
    const { rerender } = render(<XTermTerminal sessionId="s1" fontSize={14} />);
    mockFit.fit.mockClear();

    rerender(<XTermTerminal sessionId="s1" fontSize={14} />);

    expect(mockFit.fit).not.toHaveBeenCalled();
  });

  /* ── New behavior: status states ── */

  it('shows a "Reconnecting…" badge with attempt counter on abnormal close', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();
    // Reveal the terminal (terminalReady) so the badge can render once a
    // non-connected status appears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    // Badge is hidden while connected.
    expect(screen.queryByTestId('xterm-status-badge')).not.toBeInTheDocument();

    // Simulate an abnormal close (code 1006).
    await act(async () => {
      wsInstances[0].simulateClose(1006);
    });

    const badge = screen.getByTestId('xterm-status-badge');
    expect(badge).toHaveAttribute('data-status', 'reconnecting');
    expect(badge).toHaveTextContent(/Reconnecting.*\(1\/10\)/);
  });

  it('shows a "Disconnected" badge on a clean normal close (code 1000)', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('xterm-status-badge')).not.toBeInTheDocument();

    await act(async () => {
      wsInstances[0].simulateClose(1000);
    });

    const badge = screen.getByTestId('xterm-status-badge');
    expect(badge).toHaveAttribute('data-status', 'disconnected');
    expect(badge).toHaveTextContent(/disconnected/i);
  });

  it('reuses the existing terminal across reconnection attempts (does not re-create Terminal)', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();

    const initialOpenCalls = mockTerminal.open.mock.calls.length;
    const initialWriteCalls = mockTerminal.write.mock.calls.length;

    // Force a close and let the reconnect timer fire.
    await act(async () => {
      wsInstances[0].simulateClose(1006);
    });
    expect(wsInstances).toHaveLength(1);
    // 1s backoff elapses, a new WS is created.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);

    // The terminal is NOT re-created — the same mockTerminal instance is reused.
    expect(mockTerminal.open.mock.calls.length).toBe(initialOpenCalls);
    // No new writes from the reconnect itself (the backend replay would arrive
    // as WS messages, not via the test directly).
    expect(mockTerminal.write.mock.calls.length).toBe(initialWriteCalls);
  });

  /* ── New behavior: error overlay ── */

  it('shows the error overlay with "Create new session" CTA on close code 4004', async () => {
    const onCreateNewSession = vi.fn();
    render(<XTermTerminal sessionId="missing" onCreateNewSession={onCreateNewSession} />);

    // The MockWebSocket fires onopen in setTimeout(0), but close 4004 may
    // happen before that. Either way, the hook handles it.
    await act(async () => {
      // Force the WS to open first so the badge hides — then close 4004.
      if (wsInstances[0].readyState === 0) {
        await vi.advanceTimersByTimeAsync(10);
      }
      wsInstances[0].simulateClose(4004, 'session not found');
    });

    const overlay = screen.getByTestId('xterm-error-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute('data-error-code', '4004');
    expect(overlay).toHaveTextContent(/session not found/i);

    // The "Create new session" CTA is rendered because onCreateNewSession is provided.
    const cta = screen.getByTestId('xterm-error-create-new-session');
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);
    expect(onCreateNewSession).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the "Create new session" CTA when no handler is provided (4004)', async () => {
    render(<XTermTerminal sessionId="missing" />);

    await act(async () => {
      if (wsInstances[0].readyState === 0) {
        await vi.advanceTimersByTimeAsync(10);
      }
      wsInstances[0].simulateClose(4004, 'session not found');
    });

    expect(screen.getByTestId('xterm-error-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm-error-create-new-session')).not.toBeInTheDocument();
  });

  it('shows the error overlay with "Session in use elsewhere" on close code 4001', async () => {
    render(<XTermTerminal sessionId="taken" />);

    await act(async () => {
      wsInstances[0].simulateClose(4001, 'already connected');
    });

    const overlay = screen.getByTestId('xterm-error-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute('data-error-code', '4001');
    expect(overlay).toHaveTextContent(/in use elsewhere/i);
    // 4001 has no CTA — the user must figure out which tab is holding the session.
    expect(screen.queryByTestId('xterm-error-reload')).not.toBeInTheDocument();
    expect(screen.queryByTestId('xterm-error-create-new-session')).not.toBeInTheDocument();
  });

  it('shows the "Connection lost" error overlay with reload button after max retries', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();

    // Drive 10 failed reconnects, then trigger the 11th close (which crosses
    // the maxAttempts boundary inside the hook).
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        const last = wsInstances[wsInstances.length - 1];
        last.simulateClose(1006);
        // Advance enough for the 30s backoff to elapse.
        await vi.advanceTimersByTimeAsync(30_100);
      });
    }
    // One more close to push us over maxAttempts.
    await act(async () => {
      const last = wsInstances[wsInstances.length - 1];
      last.simulateClose(1006);
    });

    const overlay = screen.getByTestId('xterm-error-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent(/connection lost/i);
    expect(overlay).toHaveTextContent(/reload the page/i);

    const reloadBtn = screen.getByTestId('xterm-error-reload');
    expect(reloadBtn).toBeInTheDocument();
  });

  /* ── Backwards-compat: error on onerror alone ── */
  // The new hook's onerror is a no-op — the close handler does the real work.
  // Verifying this here so future changes don't accidentally regress.

  it('does NOT transition to error state on onerror alone (close is required)', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await flushOpen();

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wsInstances[0] as any).onerror?.(new Event('error'));
    });

    // The badge is still hidden (status is 'connected' — the error was a no-op).
    expect(screen.queryByTestId('xterm-status-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('xterm-error-overlay')).not.toBeInTheDocument();
  });

  /* ── Opentui / xterm fix: constructor options ── */

  it('passes lineHeight=1.2 to the Terminal constructor', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastTerminalOptions).toHaveProperty('lineHeight', 1.2);
  });

  it('passes scrollback=5000 to the Terminal constructor', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastTerminalOptions).toHaveProperty('scrollback', 5000);
  });

  it('passes convertEol=false to the Terminal constructor', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastTerminalOptions).toHaveProperty('convertEol', false);
  });

  it('passes cursorStyle=block to the Terminal constructor', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastTerminalOptions).toHaveProperty('cursorStyle', 'block');
  });

  it('passes theme.background #1e1e2e and cursorAccent #1e1e2e to the Terminal constructor', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastTerminalOptions?.theme).toMatchObject({
      background: '#1e1e2e',
      cursorAccent: '#1e1e2e',
    });
  });

  /* ── Opentui / xterm fix: Unicode11Addon ── */

  it('loads the Unicode11Addon and sets activeVersion to 11', async () => {
    render(<XTermTerminal sessionId="s1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockTerminal.unicode.activeVersion).toBe('11');
  });

  /* ── Bug 4: Mouse tracking reset on session end ── */

  describe('Bug 4: mouse tracking reset', () => {
    const MOUSE_RESET = '\x1b[?1000l\x1b[?1002l\x1b[?1003l';

    it('writes mouse reset sequences when PTY status transitions to "finished"', async () => {
      render(<XTermTerminal sessionId="s1" />);
      await flushOpen();
      mockTerminal.write.mockClear();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wsInstances[0] as any).onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'status', status: 'finished' }),
          }),
        );
      });

      expect(mockTerminal.write).toHaveBeenCalledWith(MOUSE_RESET);
    });

    it('writes mouse reset sequences when PTY status transitions to "exited"', async () => {
      render(<XTermTerminal sessionId="s1" />);
      await flushOpen();
      mockTerminal.write.mockClear();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wsInstances[0] as any).onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'status', status: 'exited' }),
          }),
        );
      });

      expect(mockTerminal.write).toHaveBeenCalledWith(MOUSE_RESET);
    });

    it('writes mouse reset sequences on PTY exit event', async () => {
      render(<XTermTerminal sessionId="s1" />);
      await flushOpen();
      mockTerminal.write.mockClear();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wsInstances[0] as any).onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'exit', code: 0 }),
          }),
        );
      });

      expect(mockTerminal.write).toHaveBeenCalledWith(MOUSE_RESET);
    });

    it('does NOT write mouse reset for non-terminal status values', async () => {
      render(<XTermTerminal sessionId="s1" />);
      await flushOpen();
      mockTerminal.write.mockClear();

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wsInstances[0] as any).onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'status', status: 'active' }),
          }),
        );
      });

      expect(mockTerminal.write).not.toHaveBeenCalledWith(MOUSE_RESET);
    });
  });

  /* ── WebGL atlas isolation (Canvas garble regression guard) ── */
  describe('WebGL atlas isolation', () => {
    it('gives each terminal a UNIQUE fontFamily so xterm never shares one TextureAtlas', async () => {
      // Canvas garble root cause: xterm's WebGL addon shares ONE TextureAtlas
      // across terminals whose render config is `configEquals` (fontFamily is
      // compared exactly, un-normalized). One slot's clearTextureAtlas() then
      // blanks every sibling's glyphs. Fix = a unique trailing fontFamily
      // fallback per terminal. If a future "cleanup" deletes that suffix
      // thinking it's junk, the garble silently returns — this test fails in CI
      // instead. JetBrains Mono still resolves first, so metrics are identical.
      render(<XTermTerminal sessionId="iso-a" />);
      await flushOpen();
      render(<XTermTerminal sessionId="iso-b" />);
      await flushOpen();

      const families = vi
        .mocked(Terminal)
        .mock.calls.map((c) => (c[0] as { fontFamily?: string } | undefined)?.fontFamily)
        .filter((f): f is string => typeof f === 'string');

      expect(families.length).toBeGreaterThanOrEqual(2);
      // Identical real font (same metrics)…
      families.forEach((f) => expect(f.startsWith("'JetBrains Mono'")).toBe(true));
      // …but the atlas-iso fallback is present and UNIQUE per terminal.
      const isoSuffixes = families.map((f) => f.match(/alf-atlas-iso-\d+/)?.[0]);
      isoSuffixes.forEach((s) => expect(s).toBeTruthy());
      expect(new Set(isoSuffixes).size).toBe(isoSuffixes.length);
    });
  });
});
