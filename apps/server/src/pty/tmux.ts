/**
 * tmux integration for resilient PTY sessions.
 *
 * Sessions run inside a tmux server (a daemon independent of the Bun server).
 * The server only ever runs a thin `tmux -C new-session -A` control client;
 * the real processes (bash/claude/opencode) live in the daemon and survive
 * the server being killed.
 *
 * Design (plan §9 Q1): ALL tmux knowledge lives on the server.
 *  - Spawn args are built here and handed to the control transport as an
 *    opaque `args` array (starting with `tmux`).
 *  - Administrative commands (kill/has/list) run here via `child_process`
 *    `execFile`, which works under both Bun and Node (so unit tests that
 *    import this module don't depend on `Bun.spawn`).
 *
 * Session naming (plan §9 Q6): tmux sessions are prefixed `alf_` so they
 * never collide with a human operator's own tmux sessions on the host.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Prefix for every ALF-managed tmux session, to avoid collisions. */
export const TMUX_PREFIX = 'alf_';

/** Map a session id to its tmux session name. */
export function tmuxName(sessionId: string): string {
  return `${TMUX_PREFIX}${sessionId}`;
}

/**
 * Returns socket args `['-S', path]` if `TMUX_SOCKET_PATH` is set, else `[]`.
 * Injected into every tmux invocation so dev and prod never share a socket.
 */
function socketArgs(): string[] {
  const p = process.env.TMUX_SOCKET_PATH;
  return p ? ['-S', p] : [];
}

/** Extract the session id from a tmux session name, or null if not ours. */
export function sessionIdFromTmuxName(name: string): string | null {
  return name.startsWith(TMUX_PREFIX) ? name.slice(TMUX_PREFIX.length) : null;
}

/** Absolute path to the transparent tmux.conf, resolved next to this module. */
export const TMUX_CONF_PATH = fileURLToPath(new URL('./tmux.conf', import.meta.url));

/**
 * Build the spawn args for a session's attach client.
 *
 * Control mode runs `tmux -C -f <conf> new-session -A -s <name> ...`.
 * `-A` makes new-session idempotent: it CREATES the session on first call
 * (running `innerCmd`) and ATTACHES to it on every subsequent call (ignoring
 * `innerCmd`, `-x`, `-y`). This single command therefore serves both the
 * initial spawn and every reattach.
 *
 * Environment is injected with `-e KEY=VAL` rather than relying on the attach
 * client's env: a new-session created in an ALREADY-RUNNING tmux server
 * inherits the SERVER's environment, not the client's, so per-session vars
 * (e.g. OPENCODE_ACTIVE_*) would otherwise be dropped. `-e` requires tmux ≥ 3.2.
 * Env (like innerCmd) only takes effect on create; it is ignored on reattach.
 *
 * @param sessionId  the ALF session id
 * @param cols       initial columns (used only on first create)
 * @param rows       initial rows (used only on first create)
 * @param innerCmd   shell command to run inside the session (claude/opencode +
 *                   fallback shell). Omit for a bare default shell (emergency
 *                   terminal). A trailing newline is stripped.
 * @param env        per-session environment variables (used only on first create)
 */
export function buildTmuxSpawnArgs(
  sessionId: string,
  cols: number,
  rows: number,
  innerCmd?: string,
  env?: Record<string, string>,
): string[] {
  const args = [
    'tmux',
    ...socketArgs(),
    '-f',
    TMUX_CONF_PATH,
    'new-session',
    '-A',
    '-s',
    tmuxName(sessionId),
    '-x',
    String(cols),
    '-y',
    String(rows),
  ];
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }
  }
  const trimmed = innerCmd?.replace(/\s+$/, '');
  if (trimmed) args.push(trimmed);
  return args;
}

/** Run a tmux subcommand. Resolves with stdout; rejects on non-zero exit. */
function runTmux(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('tmux', [...socketArgs(), ...args], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout);
    });
  });
}

/** True if a tmux server is reachable and the binary works. */
export async function tmuxAvailable(): Promise<boolean> {
  try {
    await runTmux(['-V']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a session's tmux session (the real processes), not just the attach
 * client. Idempotent and best-effort: a missing session is treated as success.
 */
export async function tmuxKillSession(sessionId: string): Promise<void> {
  try {
    await runTmux(['kill-session', '-t', tmuxName(sessionId)]);
  } catch {
    // Session already gone (or no server) — nothing to kill.
  }
}

/** True if the session's tmux session currently exists in the daemon. */
export async function tmuxHasSession(sessionId: string): Promise<boolean> {
  try {
    await runTmux(['has-session', '-t', tmuxName(sessionId)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * List the session ids of all live ALF tmux sessions (prefix stripped).
 * Returns an empty array when no tmux server is running.
 */
export async function tmuxListSessions(): Promise<string[]> {
  let out: string;
  try {
    out = await runTmux(['list-sessions', '-F', '#{session_name}']);
  } catch {
    // No server running → no sessions.
    return [];
  }
  const ids: string[] = [];
  for (const line of out.split('\n')) {
    const id = sessionIdFromTmuxName(line.trim());
    if (id) ids.push(id);
  }
  return ids;
}
