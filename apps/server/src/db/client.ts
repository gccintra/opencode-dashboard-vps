import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = process.env.DATABASE_PATH || './data/opencode.db';

let db: Database | null = null;

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
  const path = dbPath || DEFAULT_DB_PATH;

  // Close any previously open database before re-initializing
  if (db) {
    db.close();
    db = null;
  }

  ensureDir(path);
  db = new Database(path);

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL');
  // Enable foreign key enforcement
  db.exec('PRAGMA foreign_keys = ON');

  runSchema(db);

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
