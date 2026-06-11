/**
 * PtyManager — server-side coordinator for PTY sessions.
 *
 * Maintains a `Map<sessionId, SessionState>` for active sessions, drives
 * the `WorkerTransport` to send/receive JSON-lines, and exposes a
 * promise-based public API (`spawnSession`, `writeToSession`,
 * `resizeSession`, `killSession`, `listSessions`, etc.) to the rest of
 * the Elysia server.
 *
 * ─── Request correlation ────────────────────────────────────────────
 * The IPC protocol multiplexes concurrent sessions by the `id` field
 * (the session id). `spawn` and `kill` are awaitable, correlated by the
 * same session id in the `spawned` / `killed` response. `list` has no
 * `id` and is single-flight (one pending request at a time). `write`
 * and `resize` are fire-and-forget.
 *
 * ─── Buffering ──────────────────────────────────────────────────────
 * Each session keeps a circular buffer of the most recent ~10KB of
 * output. The buffer is bounded by `BUFFER_MAX` (configurable via the
 * constructor) and is used for reconnection — when a client reconnects
 * to a session, the server sends the buffer so xterm.js can paint the
 * last visible state.
 *
 * ─── Multi-session ──────────────────────────────────────────────────
 * Multiple PTYs can be active simultaneously and are fully isolated:
 * killing one session never affects another. Each session is an
 * independent node-pty process inside the worker.
 *
 * ─── Failure handling ───────────────────────────────────────────────
 *  - Per-request timeout (default 5s) rejects long-pending operations.
 *  - Worker exit (`onExit`) rejects all pending requests and marks
 *    every active session as exited, firing the exit callbacks.
 *  - Worker errors are mapped back to the originating session (e.g.
 *    `spawn` error rejects the spawn promise).
 */

import type {
  ServerMessage,
  SpawnedResponse,
  KilledResponse,
  ListResponse,
  DataResponse,
  ExitResponse,
  ErrorResponse,
} from '../../../pty-worker/src/protocol';
import type { WorkerTransport } from './transport';
import { InMemoryWorkerTransport } from './transport.memory';
import { BunWorkerTransport } from './transport.bun';
import { detectStatus } from './detector';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_BUFFER_MAX = 10_240; // 10 KB

export type SessionStatus = 'pending' | 'active' | 'exited' | 'killed';

export interface SessionState {
  id: string;
  cwd: string;
  command: string;
  args: string[];
  pid?: number;
  buffer: string;
  status: SessionStatus;
  createdAt: number;
  /** Timestamp of the last data chunk received from the PTY. */
  dataAt?: number;
  dataCallbacks: Set<(chunk: string) => void>;
  exitCallbacks: Set<(code: number) => void>;
  statusCallbacks: Set<(status: string) => void>;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export interface PtyManagerOptions {
  /** Transport implementation. Defaults to the in-memory one (test-safe). */
  transport?: WorkerTransport;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Per-session buffer cap in bytes. Default 10240 (10 KB). */
  bufferMax?: number;
}

export class PtyManager {
  private readonly transport: WorkerTransport;
  private readonly timeoutMs: number;
  private readonly bufferMax: number;
  private started = false;

  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingSpawns = new Map<string, PendingRequest<number>>();
  private readonly pendingKills = new Map<string, PendingRequest<void>>();
  private pendingList: PendingRequest<string[]> | null = null;
  private statusMonitorInterval: ReturnType<typeof setInterval> | null = null;
  /** Map sessionId → last detected status to detect transitions. */
  private readonly lastDetectedStatus = new Map<string, string>();

