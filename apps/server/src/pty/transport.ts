/**
 * WorkerTransport — abstraction over the IPC channel to the pty-worker.
 *
 * The PTY Manager (Bun side) drives a Node.js worker process via stdio
 * JSON-lines. To make the manager testable in Vitest's Node environment
 * (where `Bun.spawn` does not exist), we hide the spawn details behind
 * this interface:
 *
 *   - `BunWorkerTransport`   — production; uses `Bun.spawn('npx tsx …')`
 *   - `InMemoryWorkerTransport` — tests; accepts messages via `send()`
 *     and exposes `simulateMessage()` for the test to drive responses
 *
 * Both implementations must honour the same lifecycle:
 *   1. `start()` — open the channel (spawn the worker / arm mocks)
 *   2. `send(msg)` — write a `ClientMessage` as a JSON line
 *   3. `onMessage(cb)` — register a listener for `ServerMessage` frames
 *   4. `onExit(cb)` — register a listener for the worker process exit
 *   5. `shutdown()` — gracefully close the channel (best-effort)
 *
 * `onMessage` and `onExit` are single-callback: the manager registers
 * exactly one router and one exit handler, and the transports fan out
 * the underlying events. This keeps the contract simple and avoids
 * listener-leak bugs in tests.
 */

import type { ClientMessage, ServerMessage } from './protocol';

export interface WorkerTransport {
  /** Open the IPC channel. Idempotent. */
  start(): void;
  /** Send a single client message (serialised to a JSON line internally). */
  send(msg: ClientMessage): void;
  /** Register the single message router. Replaces any prior callback. */
  onMessage(cb: (msg: ServerMessage) => void): void;
  /** Register the single exit handler. Replaces any prior callback. */
  onExit(cb: (code: number | null) => void): void;
  /**
   * Tear down the current worker (if any) and spawn a fresh one, preserving
   * the registered `onMessage`/`onExit` callbacks. Used for self-healing when
   * the worker becomes unresponsive (e.g. a dead stdout read loop) — a wedged
   * worker would otherwise make every request time out until manual restart.
   */
  restart(): void;
  /** Best-effort graceful close. Safe to call more than once. */
  shutdown(): Promise<void>;
}
