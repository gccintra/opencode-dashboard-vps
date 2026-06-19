/**
 * pty-worker — Isolated Node.js worker for node-pty PTYs.
 *
 * Why this worker exists:
 *   node-pty 1.1.0 calls `uv_version_string` (a libuv function) during native
 *   addon initialization, which is not yet supported by Bun (1.3.14).
 *   See https://github.com/oven-sh/bun/issues/18546.
 *
 *   To keep the rest of the stack on Bun, we isolate node-pty in a separate
 *   Node.js process. The Bun/Elysia server talks to this worker via the
 *   stdio JSON-lines protocol defined in `./protocol.ts`.
 *
 * IPC transport:
 *   - stdin:  JSON lines (one message per line, terminated by `\n`)
 *   - stdout: JSON lines (same framing)
 *   - stderr: free-form logs (Bun side ignores; useful for debugging)
 *
 * Public surface:
 *   - `handleMessage(msg, deps?)` — pure handler; testable in isolation
 *   - `startIpcLoop(opts)`        — wire the readline interface to handlers
 *   - `writeResponse(msg)`        — the default stdout writer
 *   - `sessions`                  — module-level Map<id, IPty> used in production
 *   - `clearSessions()`           — kills + clears the module-level map
 *
 * The worker is intentionally framework-free: no Express, no WS — just a
 * readline loop driving pure handlers. This keeps the surface area small
 * and the protocol unambiguous.
 */

import * as pty from 'node-pty';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { IPty } from 'node-pty';
import type { ClientMessage, ServerMessage } from './protocol.js';

// ── Module-level state (production) ────────────────────────────────

/** Active PTY sessions, keyed by session id. Production uses this map. */
const sessions = new Map<string, IPty>();

/** Log PATH once at startup so we can verify pty-sighup-exec is reachable. */
process.stderr.write(`[pty-worker] START PATH=${process.env.PATH}\n`);

/**
 * Timestamp of the last kill. New spawns are delayed for COOLDOWN_MS after
 * a kill to prevent a Linux kernel race: close(master_fd) frees the PTY
 * synchronously but queues SIGHUP asynchronously. If the PTY device number
 * is reused before SIGHUP delivery, the new session receives the stale
 * SIGHUP and dies immediately.
 */
// Initialised to -SPAWN_COOLDOWN_MS so that the first spawn is never delayed
// (with fake timers in tests, Date.now() starts at 0, making the cooldown
// incorrectly fire if we initialise to 0).
let gLastKillTime = -500;
const SPAWN_COOLDOWN_MS = 500;

// Keep strong references to recently-killed IPty objects for KILL_HOLD_MS after
// the kill. Without this, V8 GC collects the object quickly → close(master_fd) →
// tty_hangup queued by kernel. If the PTY device number is reallocated to a new
// session before the queued SIGHUP is delivered, the new session dies immediately.
// Holding the reference keeps the master fd open and the device number reserved,
// so the tty_hangup targets no live process when it fires after KILL_HOLD_MS.
const gKilledProcRefs = new Set<IPty>();
const KILL_HOLD_MS = 30_000;

// Hedge settings (defaults; overridable per-call via HandleDeps for tests).
const HEDGE_COUNT_DEFAULT = 1;
const HEDGE_SETTLE_MS_DEFAULT = 1000;

// Circuit breaker: if N consecutive hedge-all-dead events occur (evidence of
// a sustained SIGHUP cascade), pause ALL spawns for CIRCUIT_BREAKER_PAUSE_MS
// so the kernel can drain its SIGHUP queue before we try again.
let gConsecutiveSpawnFailures = 0;
let gCircuitBreakerUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_PAUSE_MS = 8_000;

/** Default response writer: one JSON line + `\n` to stdout. */
export function writeResponse(msg: ServerMessage): void {
  const line = JSON.stringify(msg) + '\n';
  const ok = process.stdout.write(line);
  if (msg.type === 'exit') {
    process.stderr.write(`[pty-worker] WRITE_EXIT id=${msg.id} code=${msg.code} flushed=${ok}\n`);
  }
}

