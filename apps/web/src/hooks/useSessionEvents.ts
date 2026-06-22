import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useSessionEvents — single global WebSocket to `/ws/events`.
 *
 * Replaces per-component HTTP polling of `GET /api/projects/:id/sessions`.
 * The server pushes a `{ type: 'sessions-changed', action, ... }` frame
 * whenever a session is created / closed / renamed / cleared / exited; this
 * hook surfaces those frames to subscribers via `onSessionEvent`.
 *
 * Connection management mirrors `useTerminalSocket`:
 *  - opens on mount, cleans up on unmount
 *  - exponential backoff reconnect (1s→30s, max 10 attempts)
 *  - `cleanedUpRef` prevents a false-positive status flip on React 19's
 *    double-invoked unmount
 *  - application close codes 4000-4999 are permanent (no retry)
 *
 * Unlike the terminal socket this is **receive-only**: the hook never sends.
 */

/** Connection status state machine (mirrors useTerminalSocket). */
export type EventConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/** Action describing what changed in the session list (mirrors the server). */
export type SessionEventAction = 'created' | 'closed' | 'renamed' | 'exited' | 'cleared';

/** A session-list change pushed by the server. */
export interface SessionEvent {
  type: 'sessions-changed';
  action: SessionEventAction;
  sessionId?: string;
  projectId?: string | null;
  name?: string;
  count?: number;
}

/** Callback signature for session-event subscribers. */
export type SessionEventHandler = (event: SessionEvent) => void;

/** Options for {@link useSessionEvents}. All optional; used in tests. */
export interface UseSessionEventsOptions {
  /** Custom WebSocket constructor. Defaults to the global `WebSocket`. */
  WebSocketImpl?: typeof WebSocket;
  /** Custom URL builder. Defaults to `ws(s)://host/ws/events`. */
  buildUrl?: () => string;
  /** Backoff sequence in ms. Defaults to `[1000, 2000, 4000, 8000, 16000, 30000]`. */
  backoffSequence?: number[];
  /** Maximum reconnect attempts before transitioning to `error`. Defaults to 10. */
  maxAttempts?: number;
  /** When false, the hook does not connect (e.g. unauthenticated). Defaults to true. */
  enabled?: boolean;
}

/** Return shape of {@link useSessionEvents}. */
export interface UseSessionEventsReturn {
  /** Current connection status. */
  status: EventConnectionStatus;
  /** Number of reconnect attempts since the last successful connection. */
  attempt: number;
  /** Maximum reconnect attempts allowed. */
  maxAttempts: number;
  /**
   * Register a session-event handler. Invoked once per received
   * `sessions-changed` frame. Returns an unsubscribe function.
   */
  onSessionEvent: (handler: SessionEventHandler) => () => void;
  /** Manually trigger a reconnect. Resets the attempt counter. */
  reconnect: () => void;
  /** Terminate the connection permanently (no further automatic reconnects). */
  terminate: () => void;
}

const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];
const DEFAULT_MAX_ATTEMPTS = 10;

/** Compute the backoff delay (ms) for the given 1-based attempt number. */
function computeBackoff(attempt: number, sequence: readonly number[]): number {
  const idx = Math.min(Math.max(0, attempt - 1), sequence.length - 1);
  return sequence[idx] ?? sequence[sequence.length - 1] ?? 30000;
}

/** Default URL builder: ws(s)://host/ws/events. */
function buildDefaultUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://localhost/ws/events';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Dev:  Vite proxies /ws/events → localhost:3001 (ws: true in config).
  // Prod: nginx proxies /ws/events → localhost:3001.
  const host = window.location.host;
  return `${protocol}//${host}/ws/events`;
}

/** Is `code` an application-defined (permanent) close code? */
function isPermanentCloseCode(code: number): boolean {
  return code >= 4000 && code <= 4999;
}

/**
 * React hook that manages a single global WebSocket to the session-events
 * backend, with automatic exponential backoff reconnection.
 *
 * Multiple components may mount this hook independently; each opens its own
 * connection. To share one connection per tab, mount it once high in the tree
 * and pass `onSessionEvent` down — but independent mounts are also correct.
 */
