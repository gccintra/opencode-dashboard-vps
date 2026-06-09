/**
 * IPC Protocol types — shared between the pty-worker (Node.js) and the
 * Bun/Elysia server's PTY Manager.
 *
 * The transport is a line-delimited JSON stream over stdio (stdin from
 * Bun → worker, stdout from worker → Bun). Each JSON message is exactly
 * one line terminated by `\n`. Multiplexing of concurrent PTY sessions
 * uses the `id` field on both requests and responses.
 *
 * ─── Request correlation ────────────────────────────────────────────
 * - For `spawn` / `write` / `resize` / `kill`, the `id` is the SESSION id
 *   assigned by the server-side PTY Manager. The worker echoes that id
 *   in `spawned` / `killed` / `data` / `exit` responses so the manager
 *   can route them back to the right session.
 * - For `list` (and its `list` response), there is no `id` — list is
 *   single-flight on the manager side (one pending request at a time).
 * - `shutdown` is fire-and-forget; the worker exits immediately.
 *
 * ─── Error envelope ─────────────────────────────────────────────────
 * Worker reports both expected errors (e.g. session not found) and
 * unexpected exceptions as `{type: 'error', id?, message}`. The `id`
 * is included when the error refers to a specific session.
 */

// ── Client → Server (Bun → worker) ────────────────────────────────

export interface SpawnRequest {
  type: 'spawn';
  id: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  /** Additional env vars merged on top of process.env. */
  env?: Record<string, string>;
}

export interface WriteRequest {
  type: 'write';
  id: string;
  data: string;
}

export interface ResizeRequest {
  type: 'resize';
  id: string;
  cols: number;
  rows: number;
}

export interface KillRequest {
  type: 'kill';
  id: string;
}

export interface ListRequest {
  type: 'list';
}

export interface ShutdownRequest {
  type: 'shutdown';
}

export type ClientMessage =
  | SpawnRequest
  | WriteRequest
  | ResizeRequest
  | KillRequest
  | ListRequest
  | ShutdownRequest;

// ── Server → Client (worker → Bun) ────────────────────────────────

export interface SpawnedResponse {
  type: 'spawned';
  id: string;
  pid: number;
}

export interface DataResponse {
  type: 'data';
  id: string;
  /** Base64-encoded binary PTY output. @see encoding */
  chunk: string;
  /** Encoding of `chunk`. `'base64'` is always set by the worker. */
  encoding?: 'base64';
}

export interface ExitResponse {
  type: 'exit';
  id: string;
  code: number;
}

export interface KilledResponse {
  type: 'killed';
  id: string;
}

export interface ListResponse {
  type: 'list';
  sessions: string[];
}

export interface ErrorResponse {
  type: 'error';
  id?: string;
  message: string;
}

export type ServerMessage =
  | SpawnedResponse
  | DataResponse
  | ExitResponse
  | KilledResponse
  | ListResponse
  | ErrorResponse;

// ── Helpers ────────────────────────────────────────────────────────

export const CLIENT_MESSAGE_TYPES = [
  'spawn',
  'write',
  'resize',
  'kill',
  'list',
  'shutdown',
] as const;
export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

/**
 * Runtime validator for incoming client messages. Returns true only when
 * the value is a non-null object whose `type` field is one of the known
 * client message types. The narrow type is for type-safety downstream;
 * the actual structure is still checked by the dispatcher.
 */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as { type?: unknown };
  return typeof v.type === 'string' && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(v.type);
}
