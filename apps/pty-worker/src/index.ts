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

/** Default response writer: one JSON line + `\n` to stdout. */
export function writeResponse(msg: ServerMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
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

function handleSpawn(
  msg: Extract<ClientMessage, { type: 'spawn' }>,
  ptySpawn: PtySpawnFn,
  map: Map<string, IPty>,
  write: (m: ServerMessage) => void,
): void {
  if (map.has(msg.id)) {
    write({ type: 'error', id: msg.id, message: `session already exists: ${msg.id}` });
    return;
  }

  const env = { ...(process.env as Record<string, string>) };
  if (msg.env) {
    Object.assign(env, msg.env);
  }
  const proc = ptySpawn(msg.command, msg.args ?? [], {
    name: 'xterm-color',
    cols: msg.cols ?? 80,
    rows: msg.rows ?? 24,
    cwd: msg.cwd,
    env,
  });

  map.set(msg.id, proc);

  proc.onData((chunk) => {
    write({
      type: 'data',
      id: msg.id,
      // Encode as UTF-8 bytes before base64, NOT latin1 ('binary').
      // Latin1 truncates multi-byte Unicode characters (▀ ▄ █ — 3-byte
      // UTF-8 sequences like E2 96 88) to their low byte (0x88 alone),
      // which xterm.js renders as isolated replacement glyphs (■).
      // UTF-8 encoding preserves the full 3-byte sequence so block
      // characters survive the IPC pipeline intact.
      chunk: Buffer.from(chunk, 'utf8').toString('base64'),
      encoding: 'base64',
    });
  });
  proc.onExit(({ exitCode, signal }) => {
    // Normalise signal-induced exits: PTY exits with exitCode=0 even on SIGHUP
    // etc., so we treat any non-zero code as an abnormal exit and let the
    // buffer reconnection logic on the manager side figure it out.
    if (map.get(msg.id) === proc) {
      map.delete(msg.id);
    }
    const code = exitCode ?? (signal ? 128 + (typeof signal === 'number' ? signal : 0) : 0);
    write({ type: 'exit', id: msg.id, code });
  });

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
    console.error(`[pty-worker] handleResize: ${msg.id} -> ${msg.cols}x${msg.rows}`);
    proc.resize(msg.cols, msg.rows);
  } catch (err) {
    write({ type: 'error', id: msg.id, message: `resize failed: ${(err as Error).message}` });
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
    try {
      proc.kill();
    } catch {
      // best-effort
    }
    map.delete(msg.id);
  }
  write({ type: 'killed', id: msg.id });
}

function handleList(map: Map<string, IPty>, write: (m: ServerMessage) => void): void {
  write({ type: 'list', sessions: Array.from(map.keys()) });
}

function handleShutdown(map: Map<string, IPty>): void {
  for (const proc of map.values()) {
    try {
      proc.kill();
    } catch {
      // best-effort
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
}

// ── Entry point ────────────────────────────────────────────────────

const ENTRY = process.argv[1];
if (ENTRY && import.meta.url === `file://${ENTRY}`) {
  const rl = createInterface({ input: process.stdin });
  startIpcLoop({ readline: rl });
}