  constructor(opts: PtyManagerOptions = {}) {
    this.transport = opts.transport ?? new InMemoryWorkerTransport();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.bufferMax = opts.bufferMax ?? DEFAULT_BUFFER_MAX;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Start the transport and register the message router. Subsequent
   * operations (spawnSession, listSessions) also call this implicitly
   * for convenience, but explicit calls let callers await transport
   * readiness before kicking off concurrent work.
   */
  start(): void {
    if (this.started) return;
    this.transport.onMessage((msg) => this.handleServerMessage(msg));
    this.transport.onExit((code) => this.handleWorkerExit(code));
    this.transport.start();
    this.started = true;
  }

  /**
   * Send `{type:'shutdown'}` to the worker, wait for it to exit, and
   * reject every pending request. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopStatusMonitor();
    try {
      this.transport.send({ type: 'shutdown' });
    } catch (err) {
      console.error('[pty-manager] failed to send shutdown:', err);
    }
    await this.transport.shutdown();
    this.rejectAllPending(new Error('manager shut down'));
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Spawn a new PTY session.
   *
   * Validation (unknown-session, duplicate-id) throws SYNCHRONOUSLY so
   * callers can detect setup-time errors without awaiting. Once the
   * request is in flight, the returned promise resolves with the pid
   * (on `{type:'spawned'}`) or rejects on error / timeout.
   *
   * @param id      session id (unique within this manager)
   * @param cwd     working directory for the spawned command
   * @param command binary to run (default: 'bash')
   * @param args    command arguments
   * @param env     additional environment variables (merged with process.env)
   * @param cols    initial terminal columns (default: 120)
   * @param rows    initial terminal rows (default: 35)
   * @returns the new PTY's pid
   */
  spawnSession(
    id: string,
    cwd: string,
    command = 'bash',
    args: string[] = [],
    env?: Record<string, string>,
    cols = 120,
    rows = 35,
  ): Promise<number> {
    this.ensureStarted();
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      // Allow re-spawning a session that has already terminated. The old entry is
      // cleared so the new spawn starts fresh (buffer kept for reconnecting clients).
      if (existing.status === 'exited' || existing.status === 'killed') {
        this.sessions.delete(id);
      } else {
        throw new Error(`session already exists: ${id}`);
      }
    }

    const session: SessionState = {
      id,
      cwd,
      command,
      args,
      buffer: '',
      status: 'pending',
      createdAt: Date.now(),
      dataCallbacks: new Set(),
      exitCallbacks: new Set(),
      statusCallbacks: new Set(),
    };
    this.sessions.set(id, session);

    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingSpawns.get(id)?.timer === timer) {
          this.pendingSpawns.delete(id);
          this.sessions.delete(id);
          reject(new Error(`spawn timeout after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);
      this.pendingSpawns.set(id, { resolve, reject, timer, method: 'spawn' });
      this.transport.send({ type: 'spawn', id, cwd, command, args, env, cols, rows });
    });
  }

  /** Fire-and-forget write of `data` to the session's PTY stdin. */
  writeToSession(id: string, data: string): void {
    const session = this.ensureSession(id);
    // PTY process is gone — silently drop to avoid spurious worker errors.
    if (session.status === 'exited' || session.status === 'killed') return;
    this.transport.send({ type: 'write', id, data });
  }

  /** Fire-and-forget resize of the session's PTY. */
  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.ensureSession(id);
    // PTY process is gone — silently drop to avoid spurious worker errors.
    if (session.status === 'exited' || session.status === 'killed') return;
    console.error(`[pty-manager] resizeSession: ${id} -> ${cols}x${rows}`);
    this.transport.send({ type: 'resize', id, cols, rows });
  }

  /**
   * Kill the session's PTY and wait for the worker to acknowledge.
   *
   * Unknown-session throws synchronously (matches write/resize). On the
   * happy path, resolves when the worker emits `{type:'killed'}`.
   */
  killSession(id: string): Promise<void> {
    this.ensureStarted();
    this.ensureSession(id);

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingKills.get(id)?.timer === timer) {
          this.pendingKills.delete(id);
          reject(new Error(`kill timeout after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);
      this.pendingKills.set(id, { resolve, reject, timer, method: 'kill' });
      this.transport.send({ type: 'kill', id });
    });
  }