/** Test helper: snapshot the current session ids (production map). */
export function getSessionIds(): string[] {
  return Array.from(sessions.keys());
}

/** Test helper: kill and clear all sessions in the production map. */
export function clearSessions(): void {
  for (const proc of sessions.values()) {
    try {
      proc.kill();
    } catch {
      // best-effort
    }
  }
  sessions.clear();
}

/** Test helper: reset all module-level mutable state to a clean baseline. */
export function resetGlobalState(): void {
  gLastKillTime = -SPAWN_COOLDOWN_MS;
  gConsecutiveSpawnFailures = 0;
  gCircuitBreakerUntil = 0;
  gKilledProcRefs.clear();
}

// ── Handler surface (testable) ─────────────────────────────────────

export type PtySpawnFn = typeof pty.spawn;

export interface HandleDeps {
  /** Override the pty.spawn function. Defaults to the real `pty.spawn`. */
  ptySpawn?: PtySpawnFn;
  /** Override the session map. Defaults to the module-level `sessions`. */
  sessionsMap?: Map<string, IPty>;
  /** Override the response writer. Defaults to `writeResponse` (stdout). */
  write?: (msg: ServerMessage) => void;
  /** Number of parallel hedge PTYs per spawn. Defaults to HEDGE_COUNT_DEFAULT (3). */
  hedgeCount?: number;
  /** How long (ms) to wait before selecting the hedge winner. Defaults to HEDGE_SETTLE_MS_DEFAULT (1000). */
  hedgeSettleMs?: number;
}

/**
 * Process a single decoded client message. Errors are caught and emitted
 * as `{type:'error', id?, message}` so the worker never crashes on bad
 * input from the parent process.
 */
export function handleMessage(msg: ClientMessage, deps: HandleDeps = {}): void {
  const ptySpawn = deps.ptySpawn ?? pty.spawn;
  const map = deps.sessionsMap ?? sessions;
  const write = deps.write ?? writeResponse;

  try {
    switch (msg.type) {
      case 'spawn':
        process.stderr.write(`[pty-worker] MSG_RECV spawn id=${msg.id}\n`);
        handleSpawn(msg, ptySpawn, map, write, 0, {
          count: deps.hedgeCount ?? HEDGE_COUNT_DEFAULT,
          settleMs: deps.hedgeSettleMs ?? HEDGE_SETTLE_MS_DEFAULT,
        });
        break;
      case 'write':
        handleWrite(msg, map, write);
        break;
      case 'resize':
        handleResize(msg, map, write);
        break;
      case 'kill':
        handleKill(msg, map, write);
        break;
      case 'list':
        handleList(map, write);
        break;
      case 'shutdown':
        handleShutdown(map);
        break;
    }
  } catch (err) {
    const id = 'id' in msg ? msg.id : undefined;
    write({ type: 'error', id, message: (err as Error).message });
  }
}

// ── Individual handlers ────────────────────────────────────────────

