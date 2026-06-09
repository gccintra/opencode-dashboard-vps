/**
 * In-memory WorkerTransport for tests.
 *
 * Accepts outgoing `ClientMessage` instances via `send()` and records them
 * on `sentMessages` for assertion. The test drives the worker side by
 * calling `simulateMessage()` / `simulateExit()` to fire `onMessage` /
 * `onExit` callbacks.
 *
 * This is the test-side counterpart of `BunWorkerTransport`. Keeping the
 * two in the same file (vs. a separate `transport.memory.ts`) makes the
 * contract obvious at a glance, but each implementation is independent
 * at runtime — neither imports the other.
 */

import type { WorkerTransport } from './transport';
import type { ClientMessage, ServerMessage } from '../../../pty-worker/src/protocol';

export class InMemoryWorkerTransport implements WorkerTransport {
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private exitCb: ((code: number | null) => void) | null = null;
  private started = false;
  private shutdownCount = 0;

  /** Outgoing messages in send order. Tests assert against this list. */
  public readonly sentMessages: ClientMessage[] = [];

  start(): void {
    this.started = true;
  }

  send(msg: ClientMessage): void {
    if (!this.started) {
      throw new Error('[InMemoryWorkerTransport] start() must be called before send()');
    }
    this.sentMessages.push(msg);
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCb = cb;
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1;
    this.started = false;
  }

  // ── Test helpers ────────────────────────────────────────────────

  /** Fire a server message through the registered `onMessage` callback. */
  simulateMessage(msg: ServerMessage): void {
    if (this.messageCb) this.messageCb(msg);
  }

  /** Fire the worker exit event through the registered `onExit` callback. */
  simulateExit(code: number | null): void {
    if (this.exitCb) this.exitCb(code);
  }

  /** Inspect how many times shutdown() was called. */
  get shutdownCalls(): number {
    return this.shutdownCount;
  }

  /** Has start() been called? */
  get isStarted(): boolean {
    return this.started;
  }
}