  /**
   * List active session ids as reported by the worker.
   * Single-flight: only one list request may be in flight at a time.
   */
  listSessions(): Promise<string[]> {
    this.ensureStarted();

    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingList?.timer === timer) {
          this.pendingList = null;
          reject(new Error(`list timeout after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);
      this.pendingList = { resolve, reject, timer, method: 'list' };
      this.transport.send({ type: 'list' });
    });
  }

  /** Register a callback for data chunks. Multiple subscribers allowed. */
  onSessionData(id: string, cb: (chunk: string) => void): void {
    this.ensureSession(id);
    this.sessions.get(id)!.dataCallbacks.add(cb);
  }

  /** Unregister a data callback — symmetric with {@link onSessionData}. */
  removeSessionData(id: string, cb: (chunk: string) => void): void {
    const session = this.sessions.get(id);
    if (session) session.dataCallbacks.delete(cb);
  }

  /** Register a callback for session exit. Multiple subscribers allowed. */
  onSessionExit(id: string, cb: (code: number) => void): void {
    this.ensureSession(id);
    this.sessions.get(id)!.exitCallbacks.add(cb);
  }

  /** Unregister an exit callback — symmetric with {@link onSessionExit}. */
  removeSessionExit(id: string, cb: (code: number) => void): void {
    const session = this.sessions.get(id);
    if (session) session.exitCallbacks.delete(cb);
  }

  /** Register a callback for detected status changes. Multiple subscribers allowed. */
  onSessionStatus(id: string, cb: (status: string) => void): void {
    this.ensureSession(id);
    this.sessions.get(id)!.statusCallbacks.add(cb);
  }

  /** Unregister a status callback — symmetric with {@link onSessionStatus}. */
  removeSessionStatus(id: string, cb: (status: string) => void): void {
    const session = this.sessions.get(id);
    if (session) session.statusCallbacks?.delete(cb);
  }

  /**
   * Return the accumulated output buffer for the session. Used to
   * restore xterm.js state on reconnection.
   */
  getSessionBuffer(id: string): string {
    this.ensureSession(id);
    return this.sessions.get(id)!.buffer;
  }

  /**
   * Return the session's current status, or null if the session
   * is unknown to this manager.
   */
  getSessionStatus(id: string): SessionStatus | null {
    const s = this.sessions.get(id);
    return s ? s.status : null;
  }

  /**
   * Start a periodic status monitor that polls every session and fires
   * status-change callbacks when the {@link detectStatus} result changes.
   *
   * Idempotent — calling this multiple times is safe (second call is a no-op).
   * The monitor stops automatically when {@link shutdown} is called.
   *
   * @param intervalMs  Polling interval in milliseconds. Defaults to 1000.
   */
  startStatusMonitor(intervalMs = 1000): void {
    if (this.statusMonitorInterval !== null) return;

    this.statusMonitorInterval = setInterval(() => {
      for (const session of this.sessions.values()) {
        const detected = detectStatus(session);
        const previous = this.lastDetectedStatus.get(session.id);
        if (previous !== detected) {
          this.lastDetectedStatus.set(session.id, detected);
          for (const cb of session.statusCallbacks) {
            try {
              cb(detected);
            } catch (err) {
              console.error(`[pty-manager] status callback error for ${session.id}:`, err);
            }
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stop the status monitor. Safe to call even if the monitor wasn't started.
   * Called automatically by {@link shutdown}.
   */
  private stopStatusMonitor(): void {
    if (this.statusMonitorInterval !== null) {
      clearInterval(this.statusMonitorInterval);
      this.statusMonitorInterval = null;
    }
  }

  // ── Server message routing ───────────────────────────────────────

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'spawned':
        this.onSpawned(msg);
        break;
      case 'killed':
        this.onKilled(msg);
        break;
      case 'list':
        this.onList(msg);
        break;
      case 'data':
        this.onData(msg);
        break;
      case 'exit':
        console.error(`[pty-manager] MSG_RECV exit id=${msg.id} code=${msg.code}`);
        this.onExit(msg);
        break;
      case 'error':
        this.onError(msg);
        break;
    }
  }

  private onSpawned(msg: SpawnedResponse): void {
    const pending = this.pendingSpawns.get(msg.id);
    if (!pending) {
      // Stale response — possibly arrived after a timeout.
      return;
    }
    clearTimeout(pending.timer);
    this.pendingSpawns.delete(msg.id);
    const session = this.sessions.get(msg.id);
    if (session) {
      session.pid = msg.pid;
      session.status = 'active';
    }
    pending.resolve(msg.pid);
  }

  private onKilled(msg: KilledResponse): void {
    const pending = this.pendingKills.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingKills.delete(msg.id);
    }
    const session = this.sessions.get(msg.id);
    if (session) {
      session.status = 'killed';
    }
    if (pending) pending.resolve();
  }

  private onList(msg: ListResponse): void {
    if (!this.pendingList) return;
    const p = this.pendingList;
    this.pendingList = null;
    clearTimeout(p.timer);
    p.resolve(msg.sessions);
  }

  private onData(msg: DataResponse): void {
    const session = this.sessions.get(msg.id);
    if (!session) return; // data for unknown/expired session — drop
    session.dataAt = Date.now();

    // Decode base64 back to binary (latin1) string so byte values
    // 0-255 are preserved without UTF-8 corruption through the IPC layer.
    const chunk = msg.encoding === 'base64'
      ? Buffer.from(msg.chunk, 'base64').toString('binary')
      : msg.chunk;

    this.appendToBuffer(session, chunk);
    for (const cb of session.dataCallbacks) {
      try {
        cb(chunk);
      } catch (err) {
        console.error(`[pty-manager] data callback error for ${msg.id}:`, err);
      }
    }
  }

  private onExit(msg: ExitResponse): void {
    // If the process exits before 'spawned' arrives (setImmediate race in worker),
    // reject the pending spawn promise immediately instead of waiting for timeout.
    const pendingSpawn = this.pendingSpawns.get(msg.id);
    if (pendingSpawn) {
      clearTimeout(pendingSpawn.timer);
      this.pendingSpawns.delete(msg.id);
      this.sessions.delete(msg.id);
      pendingSpawn.reject(new Error(`process exited before spawn completed (code=${msg.code})`));
      return;
    }

    const session = this.sessions.get(msg.id);
    if (!session) return;
    session.status = 'exited';
    for (const cb of session.exitCallbacks) {
      try {
        cb(msg.code);
      } catch (err) {
        console.error(`[pty-manager] exit callback error for ${msg.id}:`, err);
      }
    }
    // Note: we intentionally do NOT delete the session on exit. The
    // buffer must survive so reconnections can replay the last output.
  }

  private onError(msg: ErrorResponse): void {
    if (msg.id) {
      const sp = this.pendingSpawns.get(msg.id);
      if (sp) {
        clearTimeout(sp.timer);
        this.pendingSpawns.delete(msg.id);
        this.sessions.delete(msg.id);
        sp.reject(new Error(msg.message));
        return;
      }
      const kp = this.pendingKills.get(msg.id);
      if (kp) {
        clearTimeout(kp.timer);
        this.pendingKills.delete(msg.id);
        kp.reject(new Error(msg.message));
        return;
      }
      // Not a tracked request — could be a write/resize on a dead session.
      console.error(`[pty-manager] worker error for ${msg.id}: ${msg.message}`);
      // Dead PTY fd (EBADF/EIO): node-pty's onExit missed the exit event.
      // Mark locally so future resize/write calls are dropped by the guard.
      if (msg.message.includes('EBADF') || msg.message.includes('EIO')) {
        const session = this.sessions.get(msg.id);
        if (session && session.status !== 'exited' && session.status !== 'killed') {
          session.status = 'exited';
          for (const cb of session.exitCallbacks) {
            try { cb(-1); } catch { /* best-effort */ }
          }
        }
      }
      return;
    }
    if (this.pendingList) {
      const p = this.pendingList;
      this.pendingList = null;
      clearTimeout(p.timer);
      p.reject(new Error(msg.message));
      return;
    }
    console.error(`[pty-manager] worker error: ${msg.message}`);
  }

  private handleWorkerExit(code: number | null): void {
    console.error(`[pty-manager] worker exited unexpectedly (code=${code})`);
    this.started = false;
    const err = new Error(`worker exited unexpectedly (code=${code})`);
    this.rejectAllPending(err);
    // Mark every active session as exited and notify subscribers with
    // sentinel code -1 so they know it wasn't a clean exit.
    for (const session of this.sessions.values()) {
      if (session.status === 'active' || session.status === 'pending') {
        session.status = 'exited';
        for (const cb of session.exitCallbacks) {
          try {
            cb(-1);
          } catch {
            // best-effort
          }
        }
      }
    }
  }

  // ── Internals ────────────────────────────────────────────────────

  private ensureStarted(): void {
    if (!this.started) this.start();
  }

  private ensureSession(id: string): SessionState {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`session not found: ${id}`);
    return session;
  }

  private appendToBuffer(session: SessionState, chunk: string): void {
    session.buffer += chunk;
    if (session.buffer.length > this.bufferMax) {
      session.buffer = this.trimBufferSafe(session.buffer, this.bufferMax);
    }
  }

  /**
   * Trim a buffer to at most maxLen chars, ensuring we never cut in the
   * middle of an ANSI escape sequence.
   *
   * A partial escape (e.g. `[27;93H` without the leading `\x1b`) would
   * leak as raw text into the terminal on reconnection. We scan backwards
   * from the natural cutoff looking for incomplete escape sequences and
   * re-align the trim point to just before the `\x1b` that starts them.
   */
  private trimBufferSafe(buffer: string, maxLen: number): string {
    if (buffer.length <= maxLen) return buffer;
    const cutoff = buffer.length - maxLen;
    // Scan up to 200 chars before the cutoff for an \x1b — ANSI escape
    // sequences are typically 2-20 chars, so 200 is a generous window.
    const scanStart = Math.max(0, cutoff - 200);
    const windowBefore = buffer.slice(scanStart, cutoff);
    const lastEsc = windowBefore.lastIndexOf('\x1b');
    if (lastEsc === -1) {
      return buffer.slice(cutoff);
    }
    // Check whether a terminator (letter a-z/A-Z) appears between the
    // discovered \x1b and the cutoff. If yes, the escape is fully
    // contained in the discarded region — safe to cut at the natural
    // boundary. If not, the escape spans past the cutoff — re-align to
    // the \x1b position so the entire sequence stays in the buffer.
    const afterEsc = windowBefore.slice(lastEsc);
    if (/[a-zA-Z]/.test(afterEsc)) {
      return buffer.slice(cutoff);
    }
    return buffer.slice(scanStart + lastEsc);
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pendingSpawns.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pendingSpawns.clear();
    for (const p of this.pendingKills.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pendingKills.clear();
    if (this.pendingList) {
      clearTimeout(this.pendingList.timer);
      this.pendingList.reject(err);
      this.pendingList = null;
    }
  }
}

// ── Default singleton ──────────────────────────────────────────────

let _singleton: PtyManager | null = null;

/**
 * Get the process-wide PTY manager. Uses the Bun transport — only call
 * this from the running Elysia server (Bun runtime). Tests should
 * construct their own `PtyManager(new InMemoryWorkerTransport())` and
 * never call this function, so the Bun transport is never instantiated
 * in Node-only test environments.
 */
export function getPtyManager(): PtyManager {
  if (!_singleton) {
    _singleton = new PtyManager({ transport: new BunWorkerTransport() });
  }
  return _singleton;
}

/** Test/utility helper: reset the module-level singleton. */
export function resetPtyManager(): void {
  _singleton = null;
}
