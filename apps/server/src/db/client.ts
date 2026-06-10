import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = process.env.DATABASE_PATH || './data/opencode.db';

// In Vitest, never allow initDb() to open a real on-disk database unless the
// caller explicitly passes a path. This prevents test code from accidentally
// writing to a production database when DATABASE_PATH is set in the environment.
const RUNNING_IN_VITEST = process.env.VITEST === 'true';

let db: Database | null = null;
let currentDbPath: string | null = null;
let lastIntegrityResult: string = 'not_checked';

/** Return the path of the currently open database, or null if not initialized. */
export function getDbPath(): string | null {
  return currentDbPath;
}

/** Return the integrity_check result from the last initDb() call. */
export function getDbIntegrityResult(): string {
  return lastIntegrityResult;
}

/** Return the current database singleton. Throws if initDb() hasn't been called. */
export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Ensure the parent directory for a file-based database path exists.
 * Does nothing for `:memory:` paths.
 */
function ensureDir(dbPath: string): void {
  if (dbPath === ':memory:') return;

  const lastSep = dbPath.lastIndexOf('/');
  if (lastSep <= 0) return; // relative path in cwd — no directory to create (e.g. "opencode.db")

  const dir = dbPath.substring(0, lastSep);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`[db] created directory: ${dir}`);
  }
}

/**
 * Execute the schema.sql file against the given database.
 * All statements use IF NOT EXISTS so this is idempotent.
 */
export function runSchema(database: Database): void {
  const schemaPath = join(import.meta.dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  database.exec(schema);
  console.log('[db] schema applied');
}

/**
 * Initialize the database connection and apply the schema.
 *
 * @param dbPath — optional path for testing (`:memory:`, temp file, etc.).
 *                 When omitted, uses `DATABASE_PATH` env var (default `./data/opencode.db`).
 * @returns The opened Database instance.
 */
export function initDb(dbPath?: string): Database {
  // Guard: in Vitest, fall back to :memory: when no explicit path is given.
  // Prevents tests from writing to the production database if DATABASE_PATH is set.
  const path = dbPath ?? (RUNNING_IN_VITEST ? ':memory:' : DEFAULT_DB_PATH);

  // Close any previously open database before re-initializing
  if (db) {
    db.close();
    db = null;
  }

  ensureDir(path);
  db = new Database(path);

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL');

  if (path !== ':memory:') {
    // Force WAL merge into the main DB file before any reads — prevents stale
    // views that can occur after crash/restart cycles with an unflushed WAL.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    // Validate structural integrity; log a warning but never crash the server.
    const rows = db.query('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const result = rows.map((r) => r.integrity_check).join('; ');
    lastIntegrityResult = result === 'ok' ? 'ok' : result;
    if (lastIntegrityResult !== 'ok') {
      console.warn(`[db] integrity_check FAILED: ${lastIntegrityResult}`);
    } else {
      console.log('[db] integrity_check: ok');
    }
  } else {
    lastIntegrityResult = 'not_checked';
  }

  // Enable foreign key enforcement
  db.exec('PRAGMA foreign_keys = ON');

  runSchema(db);
  currentDbPath = path;

  console.log(`[db] connected to ${path}`);
  return db;
}

/**
 * Cleanly close the database connection.
 * Safe to call multiple times.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
