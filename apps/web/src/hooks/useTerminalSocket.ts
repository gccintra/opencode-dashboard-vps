import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Connection status state machine for the terminal WebSocket.
 *
 * - `idle` — initial state, before the first connection attempt.
 * - `connecting` — first connection attempt is in flight.
 * - `connected` — WebSocket is open and healthy.
 * - `reconnecting` — a previous connection was lost; waiting for the next backoff window.
 * - `disconnected` — the socket was closed normally (code 1000) without an active session.
 * - `error` — a non-recoverable error occurred (max retries, session not found, etc.).
 */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/** Stable, human-readable description of a terminal error. */
export interface ConnectionError {
  /** WebSocket close code, if the error originated from a close event. */
  code?: number;
  /** WebSocket close reason, if the error originated from a close event. */
  reason?: string;
  /** Human-readable error message suitable for display. */
  message: string;
  /**
   * Whether the error is recoverable by the user.
   * - `false` — the user must take action (e.g., create a new session, reload the page).
   * - `true` — the hook will keep trying, or the user can manually retry.
   */
  recoverable: boolean;
}

/** Callback signature for incoming WebSocket message handlers. */
export type DataHandler = (data: string | Uint8Array) => void;

/** Options for {@link useTerminalSocket}. All fields are optional and used in tests. */
export interface UseTerminalSocketOptions {
  /**
   * Custom WebSocket constructor. Defaults to the global `WebSocket`.
   * Tests inject a mock class here. The constructor must accept a single
   * `url` string argument and return a `WebSocket`-shaped instance.
   */
  WebSocketImpl?: typeof WebSocket;
  /**
   * Custom URL builder. Defaults to `ws(s)://host/terminal/{sessionId}` (uses
   * `localhost:3001` in dev, current host in production).
   * Tests inject a deterministic URL builder here.
   */
  buildUrl?: (sessionId: string) => string;
  /**
   * Optional last-known terminal dimensions, appended to the connect URL as
   * `?cols=&rows=`. The server uses these to fire the armed TUI launch the
   * moment the socket opens — before the client has finished loading fonts and
   * measuring — overlapping server-side boot with client-side init. This shaves
   * 1-2 WAN round-trips off first paint. Stale-but-close values are corrected by
   * the authoritative resize the client sends after its real fit(). Evaluated
   * on every (re)connect so reconnects use the most recent measured size.
   */
  connectDims?: () => { cols: number; rows: number } | null;
  /**
   * Backoff sequence in milliseconds. The first attempt uses index 0.
   * Defaults to `[1000, 2000, 4000, 8000, 16000, 30000]`.
   */
  backoffSequence?: number[];
  /** Maximum reconnect attempts before transitioning to `error`. Defaults to 10. */
  maxAttempts?: number;
}

/** Return shape of {@link useTerminalSocket}. */
export interface UseTerminalSocketReturn {
  /** Current connection status (see {@link ConnectionStatus}). */
  status: ConnectionStatus;
  /** Last error captured, or `null` if the connection is healthy. */
  error: ConnectionError | null;
  /** Number of reconnect attempts since the last successful connection. 0 when connected. */
  attempt: number;
  /** Maximum reconnect attempts allowed (from options). */
  maxAttempts: number;
  /**
   * Register a message handler. The handler is invoked once per received
   * WebSocket message. Returns an unsubscribe function.
   */
  data: (handler: DataHandler) => () => void;
  /**
   * Register an exit handler. Invoked when the server sends an exit control
   * message (`{type:'exit', code: number}`). Returns an unsubscribe function.
   */
  onExit: (handler: (code: number) => void) => () => void;
  /**
   * Register a status handler. Invoked when the server sends a status control
   * message (`{type:'status', status: string}`). Returns an unsubscribe function.
   */
  onStatus: (handler: (status: string) => void) => () => void;
  /**
   * Send a payload to the WebSocket. Strings are sent as text frames;
   * Uint8Array / ArrayBuffer are sent as binary frames. Returns `true`
   * if the data was sent, `false` if the connection is not currently
   * open (silently dropped).
   */
  send: (data: string | Uint8Array) => boolean;
  /** Manually trigger a reconnect. Resets the attempt counter. */
  reconnect: () => void;
  /** Terminate the connection permanently (no further automatic reconnects). */
  terminate: () => void;
}