function handleSpawn(
  msg: Extract<ClientMessage, { type: 'spawn' }>,
  ptySpawn: PtySpawnFn,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
  retryAttempt = 0,
  hedgeOpts: { count: number; settleMs: number } = { count: HEDGE_COUNT_DEFAULT, settleMs: HEDGE_SETTLE_MS_DEFAULT },
): void {
  const HEDGE_COUNT = hedgeOpts.count;
  const HEDGE_SETTLE_MS = hedgeOpts.settleMs;
  const MAX_RETRIES = 3;
  const hedgeIds = Array.from({ length: HEDGE_COUNT }, (_, i) => `${msg.id}__h${i}`);

  // Duplicate guard: reject if the session is already live OR in the hedge window.
  if (map.has(msg.id) || hedgeIds.some((hid) => map.has(hid))) {
    write({ type: 'error', id: msg.id, message: `session already exists: ${msg.id}` });
    return;
  }

  // Circuit breaker: checked on ALL attempts (including retries) so that a
  // session in the retry loop does not keep spawning/dying and generating
  // more kernel SIGHUPs during the pause period.
  const cbRemaining = gCircuitBreakerUntil - Date.now();
  if (cbRemaining > 0) {
    process.stderr.write(`[pty-worker] CIRCUIT_BREAKER id=${msg.id} waiting=${cbRemaining}ms retry=${retryAttempt}\n`);
    setTimeout(() => handleSpawn(msg, ptySpawn, map, write, retryAttempt, hedgeOpts), cbRemaining);
    return;
  }

  // Cooldown: only on the initial attempt — delay if a session was recently killed.
  if (retryAttempt === 0) {
    const remainingCooldown = SPAWN_COOLDOWN_MS - (Date.now() - gLastKillTime);
    if (remainingCooldown > 0) {
      process.stderr.write(`[pty-worker] COOLDOWN id=${msg.id} remaining=${remainingCooldown}ms\n`);
      setTimeout(() => handleSpawn(msg, ptySpawn, map, write, 0, hedgeOpts), remainingCooldown);
      return;
    }
  }

  const env = { ...(process.env as Record<string, string>) };
  if (msg.env) {
    Object.assign(env, msg.env);
  }

  const spawnOpts = {
    name: 'xterm-color' as const,
    cols: msg.cols ?? 80,
    rows: msg.rows ?? 24,
    cwd: msg.cwd,
    env,
  };

  process.stderr.write(`[pty-worker] HEDGE_SPAWN id=${msg.id} count=${HEDGE_COUNT} retry=${retryAttempt} map_size=${map.size}\n`);

  // Per-hedge output relay: buffer all PTY output during the settle window so
  // it is not silently dropped. When the winner is selected, startRelay() drains
  // the buffer and switches future onData calls to the live send function.
  // JS is single-threaded, so setting relayFn + draining is atomic w.r.t. onData.
  const hedgeRelays = new Map<string, {
    startRelay: (fn: (chunk: string) => void) => void;
  }>();

  // Spawn all hedges in parallel.
  let spawnCount = 0;
  for (const hid of hedgeIds) {
    try {
      const proc = ptySpawn(msg.command, msg.args ?? [], spawnOpts);
      map.set(hid, proc);
      spawnCount++;

      const tempBuffer: string[] = [];
      let relayFn: ((chunk: string) => void) | null = null;
      hedgeRelays.set(hid, {
        startRelay: (fn) => {
          relayFn = fn;
          for (const c of tempBuffer) fn(c);
          tempBuffer.length = 0;
        },
      });

      // Buffer output during the settle window; forward immediately once relayFn is set.
      proc.onData((chunk) => {
        if (relayFn) relayFn(chunk);
        else tempBuffer.push(chunk);
      });

      // Cleanup-only onExit per hedge: just remove from map.
      // NEVER call destroy() here — closing the master fd queues a kernel
      // tty_hangup(SIGHUP) that can cascade to the next spawned session.
      // The socket closes naturally via EIO when the slave fd is released.
      proc.onExit(() => {
        if (map.get(hid) === proc) map.delete(hid);
      });
    } catch (err) {
      process.stderr.write(`[pty-worker] HEDGE_FAIL id=${hid}: ${(err as Error).message}\n`);
    }
  }

  if (spawnCount === 0) {
    write({ type: 'error', id: msg.id, message: 'All hedge spawns failed' });
    return;
  }

  // After a short settle period, pick the first hedge that survived.
  setTimeout(() => {
    let winnerProc: IPty | null = null;
    let winnerHid: string | null = null;

    for (const hid of hedgeIds) {
      const p = map.get(hid);
      if (!p) continue;
      // Verify the PTY fd is still valid. A process can die between the
      // hedge-spawn and the settle timeout while its onExit cleanup is still
      // queued in the event loop (JS event queue ordering). If the fd is already
      // closed (EBADF/EIO), this hedge is dead — skip it and try the next one.
      try {
        p.resize(msg.cols ?? 80, msg.rows ?? 24);
        winnerProc = p;
        winnerHid = hid;
        break;
      } catch {
        process.stderr.write(`[pty-worker] HEDGE_DEAD_FD id=${hid} skipping\n`);
        map.delete(hid);
      }
    }

    if (!winnerProc || !winnerHid) {
      // All hedges died — count this event toward the circuit breaker.
      gConsecutiveSpawnFailures++;
      if (gConsecutiveSpawnFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        gCircuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
        process.stderr.write(`[pty-worker] CIRCUIT_BREAKER tripped consec=${gConsecutiveSpawnFailures} pause=${CIRCUIT_BREAKER_PAUSE_MS}ms\n`);
        gConsecutiveSpawnFailures = 0;
      }
      // Retry with exponential backoff.
      if (retryAttempt < MAX_RETRIES) {
        const delay = 500 * Math.pow(2, retryAttempt);
        process.stderr.write(`[pty-worker] HEDGE_ALL_DEAD id=${msg.id} retrying in ${delay}ms attempt=${retryAttempt + 1}/${MAX_RETRIES}\n`);
        setTimeout(() => handleSpawn(msg, ptySpawn, map, write, retryAttempt + 1, hedgeOpts), delay);
        return;
      }
      process.stderr.write(`[pty-worker] HEDGE_GAVE_UP id=${msg.id}\n`);
      write({ type: 'error', id: msg.id, message: 'All spawn attempts failed after retries' });
      return;
    }

    // Winner survived — cascade is not active, reset failure counter.
    gConsecutiveSpawnFailures = 0;

    // Promote winner: move from hedge ID to the real session ID.
    map.delete(winnerHid);
    map.set(msg.id, winnerProc);

    // Kill the losing hedges.
    // CRITICAL: kill the ENTIRE process group (-pid), not just the bash leader.
    // bash -c 'claude; ...' forks claude as a subprocess. lp.kill() only sends
    // SIGKILL to bash's PID; claude is orphaned and keeps the slave PTY fd
    // open indefinitely, which delays the tty_hangup and leaks PTY devices.
    // process.kill(-pid) sends to the pgrp (bash + claude + any subprocs).
    // NEVER call destroy() — closing the master fd queues tty_hangup(SIGHUP).
    for (const hid of hedgeIds) {
      if (hid !== winnerHid && map.has(hid)) {
        const lp = map.get(hid)!;
        try { process.kill(-lp.pid, 'SIGKILL'); } catch { /* pgrp may already be dead */ }
        try { lp.kill('SIGKILL'); } catch { /* fallback: at least kill the pid */ }
        map.delete(hid);
      }
    }

    // Wire the winner's output: drain buffered output from the settle window,
    // then relay all subsequent output live. hedgeRelays entry for losers is
    // simply abandoned (their buffers GC'd since the procs are killed above).
    const sendChunk = (chunk: string) => write({
      type: 'data',
      id: msg.id,
      chunk: Buffer.from(chunk, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    hedgeRelays.get(winnerHid)?.startRelay(sendChunk);
    hedgeRelays.clear();

    const winnerPromotedAt = Date.now();
    winnerProc.onExit(({ exitCode, signal: exitSignal }) => {
      if (map.get(msg.id) === winnerProc) {
        map.delete(msg.id);
      }
      // Delay destroy() by 5s for clean exits (exitSignal == null). Immediate
      // destroy() closes the master fd → tty_hangup(SIGHUP) queued → if the
      // PTY device number is reallocated within 5s, the new session gets SIGHUP.
      // 5s gives the kernel time to drain the SIGHUP queue before the next spawn.
      // Signal deaths: DO NOT call destroy() — the kernel already delivered the
      // lethal signal; closing master_fd would queue a SECOND SIGHUP.
      if (exitSignal == null) {
        setTimeout(() => {
          try { (winnerProc as unknown as { destroy(): void }).destroy(); } catch { /* best-effort */ }
        }, 5_000);
      }
      const aliveMs = Date.now() - winnerPromotedAt;
      const code = exitCode ?? (exitSignal ? 128 + (typeof exitSignal === 'number' ? exitSignal : 0) : 0);
      process.stderr.write(`[pty-worker] EXIT id=${msg.id} code=${exitCode} signal=${exitSignal} mapSize=${map.size} aliveAfterWinner=${aliveMs}ms\n`);
      write({ type: 'exit', id: msg.id, code });
    });

    process.stderr.write(`[pty-worker] HEDGE_WINNER id=${msg.id} winner=${winnerHid} pid=${winnerProc.pid} sessions=${map.size}\n`);
    write({ type: 'spawned', id: msg.id, pid: winnerProc.pid });
  }, HEDGE_SETTLE_MS);
}

function handleWrite(
  msg: Extract<ClientMessage, { type: 'write' }>,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
): void {
  const proc = map.get(msg.id);
  if (!proc) {
    write({ type: 'error', id: msg.id, message: `session not found: ${msg.id}` });
    return;
  }
  proc.write(msg.data);
}

function handleResize(
  msg: Extract<ClientMessage, { type: 'resize' }>,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
): void {
  const proc = map.get(msg.id);
  if (!proc) {
    write({ type: 'error', id: msg.id, message: `session not found: ${msg.id}` });
    return;
  }
  try {
    console.error(`[pty-worker] handleResize: ${msg.id} -> ${msg.cols}x${msg.rows}`);
    proc.resize(msg.cols, msg.rows);
  } catch (err) {
    const message = (err as Error).message;
    write({ type: 'error', id: msg.id, message: `resize failed: ${message}` });
    // PTY fd is dead (EBADF/EIO) — process exited without triggering onExit
    // due to a node-pty race on rapid concurrent spawns. Emit a synthetic exit
    // so the manager can mark the session dead and stop forwarding resizes.
    if (message.includes('EBADF') || message.includes('EIO')) {
      if (map.get(msg.id) === proc) map.delete(msg.id);
      // PTY fd is dead — process may have exited without triggering onExit.
      // Use proc.kill() (NOT process.kill(-pid)) to target the specific PID.
      try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
      write({ type: 'exit', id: msg.id, code: -1 });
    }
  }
}

function handleKill(
  msg: Extract<ClientMessage, { type: 'kill' }>,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
): void {
  const proc = map.get(msg.id);
  // Kill is idempotent — if the session is already gone, still acknowledge.
  if (proc) {
    process.stderr.write(`[pty-worker] KILL_START id=${msg.id} pid=${proc.pid} map_size_before=${map.size}\n`);
    gLastKillTime = Date.now();
    // Kill the entire process group so claude subprocesses (which share the
    // slave PTY fd) are also killed immediately. Without -pid, claude is
    // orphaned and holds the slave fd open, preventing PTY device release.
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* pgrp may already be gone */ }
    try { proc.kill('SIGKILL'); } catch (err) {
      process.stderr.write(`[pty-worker] KILL_FAILED id=${msg.id} pid=${proc.pid}: ${(err as Error).message}\n`);
    }
    process.stderr.write(`[pty-worker] KILL_SENT id=${msg.id} pid=${proc.pid}\n`);
    map.delete(msg.id);
    process.stderr.write(`[pty-worker] KILL_MAP_DELETED id=${msg.id} map_size_after=${map.size}\n`);
    // Hold a strong reference for KILL_HOLD_MS to delay GC of the native IPty
    // object. Premature GC closes the master PTY fd → tty_hangup → SIGHUP cascade
    // kills the next session that reuses that PTY device number.
    gKilledProcRefs.add(proc);
    setTimeout(() => { gKilledProcRefs.delete(proc); }, KILL_HOLD_MS);
  }
  write({ type: 'killed', id: msg.id });
}

function handleList(map: Map<string, IPty>, write: (m: ServerMessage) => void): void {
  write({ type: 'list', sessions: Array.from(map.keys()) });
}

function handleShutdown(map: Map<string, IPty>): void {
  for (const proc of map.values()) {
    // Kill the entire process group (bash + claude subprocesses).
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* best-effort */ }
    try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
    // Do NOT call destroy() — closing master fds queues tty_hangup(SIGHUP) for
    // every session. When this Node process exits, the kernel closes all fds
    // anyway, generating tty_hangup at that point. pty-sighup-exec protects new
    // sessions started after restart, so the timing doesn't matter for safety.
  }
  map.clear();
  // Synchronous exit so the parent process observes a clean shutdown.
  process.exit(0);
}

// ── IPC loop (production entry point) ──────────────────────────────

/**
 * Wire a readline interface to `handleMessage`. The loop is line-delimited
 * JSON: each emitted line is parsed, validated, and dispatched. Malformed
 * input is reported as an error and the loop continues.
 *
 * This function is exported for end-to-end testing — the test creates a
 * fake readline interface from a Readable stream and verifies the full
 * stdin → handler → stdout path.
 */
export function startIpcLoop(opts: {
  readline: ReadlineInterface;
  write?: (msg: ServerMessage) => void;
  handleDeps?: HandleDeps;
}): void {
  const write = opts.write ?? writeResponse;
  opts.readline.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      write({ type: 'error', message: `invalid JSON: ${(err as Error).message}` });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      write({ type: 'error', message: 'missing or invalid "type" field' });
      return;
    }

    const msg = parsed as ClientMessage;
    handleMessage(msg, { ...opts.handleDeps, write });
  });

  // Exit when stdin closes (Bun server restarted or pipe broken) so the worker
  // doesn't spin in a tight read-EAGAIN loop consuming 100% CPU.
  opts.readline.on('close', () => {
    process.stderr.write('[pty-worker] stdin closed, exiting\n');
    process.exit(0);
  });
}

