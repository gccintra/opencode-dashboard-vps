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

  // Idempotent column migrations for existing databases.
  // schema.sql handles new databases; ALTER TABLE handles databases created
  // before a column was added (SQLite does not support IF NOT EXISTS for columns).
  const taskCols = db.query('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!taskCols.some((c) => c.name === 'agent_type')) {
    db.run("ALTER TABLE tasks ADD COLUMN agent_type TEXT CHECK(agent_type IN ('opencode', 'claude'))");
    console.log('[db] migrated: added tasks.agent_type column');
  }
  // agent_name / agent_source / model: chosen agent + LLM for the implement flow.
  if (!taskCols.some((c) => c.name === 'agent_name')) {
    db.run('ALTER TABLE tasks ADD COLUMN agent_name TEXT');
    console.log('[db] migrated: added tasks.agent_name column');
  }
  if (!taskCols.some((c) => c.name === 'agent_source')) {
    db.run("ALTER TABLE tasks ADD COLUMN agent_source TEXT CHECK(agent_source IN ('agents', 'commands'))");
    console.log('[db] migrated: added tasks.agent_source column');
  }
  if (!taskCols.some((c) => c.name === 'model')) {
    db.run('ALTER TABLE tasks ADD COLUMN model TEXT');
    console.log('[db] migrated: added tasks.model column');
  }
  // effort: provider-specific reasoning effort (claude --effort / opencode --variant).
  if (!taskCols.some((c) => c.name === 'effort')) {
    db.run('ALTER TABLE tasks ADD COLUMN effort TEXT');
    console.log('[db] migrated: added tasks.effort column');
  }
  if (!taskCols.some((c) => c.name === 'issue_number')) {
    db.run('ALTER TABLE tasks ADD COLUMN issue_number INTEGER NOT NULL DEFAULT 0');
    // Backfill: assign sequential numbers per project based on creation order.
    db.exec(`
      UPDATE tasks SET issue_number = (
        SELECT COUNT(*) FROM tasks t2
        WHERE t2.project_id = tasks.project_id
          AND (t2.created_at < tasks.created_at OR (t2.created_at = tasks.created_at AND t2.id <= tasks.id))
      )
    `);
    console.log('[db] migrated: added tasks.issue_number column with backfill');
  }

  // Migration: remove CHECK constraint on tasks.column so custom kanban column IDs are allowed.
  // SQLite can't alter CHECK constraints — we recreate the table if the old constraint is present.
  const tasksTableDef = (
    db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as
      | { sql: string }
      | null
  )?.sql ?? '';
  if (tasksTableDef.includes("'backlog', 'in_progress', 'done'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS tasks_new;
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        source TEXT NOT NULL DEFAULT 'local' CHECK(source IN ('local', 'github')),
        "column" TEXT NOT NULL DEFAULT 'backlog',
        sort_order INTEGER NOT NULL DEFAULT 0,
        issue_number INTEGER NOT NULL DEFAULT 0,
        github_issue_url TEXT,
        github_labels TEXT,
        github_issue_number INTEGER,
        session_id TEXT,
        agent_type TEXT CHECK(agent_type IN ('opencode', 'claude')),
        agent_name TEXT,
        agent_source TEXT CHECK(agent_source IN ('agents', 'commands')),
        model TEXT,
        effort TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      PRAGMA foreign_keys = ON;
    `);
    console.log('[db] migrated: removed CHECK constraint from tasks.column');
  }

  // Migration: add tasks.priority (low/medium/high, default medium).
  // Placed after the table-recreate block so the recreate path never has to
  // account for it — existing rows get the default via the column DEFAULT.
  const taskColsAfter = db.query('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!taskColsAfter.some((c) => c.name === 'priority')) {
    db.run(
      "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high'))",
    );
    console.log('[db] migrated: added tasks.priority column');
  }

  // Seed default kanban_columns if table is empty.
  // IDs match legacy tasks.column values so existing data is immediately valid.
  const kanbanColCount = (
    db.query('SELECT COUNT(*) as count FROM kanban_columns').get() as { count: number }
  ).count;
  if (kanbanColCount === 0) {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['backlog', 'Backlog', 'backlog', '#6b7280', 0, now],
    );
    db.run(
      `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['todo', 'Todo', 'unstarted', '#3b82f6', 0, now],
    );
    db.run(
      `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['in_progress', 'In Progress', 'started', '#f59e0b', 0, now],
    );
    db.run(
      `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['done', 'Done', 'completed', '#22c55e', 0, now],
    );
    db.run(
      `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['canceled', 'Canceled', 'canceled', '#ef4444', 0, now],
    );
    console.log('[db] seeded: default kanban_columns');
  }

  // Migrate labels table: drop project_id (make labels global).
  // SQLite can't DROP COLUMN before v3.35; recreate the table instead.
  const labelCols = db.query('PRAGMA table_info(labels)').all() as Array<{ name: string }>;
  if (labelCols.some((c) => c.name === 'project_id')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE labels_global (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO labels_global (id, name, color, created_at)
        SELECT id, name, color, created_at FROM labels;
      DROP TABLE labels;
      ALTER TABLE labels_global RENAME TO labels;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name ON labels(name COLLATE NOCASE);
      PRAGMA foreign_keys = ON;
    `);
    console.log('[db] migrated: labels table made global (project_id removed)');
  }

  // Migration: add 'project_changed' to task_activity.type CHECK constraint.
  const activityTableDef = (
    db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_activity'").get() as
      | { sql: string }
      | null
  )?.sql ?? '';
  if (activityTableDef && !activityTableDef.includes("'project_changed'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE task_activity_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN (
          'created', 'moved', 'title_changed', 'description_changed',
          'priority_changed', 'project_changed', 'label_added', 'label_removed',
          'linked', 'unlinked', 'comment'
        )),
        body TEXT,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO task_activity_new SELECT * FROM task_activity;
      DROP TABLE task_activity;
      ALTER TABLE task_activity_new RENAME TO task_activity;
      CREATE INDEX IF NOT EXISTS idx_task_activity_task
        ON task_activity(task_id, created_at);
      PRAGMA foreign_keys = ON;
    `);
    console.log("[db] migrated: added 'project_changed' to task_activity.type CHECK");
  }

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
