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
 *
 * ─── SIGHUP race — solved at the source ─────────────────────────────
 * Linux PTYs have a kernel race: close(master_fd) frees the /dev/pts/N
 * device synchronously but queues a SIGHUP (tty_hangup) asynchronously. If
 * the device number is reused by a new session before the SIGHUP drains,
 * the new session's process group receives the stale SIGHUP and dies.
 *
 * This used to require a large pile of mitigations here (parallel "hedge"
 * spawns, post-kill cooldown, a circuit breaker, holding killed IPty refs,
 * deferred destroy(), server-side auto-respawn). All of that is now GONE.
 *
 * The race is eliminated at the source by spawning every session through
 * `pty-sighup-exec` (apps/pty-worker/src/pty-sighup-exec.c, installed at
 * /usr/local/bin/pty-sighup-exec). That wrapper sets SIGHUP to SIG_IGN via
 * sigaction() BEFORE exec-ing bash, and SIG_IGN is inherited across every
 * fork/exec descendant (POSIX). So a stale SIGHUP hitting a reused device
 * is simply ignored — there is no window to lose. With the root cause gone,
 * spawn and kill are plain, direct operations again. See sessions.ts.
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
  clearSessions();
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
        handleSpawn(msg, ptySpawn, map, write);
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

/**
 * Spawn a single PTY for the session and stream its output.
 *
 * Direct and race-free: every session is launched via `pty-sighup-exec`
 * (see sessions.ts), which makes SIGHUP harmless, so there is no need for
 * hedging, cooldowns, retries, or deferred fd cleanup. node-pty closes the
 * master fd automatically when the process exits.
 */
function handleSpawn(
  msg: Extract<ClientMessage, { type: 'spawn' }>,
  ptySpawn: PtySpawnFn,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
): void {
  // Duplicate guard: reject if a live session already owns this id.
  if (map.has(msg.id)) {
    write({ type: 'error', id: msg.id, message: `session already exists: ${msg.id}` });
    return;
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

  let proc: IPty;
  try {
    proc = ptySpawn(msg.command, msg.args ?? [], spawnOpts);
  } catch (err) {
    process.stderr.write(`[pty-worker] SPAWN_FAIL id=${msg.id}: ${(err as Error).message}\n`);
    write({ type: 'error', id: msg.id, message: `spawn failed: ${(err as Error).message}` });
    return;
  }

  map.set(msg.id, proc);

  // Stream PTY output. base64-encode so byte values 0-255 survive the
  // JSON-lines transport without UTF-8 corruption.
  proc.onData((chunk) => {
    write({
      type: 'data',
      id: msg.id,
      chunk: Buffer.from(chunk, 'utf8').toString('base64'),
      encoding: 'base64',
    });
  });

  const spawnedAt = Date.now();
  proc.onExit(({ exitCode, signal: exitSignal }) => {
    if (map.get(msg.id) === proc) map.delete(msg.id);
    const aliveMs = Date.now() - spawnedAt;
    const code =
      exitCode ?? (exitSignal ? 128 + (typeof exitSignal === 'number' ? exitSignal : 0) : 0);
    process.stderr.write(
      `[pty-worker] EXIT id=${msg.id} code=${exitCode} signal=${exitSignal} mapSize=${map.size} aliveMs=${aliveMs}\n`,
    );
    write({ type: 'exit', id: msg.id, code });
  });

  process.stderr.write(`[pty-worker] SPAWNED id=${msg.id} pid=${proc.pid} sessions=${map.size}\n`);
  write({ type: 'spawned', id: msg.id, pid: proc.pid });
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
    proc.resize(msg.cols, msg.rows);
  } catch (err) {
    const message = (err as Error).message;
    write({ type: 'error', id: msg.id, message: `resize failed: ${message}` });
    // PTY fd is dead (EBADF/EIO) — the process exited without triggering onExit.
    // Emit a synthetic exit so the manager marks the session dead and stops
    // forwarding resizes.
    if (message.includes('EBADF') || message.includes('EIO')) {
      if (map.get(msg.id) === proc) map.delete(msg.id);
      try {
        proc.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
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
    process.stderr.write(
      `[pty-worker] KILL id=${msg.id} pid=${proc.pid} map_size_before=${map.size}\n`,
    );
    // Kill the entire process group so claude/opencode subprocesses (which
    // share the slave PTY fd) die too. Without -pid, the child is orphaned and
    // holds the slave fd open, preventing PTY device release.
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* pgrp may already be gone */
    }
    try {
      proc.kill('SIGKILL');
    } catch (err) {
      process.stderr.write(
        `[pty-worker] KILL_FAILED id=${msg.id} pid=${proc.pid}: ${(err as Error).message}\n`,
      );
    }
    map.delete(msg.id);
    // No destroy()/ref-holding dance: pty-sighup-exec makes the kernel SIGHUP
    // queued by the closing master fd harmless, and node-pty closes the master
    // fd itself once the process dies.
  }
  write({ type: 'killed', id: msg.id });
}

function handleList(map: Map<string, IPty>, write: (m: ServerMessage) => void): void {
  write({ type: 'list', sessions: Array.from(map.keys()) });
}

function handleShutdown(map: Map<string, IPty>): void {
  for (const proc of map.values()) {
    // Kill the entire process group (bash + claude/opencode subprocesses).
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* best-effort */
    }
    try {
      proc.kill('SIGKILL');
    } catch {
      /* best-effort */
    }
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
