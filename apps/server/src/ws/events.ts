/**
 * Global session-events WebSocket channel.
 *
 * The terminal WebSocket (`/terminal/:sessionId`) is per-session: a client only
 * receives data for the one session it attached to. But several frontend
 * surfaces need to know about session *list* changes (created / closed /
 * renamed / cleared / exited) without having any terminal open — the Sidebar,
 * the Sessions page, the empty Canvas hub. Those used to poll
 * `GET /api/projects/:id/sessions` every 10-15s.
 *
 * This module replaces that polling with a single global push channel. Every
 * browser tab opens one WebSocket to `/ws/events`; the server broadcasts a
 * small JSON control frame whenever a session mutation happens in the REST
 * routes. The frontend reacts by re-fetching (or updating optimistically).
 *
 * It mirrors the structure of `handler.ts`:
 *  - a `Set` of connected clients (here keyed by nothing — it's a flat global
 *    broadcast, not per-session)
 *  - `handleOpen` / `handleClose` lifecycle functions exported standalone so
 *    the test suite can drive them with mock WS objects
 *  - `resetConnectedEventClients()` for test teardown
 *
 * The channel is **server → client only**: clients never send frames. Inbound
 * messages are ignored entirely, which keeps the attack surface minimal (no
 * input is parsed, evaluated, or written anywhere).
 *
 * WS auth is DEFERRED by design — same as `/terminal`. The upgrade is accepted
 * before any auth hook runs. On a single-user VPS the risk is low; hardening
 * (token validation in `open`) is tracked separately.
 */

import { Elysia } from 'elysia';

/* ── Types ── */

/** Action describing what changed in the session list. */
export type SessionEventAction = 'created' | 'closed' | 'renamed' | 'exited' | 'cleared';

/**
 * Payload broadcast to every connected client. Serialized as a JSON text frame
 * with a fixed `type: 'sessions-changed'` discriminator so the frontend can
 * route it alongside the existing terminal control frames.
 */
export interface SessionEvent {
  action: SessionEventAction;
  /** Present for created / closed / renamed / exited. Absent for cleared. */
  sessionId?: string;
  /** Present for created / cleared. May be null for emergency sessions. */
  projectId?: string | null;
  /** Present for created / renamed. */
  name?: string;
  /** Present for cleared — number of sessions removed. */
  count?: number;
}

/** Minimal subset of ElysiaWS we rely on — keeps the handlers testable. */
export interface EventsWSLike {
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): unknown;
  close(code?: number, reason?: string): void;
}

/**
 * Flat set of every connected events client. Unlike `handler.ts` there is no
 * per-session keying — every event is broadcast to all clients, which then
 * decide (in the hook / component) whether the change is relevant.
 */
const connectedEventClients = new Set<EventsWSLike>();

/** WebSocket OPEN readyState constant (avoids importing the WS class). */
const WS_OPEN = 1;

/**
 * Test helper: drop all tracked clients. Exported for use in test teardown so
 * connection state doesn't leak between cases.
 */
export function resetConnectedEventClients(): void {
  connectedEventClients.clear();
}

/** Number of currently connected event clients. Exported for testing. */
export function connectedEventClientCount(): number {
  return connectedEventClients.size;
}

/**
 * Register a new client and send the initial heartbeat so the frontend can
 * confirm the channel is live.
 */
export function handleOpen(ws: EventsWSLike): void {
  connectedEventClients.add(ws);
  try {
    ws.send(JSON.stringify({ type: 'connected' }));
  } catch {
    // Socket may have closed between upgrade and here — ignore.
  }
}

/** Deregister a client on close. Idempotent. */
export function handleClose(ws: EventsWSLike): void {
  connectedEventClients.delete(ws);
}

/**
 * Broadcast a session-list change to every connected client.
 *
 * Sent as `{ type: 'sessions-changed', ...event }`. Clients whose socket is
 * not OPEN (CONNECTING / CLOSING / CLOSED) are skipped — a CLOSED socket is
 * also pruned from the set so it can't accumulate. A throwing `send` (socket
 * died mid-frame) is swallowed and the client pruned.
 *
 * Safe to call from REST handlers even when no clients are connected (no-op).
 */
export function broadcastSessionEvent(event: SessionEvent): void {
  if (connectedEventClients.size === 0) return;

  const frame = JSON.stringify({ type: 'sessions-changed', ...event });

  for (const ws of Array.from(connectedEventClients)) {
    if (ws.readyState !== WS_OPEN) {
      // CLOSED (3) sockets are dead — prune. CONNECTING (0) sockets are not
      // ready yet; they'll get the next event. CLOSING (2) is also dead.
      if (ws.readyState === 3) connectedEventClients.delete(ws);
      continue;
    }
    try {
      ws.send(frame);
    } catch {
      // Socket died mid-frame — drop it.
      connectedEventClients.delete(ws);
    }
  }
}

/**
 * Elysia plugin exposing the `/ws/events` channel. Wires the standalone
 * handlers into the WS lifecycle. Inbound `message` frames are intentionally
 * ignored — this is a push-only channel.
 */
export const eventsWsRoutes = new Elysia().ws('/ws/events', {
  open(ws) {
    handleOpen(ws as unknown as EventsWSLike);
  },
  // Push-only channel: clients never send. Ignore any inbound frame so a
  // misbehaving or malicious client cannot drive any server-side behavior.
  message() {
    /* no-op */
  },
  close(ws) {
    handleClose(ws as unknown as EventsWSLike);
  },
});
