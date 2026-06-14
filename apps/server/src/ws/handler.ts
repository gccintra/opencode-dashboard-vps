/**
 * WebSocket transport for active sessions.
 *
 * Multiple browser tabs may connect to the same session simultaneously.
 * The browser opens a WebSocket connection to `/terminal/:sessionId` after
 * creating a session via the REST API. This module bridges the browser's
 * text messages ↔ the PTY Manager's stdin/stdout, with four responsibilities:
 *
 *  1. **Buffer replay** — on connect, the server pushes the session's
 *     accumulated output buffer so xterm.js can paint the last visible
 *     state immediately (reconnection / new-tab UX).
 *
 *  2. **Bidirectional relay** — text from the client goes to
 *     `writeToSession`; data events from the PTY go back to the client.
 *
 *  3. **Multi-tab support** — multiple WebSocket clients may connect to
 *     the same session. Output is broadcast to all, and input from any
 *     tab is forwarded to the PTY.
 *
 *  4. **Callback cleanup** — when a client disconnects, its registered
 *     PTY callbacks are explicitly removed from the manager to prevent
 *     the documented memory leak (§10 line 1711-1726).
 *
 * The PTY process is NOT killed when all WS clients disconnect. PTYs are
 * long-lived; users may disconnect/reconnect freely. Killing happens
 * only via `DELETE /api/sessions/:id`.
 *
 * The three handlers (`handleOpen`, `handleMessage`, `handleClose`)
 * are exported as standalone functions so the test suite can drive
 * them with mock WS objects without going through a real WebSocket
 * upgrade. The `wsRoutes` Elysia plugin simply wires these into the
 * `app.ws()` lifecycle.
 */

import { Elysia } from 'elysia';
import { getPtyManager } from '../pty/manager';
import { getSessionMetaById } from '../routes/sessions';

/* ── Types ── */

type DataCb = (chunk: string) => void;
type ExitCb = (code: number) => void;
type StatusCb = (status: string) => void;

interface ClientEntry {
  ws: WSLike;
  dataCb: DataCb;
  exitCb: ExitCb;
  statusCb?: StatusCb;
}

/**
 * Map of active session connections — multiple WebSocket clients per
 * session. The PTY session lifecycle is independent of the WS connections.
 */
const connectedClients = new Map<string, Set<ClientEntry>>();

/** Close codes (4000-4999 reserved for application use). */
export const CLOSE_SESSION_NOT_FOUND = 4004;
export const CLOSE_SESSION_ENDED = 4004;

/** Public surface for the handler — minimal subset of ElysiaWS we need. */
export interface WSLike {
  data: { params: { sessionId: string } };
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): unknown;
  close(code?: number, reason?: string): void;
}

/**
 * Test helper: drop any tracked WebSocket connections. The PTY sessions
 * themselves are unaffected (they're owned by the manager, not the WS
 * layer). Exported for use in test teardown to prevent state leaking
 * between test cases.
 */
export function resetConnectedClients(): void {
  connectedClients.clear();
}

/**
 * Check if a session currently has any active WebSocket connection.
 * Exported for testing.
 */
export function hasConnection(sessionId: string): boolean {
  return (connectedClients.get(sessionId)?.size ?? 0) > 0;
}

/**
 * Validate that a session id is known to the PTY Manager.
 *
 * Uses `getSessionStatus` (a pure in-memory lookup) instead of a probe
 * write, which avoids sending empty frames to the PTY worker for sessions
 * that are still registered in the manager but whose process has already
 * exited — those would cause spurious "session not found" worker errors.
 */
export function sessionExists(sessionId: string): boolean {
  return getPtyManager().getSessionStatus(sessionId) !== null;
}

/**
 * Handle a new WebSocket connection.
 *
 * Rejects unknown sessions with 4004, rejects ended sessions with 4004,
 * otherwise registers the connection, replays the buffer, and subscribes
 * to PTY output and exit events.
 */