export function useSessionEvents(
  options: UseSessionEventsOptions = {},
): UseSessionEventsReturn {
  const {
    WebSocketImpl,
    buildUrl = buildDefaultUrl,
    backoffSequence = DEFAULT_BACKOFF_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    enabled = true,
  } = options;

  const [status, setStatus] = useState<EventConnectionStatus>('idle');
  const [attempt, setAttempt] = useState(0);

  // Refs (mutated freely; never trigger renders).
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminatedRef = useRef(false);
  const cleanedUpRef = useRef(false);
  const handlersRef = useRef<Set<SessionEventHandler>>(new Set());
  /** Mirror of `attempt` state, used inside the stable `connect` callback. */
  const attemptRef = useRef(0);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const detachHandlers = useCallback((ws: WebSocket) => {
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

    const url = buildUrl();
    const Ctor: typeof WebSocket | undefined =
      WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (!Ctor) {
      setStatus('error');
      return;
    }

    const ws = new Ctor(url) as WebSocket;
    wsRef.current = ws;

    ws.onopen = () => {
      if (terminatedRef.current) return;
      setStatus('connected');
      attemptRef.current = 0;
      setAttempt(0);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (terminatedRef.current) return;
      // Channel is text-only JSON. Ignore anything else.
      const raw = typeof event.data === 'string' ? event.data : null;
      if (raw === null) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // not JSON — ignore
      }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { type?: unknown };
      // Heartbeat — just confirms the channel; not a list change.
      if (msg.type === 'connected') return;
      if (msg.type !== 'sessions-changed') return;

      const sessionEvent = parsed as SessionEvent;
      // Snapshot the set so a handler that unsubscribes during dispatch
      // doesn't mutate it mid-iteration.
      const handlers = Array.from(handlersRef.current);
      for (const handler of handlers) {
        try {
          handler(sessionEvent);
        } catch (err) {
          console.error('[useSessionEvents] handler threw:', err);
        }
      }
    };

    // onerror is a no-op: close always follows and does the classification.
    ws.onerror = () => {
      /* no-op — see onclose */
    };

    ws.onclose = (event: CloseEvent) => {
      if (terminatedRef.current) return;

      // Detach handlers so a stale in-flight onopen can't flip state back.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;

      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Closed by React's cleanup (unmount): don't flip status — the component
      // is tearing down and any update would be a false positive.
      if (cleanedUpRef.current) {
        return;
      }

      // Permanent application close codes (4000-4999) — no retry.
      if (isPermanentCloseCode(event.code)) {
        setStatus('error');
        return;
      }

      // Normal close (1000) on the first attempt: server ended cleanly.
      if (event.code === 1000 && attemptRef.current === 0) {
        setStatus('disconnected');
        return;
      }

      // Otherwise schedule a reconnect with exponential backoff.
      const nextAttempt = attemptRef.current + 1;
      if (nextAttempt > maxAttempts) {
        setStatus('error');
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

  // Mount/unmount: connect on mount, clean up on unmount.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    terminatedRef.current = false;
    cleanedUpRef.current = false;
    attemptRef.current = 0;
    setAttempt(0);
    connect();

    return () => {
      cleanedUpRef.current = true;
      terminatedRef.current = true;
      clearReconnectTimer();
      closeCurrentWs();
    };
    // connect/clearReconnectTimer/closeCurrentWs are stable; we intentionally
    // only re-run when the channel is enabled/disabled (mirrors useTerminalSocket).
  }, [enabled]);

  const reconnect = useCallback(() => {
    if (terminatedRef.current) return;
    clearReconnectTimer();
    closeCurrentWs();
    attemptRef.current = 0;
    setAttempt(0);
    connect();
  }, [connect, clearReconnectTimer, closeCurrentWs]);

  const terminate = useCallback(() => {
    terminatedRef.current = true;
    clearReconnectTimer();
    closeCurrentWs();
    setStatus('error');
  }, [clearReconnectTimer, closeCurrentWs]);

  const onSessionEvent = useCallback((handler: SessionEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return {
    status,
    attempt,
    maxAttempts,
    onSessionEvent,
    reconnect,
    terminate,
  };
}
