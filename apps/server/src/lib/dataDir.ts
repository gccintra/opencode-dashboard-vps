/**
 * Neutral dashboard data directory helpers.
 *
 * Attachments and other dashboard-owned artifacts live under a CLI-agnostic
 * directory derived from the SQLite database location — NEVER inside
 * `.opencode/` (which is reserved for the GitHub-sync task serialization).
 *
 * The base data dir is the directory that holds the database file:
 *   DATABASE_PATH=./data/opencode.db -> dataDir = ./data
 * If the DB path has no directory component (e.g. "opencode.db" or
 * ":memory:" under Vitest), we fall back to "./data".
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve, normalize } from 'node:path';

/** Resolve the neutral data directory (absolute path). */
export function getDataDir(): string {
  const dbPath = process.env.DATABASE_PATH || './data/opencode.db';
  if (dbPath === ':memory:') {
    return resolve(process.cwd(), 'data');
  }
  const dir = dirname(dbPath);
  // dirname("opencode.db") === "." → no meaningful directory, use ./data
  if (dir === '.' || dir === '') {
    return resolve(process.cwd(), 'data');
  }
  return resolve(process.cwd(), dir);
}

/**
 * Resolve the attachments directory for a given task and ensure it exists.
 * Returns the absolute path: <dataDir>/attachments/<taskId>.
 */
export function getAttachmentsDir(taskId: string): string {
  const dir = join(getDataDir(), 'attachments', taskId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Sanitize a user/stored relative path and resolve it against a base
 * directory. Mirrors the pattern in routes/files.ts:
 *   null byte check → normalize backslashes → block absolute paths →
 *   verify resolved.startsWith(baseDir + '/').
 *
 * Returns the resolved absolute path, or an error object with HTTP status.
 */
export function resolveSafePath(
  baseDir: string,
  relativePath: string,
): { resolved: string } | { error: string; status: number } {
  // Block null bytes
  if (relativePath.includes('\0')) {
    return { error: 'path contains invalid characters', status: 400 };
  }

  // Normalize the input (collapse backslashes to forward slashes first)
  const normalized = normalize(relativePath.replace(/\\/g, '/'));

  // Block absolute paths
  if (normalized.startsWith('/')) {
    return { error: 'absolute paths are not allowed', status: 403 };
  }

  // Resolve against the base directory
  const resolved = resolve(baseDir, normalized);

  // Verify the resolved path stays within the base directory
  if (
    !resolved.startsWith(baseDir.endsWith('/') ? baseDir : baseDir + '/') &&
    resolved !== baseDir
  ) {
    return { error: 'path traversal detected', status: 403 };
  }

  return { resolved };
}
