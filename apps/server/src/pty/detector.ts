/**
 * Session Status Detector.
 *
 * Analyzes a session's output buffer to determine its runtime state.
 * The three states map to the SessionStatusDetected enum:
 *
 *  - `finished` — the underlying PTY process has exited or been killed.
 *  - `waiting` — the buffer ends with an opencode CLI prompt pattern, meaning
 *    the agent is idle and waiting for the next instruction.
 *  - `active`  — the session is alive but not idle (output is flowing, or the
 *    prompt pattern hasn't been detected yet).
 *
 * ─── Prompt Detection ────────────────────────────────────────────
 * The opencode CLI produces prompts matching:
 *   `user@host:~/path/to/project$ ` (shell prompt)
 *   `user@host:~/path/to/project> ` (continuation prompt)
 *   or similar patterns with `/`, `~`, `.`, `-` in the path component.
 *
 * The regex `OPENCODE_PROMPT_REGEX` anchors to the end of the buffer to
 * determine whether the last line looks like a prompt.
 *
 * ─── Last Active Tracking ────────────────────────────────────────
 * `getLastActiveAt` returns the session's `dataAt` timestamp (updated on
 * every data chunk). This can be compared against the current time to
 * implement "idle timeout" logic if needed.
 */

import type { SessionState, SessionStatus } from './manager';

/** Runtime-detected status — extends the raw PTY status with semantic meaning. */
export type DetectedStatus = 'active' | 'waiting' | 'finished';

/**
 * Regex to detect an opencode (or similar CLI) prompt at the END of a terminal
 * buffer. Matches patterns like:
 *
 *   user@host:~/path$
 *   user@host:/absolute/path>
 *   root@server:/home/user#
 *   user@host:relative/path/to/project$
 *
 * The pattern is intentionally permissive: any `word@word:path[$#>]` at the
 * end of the buffer qualifies, which covers bash, zsh, fish, and opencode's
 * custom prompt. The `m` flag is intentionally NOT set — we only care about
 * the very end of the buffer.
 */
export const OPENCODE_PROMPT_REGEX = /[\w.+-]+@[\w.-]+:[\w/~.-]*[$#>]\s*$/;

/** Surrounding whitespace the prompt regex scrubs before matching. */
const TRIM_CHARS_REGEX = /[\s]*$/;

/** Pattern matching ANSI escape sequences (SGR codes etc). */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Strip ANSI escape sequences from a string. These are control codes
 * used by terminals for colors, cursor positioning, etc. They are not
 * visible text and should not interfere with prompt detection.
 */
export function stripAnsi(buf: string): string {
  return buf.replace(ANSI_REGEX, '');
}

/**
 * Detect the semantic status of a session based on its raw PTY status and
 * output buffer content.
 *
 * @param session  The session state object (must have `status` and `buffer` fields).
 * @returns `'finished'`, `'waiting'`, or `'active'`.
 */
export function detectStatus(session: { status: SessionStatus; buffer: string }): DetectedStatus {
  // Terminal states always map to 'finished', regardless of buffer content.
  if (session.status === 'exited' || session.status === 'killed') {
    return 'finished';
  }

  // For active/pending sessions, inspect the buffer for a prompt.
  // Strip ANSI escape sequences first — they are non-visible control
  // codes that would break the prompt regex but don't affect what the
  // user actually sees.
  const clean = stripAnsi(session.buffer ?? '');
  if (OPENCODE_PROMPT_REGEX.test(clean)) {
    return 'waiting';
  }

  // Pending sessions are considered 'active' — they're alive but haven't
  // produced output yet (the opencode init banner / first prompt hasn't
  // arrived).
  return 'active';
}

/**
 * Return the timestamp of the last activity for a session.
 * Returns the session's `createdAt` as a fallback if no `dataAt` is present.
 *
 * @param session  The session state (must have `createdAt` and optionally `dataAt`).
 * @returns Unix timestamp in milliseconds.
 */
export function getLastActiveAt(session: { createdAt: number; dataAt?: number }): number {
  return session.dataAt ?? session.createdAt;
}

/**
 * Trim trailing whitespace (spaces, tabs, newlines, CR) from the right side
 * of the buffer before matching. This is a pure utility exposed for testing.
 */
export function trimTrailingWhitespace(buf: string): string {
  return buf.replace(TRIM_CHARS_REGEX, '');
}