// ── Entry point ────────────────────────────────────────────────────

const ENTRY = process.argv[1];
if (ENTRY && import.meta.url === `file://${ENTRY}`) {
  // Prevent stdout EPIPE from crashing the worker when Bun closes its end of
  // the pipe (e.g. during server restart). Without this listener, Node throws
  // an uncaught EPIPE that terminates the process, killing all active sessions.
  process.stdout.on('error', (err) => {
    process.stderr.write(`[pty-worker] stdout error: ${(err as Error).message}\n`);
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
      process.stderr.write('[pty-worker] stdout pipe broken, exiting\n');
      process.exit(1);
    }
  });

  // Safety net: catch any node-pty socket errors that escape the try/catch in
  // proc.kill(). These are non-fatal write-after-close errors that should not
  // crash the worker and kill all running sessions.
  process.on('uncaughtException', (err: Error) => {
    const msg = err.message ?? '';
    const code = (err as NodeJS.ErrnoException).code ?? '';
    process.stderr.write(`[pty-worker] uncaughtException code=${code} msg=${msg}\n`);
    if (
      msg.includes('This socket has been ended by the other party') ||
      msg.includes('write after end') ||
      code === 'EPIPE'
    ) {
      process.stderr.write(`[pty-worker] suppressed non-fatal write error\n`);
      return;
    }
    process.stderr.write(`[pty-worker] FATAL: ${err.stack ?? msg}\n`);
    process.exit(1);
  });

  // terminal: false prevents readline from piping stdin→stdout for echo,
  // which would cause writeAfterFIN if stdout closes before stdin.
  const rl = createInterface({ input: process.stdin, terminal: false });
  startIpcLoop({ readline: rl });
}