export function handleOpen(ws: WSLike): void {
  const sessionId = ws.data.params.sessionId;

  const status = getPtyManager().getSessionStatus(sessionId);
  if (!status) {
    // If the session exists in metadata but the PTY is gone, it ended (e.g. after restart).
    // Otherwise it was never created or already cleaned up.
    const meta = getSessionMetaById(sessionId);
    ws.close(CLOSE_SESSION_ENDED, meta ? 'Session has ended' : 'Session not found');
    return;
  }
  if (status === 'exited' || status === 'killed') {
    ws.close(CLOSE_SESSION_ENDED, 'Session has ended');
    return;
  }

  // Buffer replay: send the accumulated output so xterm.js can
  // paint the last known state. If the session is fresh, the
  // buffer is empty and this is a no-op.
  const buffer = getPtyManager().getSessionBuffer(sessionId);
  if (buffer.length > 0) {
    // Must use Buffer (Node.js Buffer / Bun Buffer) — Elysia only passes
    // Buffer instances directly to raw.send() as binary frames.
    // Uint8Array and ArrayBuffer are both JSON.stringify'd by Elysia.
    ws.send(Buffer.from(buffer, 'binary'));
  }

  const manager = getPtyManager();

  // Send the current detected status immediately on connect so the frontend
  // can initialize prevStatus correctly. Status changes are only sent on
  // transitions, so without this the frontend never knows the initial state.
  const detectedStatus = manager.getDetectedStatus(sessionId);
  if (detectedStatus && detectedStatus !== 'finished') {
    try {
      ws.send(JSON.stringify({ type: 'status', status: detectedStatus }));
    } catch {
      // ignore
    }
  }

  // Subscribe to PTY output. The callback runs on every chunk
  // produced by the underlying process. Skip the send if the
  // socket is already closed (race on shutdown).
  const dataCb: DataCb = (chunk) => {
    if (ws.readyState === 3 /* CLOSED */) return;
    // Must use Buffer — Elysia only passes Buffer to raw.send() as binary.
    // Uint8Array and ArrayBuffer are JSON.stringify'd.
    ws.send(Buffer.from(chunk, 'binary'));
  };

  // Subscribe to PTY exit. The manager fires this exactly once
  // per session; we forward it to the client as a JSON frame so
  // xterm.js can mark the session as finished.
  const exitCb: ExitCb = (code) => {
    if (ws.readyState === 3) return;
    try {
      ws.send(JSON.stringify({ type: 'exit', code }));
    } catch {
      // ignore: socket may have closed mid-frame
    }
    ws.close();
  };

  // Subscribe to status changes. The status monitor polls every
  // second and fires the callback when the detected status changes
  // (e.g. active → waiting when a prompt appears).
  const statusCb: StatusCb = (status) => {
    if (ws.readyState === 3) return;
    try {
      ws.send(JSON.stringify({ type: 'status', status }));
    } catch {
      // ignore: socket may have closed mid-frame
    }
  };

  manager.onSessionData(sessionId, dataCb);
  manager.onSessionExit(sessionId, exitCb);
  manager.onSessionStatus(sessionId, statusCb);

  const entry: ClientEntry = { ws, dataCb, exitCb, statusCb };
  if (!connectedClients.has(sessionId)) {
    connectedClients.set(sessionId, new Set());
  }
  connectedClients.get(sessionId)!.add(entry);
}

/**
 * Handle a text message from the browser — forward to the PTY stdin.
 *
 * Accepts string and binary frames (decoded as UTF-8) since the
 * browser's `WebSocket.send(ArrayBuffer)` path is used by some
 * terminal input strategies.
 */
export function handleMessage(ws: WSLike, message: unknown): void {
  const sessionId = ws.data.params.sessionId;
  let data: string;
  if (typeof message === 'string') {
    data = message;
  } else if (message instanceof ArrayBuffer) {
    data = new TextDecoder().decode(new Uint8Array(message));
  } else if (ArrayBuffer.isView(message)) {
    data = new TextDecoder().decode(message.buffer);
  } else {
    // Unknown type — coerce to string best-effort.
    data = String(message);
  }

  try {
    getPtyManager().writeToSession(sessionId, data);
  } catch {
    // The session is gone (e.g. the PTY process exited between
    // the buffer-replay subscribe and now). Close the WS so the
    // client doesn't keep sending into the void.
    ws.close(1011, 'Session unavailable');
  }
}

/**
 * Handle a browser-initiated close. The PTY process keeps running.
 *
 * Removes only THIS client's registered callbacks from the PTY manager
 * to prevent the memory leak documented in §10 (line 1711-1726). If
 * this was the last client for the session, the entry is cleaned up
 * from the map entirely.
 */
export function handleClose(ws: WSLike): void {
  const sessionId = ws.data.params.sessionId;
  const clients = connectedClients.get(sessionId);
  if (!clients) return;

  // Find and remove THIS specific client.
  for (const entry of clients) {
    if (entry.ws === ws) {
      const manager = getPtyManager();
      manager.removeSessionData(sessionId, entry.dataCb);
      manager.removeSessionExit(sessionId, entry.exitCb);
      if (entry.statusCb) manager.removeSessionStatus(sessionId, entry.statusCb);
      clients.delete(entry);
      break;
    }
  }

  // Clean up empty sets.
  if (clients.size === 0) {
    connectedClients.delete(sessionId);
  }
}

export const wsRoutes = new Elysia().ws('/terminal/:sessionId', {
  // ── open: WS connection established ─────────────────────────────
  open(ws) {
    handleOpen(ws as unknown as WSLike);
  },

  // ── message: text from the browser → PTY stdin ──────────────────
  message(ws, message) {
    handleMessage(ws as unknown as WSLike, message);
  },

  // ── close: browser disconnected (or we asked it to) ─────────────
  close(ws) {
    handleClose(ws as unknown as WSLike);
  },
});