const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];
const DEFAULT_MAX_ATTEMPTS = 10;

/** Application-defined close codes (mirrored from the server). */
const CLOSE_CODE_ALREADY_CONNECTED = 4001;
const CLOSE_CODE_SESSION_NOT_FOUND = 4004;

/** Compute the backoff delay (ms) for the given 1-based attempt number. */
function computeBackoff(attempt: number, sequence: readonly number[]): number {
  const idx = Math.min(Math.max(0, attempt - 1), sequence.length - 1);
  return sequence[idx] ?? sequence[sequence.length - 1] ?? 30000;
}

/** Default URL builder: ws(s)://host/terminal/{sessionId}. */
function buildDefaultUrl(sessionId: string): string {
  if (typeof window === 'undefined') {
    return `ws://localhost/terminal/${sessionId}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In both dev and production, use the browser's view of the host.
  // Dev:  Vite proxies /terminal → localhost:3001 (ws: true in config).
  // Prod: nginx proxies /terminal → localhost:3001.
  const host = window.location.host;
  return `${protocol}//${host}/terminal/${sessionId}`;
}

/**
 * React hook that manages a single WebSocket connection to the terminal
 * backend for a given session, with automatic exponential backoff reconnection.
 *
 * The hook is responsible for:
 * - Opening the initial WebSocket on mount (or when `sessionId` changes)
 * - Reconnecting on close with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s — max 30s)
 * - Capping reconnect attempts (default: 10) and transitioning to `error` when exhausted
 * - Treating close codes 4004 (session not found) and 4001 (already connected) as
 *   permanent, non-recoverable errors
 * - Cleaning up timers and the WebSocket on unmount
 *
 * Consumers receive messages via the `data(handler)` registration and send
 * input via `send(data)`. The hook's `status` reflects the current state.
 */
export function useTerminalSocket(
  sessionId: string,
  options: UseTerminalSocketOptions = {},
): UseTerminalSocketReturn {
  const {
    WebSocketImpl,
    buildUrl = buildDefaultUrl,
    connectDims,
    backoffSequence = DEFAULT_BACKOFF_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;
  const connectDimsRef = useRef(connectDims);
  connectDimsRef.current = connectDims;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<ConnectionError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Refs (mutated freely; never trigger renders).
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminatedRef = useRef(false);
  const cleanedUpRef = useRef(false);
  const handlersRef = useRef<Set<DataHandler>>(new Set());
  const exitHandlersRef = useRef<Set<(code: number) => void>>(new Set());
  const statusHandlersRef = useRef<Set<(status: string) => void>>(new Set());
  /** Mirror of `attempt` state, used inside the stable `connect` callback. */
  const attemptRef = useRef(0);
  /** Mirror of `sessionId`, used inside the stable `connect` callback. */
  const sessionIdRef = useRef(sessionId);

  // Keep refs in sync with props/state.
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const detachHandlers = useCallback((ws: WebSocket) => {
    // Drop the hook's listeners before closing so onclose (if it fires) does
    // not trigger a reconnect attempt while we're tearing down.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }, []);

  const closeCurrentWs = useCallback(
    (code = 1000, reason = 'client closing') => {
      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        detachHandlers(ws);
        try {
          ws.close(code, reason);
        } catch {
          // Swallow close errors (e.g., socket already in CLOSING state).
        }
      }
    },
    [detachHandlers],
  );

  const connect = useCallback(() => {
    if (terminatedRef.current) return;

    // If a WS is already in flight or open, do nothing.
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if (rs === WebSocket.CONNECTING || rs === WebSocket.OPEN) return;
    }

    clearReconnectTimer();
    setStatus(attemptRef.current > 0 ? 'reconnecting' : 'connecting');
    setError(null);

    let url = buildUrl(sessionIdRef.current);
    // Attach last-known dims so the server can fire the armed TUI launch on open
    // (see UseTerminalSocketOptions.connectDims). Only valid positive ints.
    const dims = connectDimsRef.current?.();
    if (dims && dims.cols > 0 && dims.rows > 0) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}cols=${Math.round(dims.cols)}&rows=${Math.round(dims.rows)}`;
    }
    const Ctor: typeof WebSocket | undefined =
      WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (!Ctor) {
      setStatus('error');
      setError({
        message: 'WebSocket is not available in this environment',
        recoverable: false,
      });
      return;
    }

    const ws = new Ctor(url) as WebSocket;
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (terminatedRef.current) {
        // We were terminated while connecting; drop the socket quietly.
        return;
      }
      setStatus('connected');
      setError(null);
      attemptRef.current = 0;
      setAttempt(0);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (terminatedRef.current) return;

      // ── Prod diagnostic (black-screen bug) ──
      // Enable in the browser console with: localStorage.alfWsDebug = '1'
      // Logs every inbound frame so we can tell front-vs-backend when a fresh
      // session renders black: frames arriving but screen black = frontend
      // render bug; no frames = backend. Remove once the bug is pinned.
      if (localStorage.getItem('alfWsDebug') === '1') {
        const len =
          event.data instanceof ArrayBuffer
            ? event.data.byteLength
            : typeof event.data === 'string'
              ? event.data.length
              : -1;
        const preview =
          typeof event.data === 'string'
            ? event.data.slice(0, 60)
            : event.data instanceof ArrayBuffer
              ? Array.from(new Uint8Array(event.data).slice(0, 24))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(' ')
              : '';
        // eslint-disable-next-line no-console
        console.log(`[alfWsDebug] ${sessionId.slice(0, 8)} frame ${len}b`, preview);
      }

      // Binary frames (PTY output) → emit as Uint8Array directly
      if (event.data instanceof ArrayBuffer) {
        const binary = new Uint8Array(event.data);
        const handlers = Array.from(handlersRef.current);
        for (const handler of handlers) {
          try {
            handler(binary);
          } catch (err) {
            console.error('[useTerminalSocket] data handler threw:', err);
          }
        }
        return;
      }

      // Text frames — could be JSON control messages or raw PTY output
      const data = typeof event.data === 'string' ? event.data : String(event.data);

      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
          if (parsed.type === 'exit') {
            const exitHandlers = Array.from(exitHandlersRef.current);
            for (const handler of exitHandlers) {
              try {
                handler(parsed.code);
              } catch {
                /* swallow */
              }
            }
            return;
          }
          if (parsed.type === 'status') {
            const statusHandlers = Array.from(statusHandlersRef.current);
            for (const handler of statusHandlers) {
              try {
                handler(parsed.status);
              } catch {
                /* swallow */
              }
            }
            return;
          }
        }
      } catch {
        /* Not JSON — raw PTY output, fall through to data handlers */
      }

      // Snapshot the set so a handler that unsubscribes during dispatch
      // doesn't mutate it mid-iteration.
      const handlers = Array.from(handlersRef.current);
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error('[useTerminalSocket] data handler threw:', err);
        }
      }
    };

    // onerror is intentionally a no-op: the close event always fires after
    // an error, and the close handler does the real classification work.
    ws.onerror = () => {
      /* no-op — see onclose */
    };

    ws.onclose = (event: CloseEvent) => {
      if (terminatedRef.current) return;

      // Detach all handlers on the closing socket. A late onopen from a
      // setTimeout that was already in flight when we closed must not flip
      // the connection state back to 'connected' on a stale socket.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;

      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // If the socket was closed by React's cleanup (component unmount or
      // sessionId change), do NOT transition to 'disconnected' — the
      // component is tearing down and any status update would be a false
      // positive on the badge.
      if (cleanedUpRef.current) {
        return;
      }

      // Permanent close codes (application-defined).
      if (event.code === CLOSE_CODE_SESSION_NOT_FOUND) {
        setStatus('error');
        setError({
          code: CLOSE_CODE_SESSION_NOT_FOUND,
          reason: event.reason,
          message: 'Session not found. It may have been closed.',
          recoverable: false,
        });
        return;
      }
      if (event.code === CLOSE_CODE_ALREADY_CONNECTED) {
        setStatus('error');
        setError({
          code: CLOSE_CODE_ALREADY_CONNECTED,
          reason: event.reason,
          message: 'Session is in use elsewhere. Only one connection is allowed per session.',
          recoverable: false,
        });
        return;
      }

      // Normal close (1000) on the *first* attempt means the server explicitly
      // ended the session without errors. Treat as final, no reconnect.
      if (event.code === 1000 && attemptRef.current === 0) {
        setStatus('disconnected');
        return;
      }

      // Otherwise, schedule a reconnect with exponential backoff.
      const nextAttempt = attemptRef.current + 1;
      if (nextAttempt > maxAttempts) {
        setStatus('error');
        setError({
          message:
            'Could not reconnect after multiple attempts. The session is still active on the server. Please reload the page.',
          recoverable: true,
        });
        return;
      }

      attemptRef.current = nextAttempt;
      setAttempt(nextAttempt);
      setStatus('reconnecting');

      const delay = computeBackoff(nextAttempt, backoffSequence);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [WebSocketImpl, buildUrl, backoffSequence, maxAttempts, clearReconnectTimer]);

  // Mount/unmount: connect on mount or sessionId change, clean up on unmount.
  useEffect(() => {
    terminatedRef.current = false;
    cleanedUpRef.current = false;
    attemptRef.current = 0;
    setAttempt(0);
    setError(null);
    connect();

    return () => {
      cleanedUpRef.current = true;
      terminatedRef.current = true;
      clearReconnectTimer();
      closeCurrentWs();
    };
    // We intentionally only re-run on sessionId change. The `connect` callback
    // is stable (all its deps are stable), so adding it would not provide any
    // benefit and would risk subtle re-init loops if React re-creates the
    // callback for any reason.
  }, [sessionId]);

  // Manual reconnect: reset attempt counter and immediately dial.
  const reconnect = useCallback(() => {
    if (terminatedRef.current) return;
    clearReconnectTimer();
    closeCurrentWs();
    attemptRef.current = 0;
    setAttempt(0);
    setError(null);
    connect();
  }, [connect, clearReconnectTimer, closeCurrentWs]);

  // Permanent termination: stop everything, mark as error.
  const terminate = useCallback(() => {
    terminatedRef.current = true;
    clearReconnectTimer();
    closeCurrentWs();
    setStatus('error');
    setError({
      message: 'Connection terminated.',
      recoverable: false,
    });
  }, [clearReconnectTimer, closeCurrentWs]);

  // Message handler registration. Returns an unsubscribe function so callers
  // can clean up symmetrically in useEffect.
  const data = useCallback((handler: DataHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const onExit = useCallback((handler: (code: number) => void) => {
    exitHandlersRef.current.add(handler);
    return () => {
      exitHandlersRef.current.delete(handler);
    };
  }, []);

  const onStatus = useCallback((handler: (status: string) => void) => {
    statusHandlersRef.current.add(handler);
    return () => {
      statusHandlersRef.current.delete(handler);
    };
  }, []);

  // Send: silently drop if the socket isn't open. Matches pre-refactor
  // XTermTerminal behavior (no buffering, no throw).
  const send = useCallback((payload: string | Uint8Array): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      return true;
    }
    return false;
  }, []);

  return {
    status,
    error,
    attempt,
    maxAttempts,
    data,
    onExit,
    onStatus,
    send,
    reconnect,
    terminate,
  };
}
