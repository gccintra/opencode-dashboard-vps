/**
 * Session-events WebSocket channel tests.
 *
 * The Elysia `app.ws()` lifecycle doesn't expose a clean unit-test surface
 * through `app.handle()`, so this suite drives the exported standalone
 * handlers (`handleOpen`, `handleClose`, `broadcastSessionEvent`) with a mock
 * `EventsWSLike` object, plus a route-registration check.
 *
 * Coverage:
 *  - open: client registered, initial `{type:'connected'}` heartbeat sent
 *  - broadcast: every OPEN client receives the frame; CLOSED clients skipped
 *    and pruned; CONNECTING clients skipped (not pruned); throwing send pruned
 *  - close: client removed (no longer receives broadcasts)
 *  - resetConnectedEventClients clears state
 *  - route registration: `/ws/events` exists on the plugin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Elysia } from 'elysia';
import {
  handleOpen,
  handleClose,
  broadcastSessionEvent,
  resetConnectedEventClients,
  connectedEventClientCount,
  eventsWsRoutes,
  type EventsWSLike,
  type SessionEvent,
} from './events';

/** WebSocket readyState constants. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** Build a mock WS in a given readyState with a spyable `send`. */
function makeWs(readyState = OPEN, sendImpl?: () => void): EventsWSLike & { send: ReturnType<typeof vi.fn> } {
  return {
    readyState,
    send: vi.fn(sendImpl),
    close: vi.fn(),
  };
}

describe('events WS channel', () => {
  beforeEach(() => {
    resetConnectedEventClients();
  });

  describe('handleOpen', () => {
    it('registers the client', () => {
      const ws = makeWs();
      expect(connectedEventClientCount()).toBe(0);
      handleOpen(ws);
      expect(connectedEventClientCount()).toBe(1);
    });

    it('sends the initial { type: "connected" } heartbeat', () => {
      const ws = makeWs();
      handleOpen(ws);
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toEqual({ type: 'connected' });
    });

    it('swallows a send that throws during the heartbeat', () => {
      const ws = makeWs(OPEN, () => {
        throw new Error('socket gone');
      });
      expect(() => handleOpen(ws)).not.toThrow();
      // Client is still registered even though heartbeat failed.
      expect(connectedEventClientCount()).toBe(1);
    });
  });

  describe('handleClose', () => {
    it('removes the client', () => {
      const ws = makeWs();
      handleOpen(ws);
      expect(connectedEventClientCount()).toBe(1);
      handleClose(ws);
      expect(connectedEventClientCount()).toBe(0);
    });

    it('is idempotent for an unknown client', () => {
      const ws = makeWs();
      expect(() => handleClose(ws)).not.toThrow();
      expect(connectedEventClientCount()).toBe(0);
    });
  });

  describe('broadcastSessionEvent', () => {
    it('is a no-op with no connected clients', () => {
      expect(() => broadcastSessionEvent({ action: 'created', sessionId: 's1' })).not.toThrow();
    });

    it('sends the event to every connected OPEN client', () => {
      const a = makeWs();
      const b = makeWs();
      handleOpen(a);
      handleOpen(b);
      a.send.mockClear();
      b.send.mockClear();

      const event: SessionEvent = {
        action: 'created',
        sessionId: 's1',
        projectId: 'p1',
        name: 'Sessão 1',
      };
      broadcastSessionEvent(event);

      const expectedFrame = JSON.stringify({ type: 'sessions-changed', ...event });
      expect(a.send).toHaveBeenCalledWith(expectedFrame);
      expect(b.send).toHaveBeenCalledWith(expectedFrame);
    });

    it('builds the frame with the sessions-changed discriminator and action', () => {
      const ws = makeWs();
      handleOpen(ws);
      ws.send.mockClear();

      broadcastSessionEvent({ action: 'renamed', sessionId: 's1', name: 'New' });
      const frame = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(frame).toEqual({
        type: 'sessions-changed',
        action: 'renamed',
        sessionId: 's1',
        name: 'New',
      });
    });

    it('emits the cleared action with a count', () => {
      const ws = makeWs();
      handleOpen(ws);
      ws.send.mockClear();

      broadcastSessionEvent({ action: 'cleared', projectId: 'p1', count: 3 });
      const frame = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(frame).toMatchObject({ type: 'sessions-changed', action: 'cleared', count: 3 });
    });

    it('does NOT send to a client that has disconnected (handleClose)', () => {
      const a = makeWs();
      const b = makeWs();
      handleOpen(a);
      handleOpen(b);
      handleClose(b);
      a.send.mockClear();
      b.send.mockClear();

      broadcastSessionEvent({ action: 'closed', sessionId: 's1' });
      expect(a.send).toHaveBeenCalledTimes(1);
      expect(b.send).not.toHaveBeenCalled();
    });

    it('skips a CONNECTING client without pruning it', () => {
      const ws = makeWs(CONNECTING);
      handleOpen(ws);
      ws.send.mockClear();

      broadcastSessionEvent({ action: 'created', sessionId: 's1' });
      expect(ws.send).not.toHaveBeenCalled();
      // Not pruned — it will receive the next event once OPEN.
      expect(connectedEventClientCount()).toBe(1);
    });

    it('skips and prunes a CLOSED client', () => {
      const ws = makeWs(CLOSED);
      handleOpen(ws);
      ws.send.mockClear();

      broadcastSessionEvent({ action: 'created', sessionId: 's1' });
      expect(ws.send).not.toHaveBeenCalled();
      expect(connectedEventClientCount()).toBe(0);
    });

    it('skips a CLOSING client', () => {
      const ws = makeWs(CLOSING);
      handleOpen(ws);
      ws.send.mockClear();

      broadcastSessionEvent({ action: 'created', sessionId: 's1' });
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('prunes a client whose send throws mid-broadcast', () => {
      const good = makeWs();
      const bad = makeWs(OPEN, () => {
        throw new Error('socket died');
      });
      handleOpen(good);
      handleOpen(bad);
      good.send.mockClear();
      bad.send.mockClear();

      expect(() => broadcastSessionEvent({ action: 'exited', sessionId: 's1' })).not.toThrow();
      // Good client still received; bad client pruned.
      expect(good.send).toHaveBeenCalledTimes(1);
      expect(connectedEventClientCount()).toBe(1);
    });
  });

  describe('resetConnectedEventClients', () => {
    it('clears all tracked clients', () => {
      handleOpen(makeWs());
      handleOpen(makeWs());
      expect(connectedEventClientCount()).toBe(2);
      resetConnectedEventClients();
      expect(connectedEventClientCount()).toBe(0);
    });
  });

  describe('route registration', () => {
    it('eventsWsRoutes is a usable Elysia plugin that mounts cleanly', () => {
      // The Node test adapter does not support WebSockets (Elysia logs a
      // warning and skips registration), so we can't introspect the compiled
      // WS routes here. Mirror handler.test.ts: assert the plugin is a valid
      // Elysia instance that mounts cleanly. The actual /ws/events lifecycle
      // is covered by the handleOpen/handleClose/broadcast tests above.
      expect(eventsWsRoutes).toBeDefined();
      const app = new Elysia().use(eventsWsRoutes);
      expect(typeof app.handle).toBe('function');
    });
  });
});
