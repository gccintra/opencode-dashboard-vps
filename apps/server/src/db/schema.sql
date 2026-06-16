-- OpenCode Dashboard — Database Schema
-- This file is executed on every server boot. All statements must be idempotent
-- (use IF NOT EXISTS / compatible DDL). Each feature adds its own tables here
-- or in separate SQL files, always using idempotent DDL.

-- Meta-table: tracks which migration files have been applied
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
) STRICT;

-- Harnesses: template directories for bootstrapping projects
CREATE TABLE IF NOT EXISTS harnesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  directory TEXT NOT NULL,
  file_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Projects: registered project directories with metadata
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  directory TEXT NOT NULL,
  description TEXT,
  harness_id TEXT,
  github_repo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (harness_id) REFERENCES harnesses(id) ON DELETE SET NULL
) STRICT;

-- FK enforcement for projects.harness_id (works for existing DBs where
-- the projects table was created without a declarative FK).
-- Used alongside the declarative FK in CREATE TABLE for new DBs.
CREATE TRIGGER IF NOT EXISTS fk_projects_harness_id_insert
  BEFORE INSERT ON projects
  WHEN NEW.harness_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: harness_id not found in harnesses')
  WHERE (SELECT id FROM harnesses WHERE id = NEW.harness_id) IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS fk_projects_harness_id_update
  BEFORE UPDATE OF harness_id ON projects
  WHEN NEW.harness_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: harness_id not found in harnesses')
  WHERE (SELECT id FROM harnesses WHERE id = NEW.harness_id) IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS fk_harnesses_delete_set_null
  BEFORE DELETE ON harnesses
BEGIN
  UPDATE projects SET harness_id = NULL WHERE harness_id = OLD.id;
END;

-- Project Resources: link scanned resources (skills, agents, mcps) to
-- projects with activation state. Only active + available resources are
-- passed as environment variables when creating a session.
CREATE TABLE IF NOT EXISTS project_resources (
  project_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, resource_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;

-- Sessions: terminal sessions linked to projects (persisted for crash recovery)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  type TEXT NOT NULL DEFAULT 'project',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;

-- Kanban Columns: named workflow states grouped by category
-- Categories are fixed (backlog/unstarted/started/completed/canceled).
-- Users can create multiple columns within each category.
CREATE TABLE IF NOT EXISTS kanban_columns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
  color TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_columns_name
  ON kanban_columns(name COLLATE NOCASE);

-- Tasks: kanban cards linked to projects
-- NOTE: "column" is a free-text FK to kanban_columns.id (no CHECK — validated at app layer).
-- Legacy values ('backlog', 'in_progress', 'done') match the default kanban_column IDs.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK(source IN ('local', 'github')),
  "column" TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
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

-- Labels: global customizable colored labels (Linear-style, not project-scoped)
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- Unique label name globally (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name
  ON labels(name COLLATE NOCASE);

-- Task ↔ Label many-to-many join
CREATE TABLE IF NOT EXISTS task_labels (
  task_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
) STRICT;

-- Task Attachments: metadata only; binaries live in <dataDir>/attachments/<taskId>/
CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) STRICT;

-- Task Activity: unified GitLab-style timeline. System events (created, moved,
-- title/description/priority changes, label add/remove, link add/remove) AND
-- free-text comments live in one table, ordered by created_at on render.
-- Comments are type='comment' with body set; system events are immutable.
CREATE TABLE IF NOT EXISTS task_activity (
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

CREATE INDEX IF NOT EXISTS idx_task_activity_task
  ON task_activity(task_id, created_at);

-- Task Links: GitLab-style typed relations between tasks (cross-project allowed).
-- One canonical row per relation; the inverse (blocks <-> blocked_by) is computed
-- at query time. relates_to / duplicates are symmetric.
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY,
  source_task_id TEXT NOT NULL,
  target_task_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('relates_to', 'blocks', 'blocked_by', 'duplicates')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_links_unique
  ON task_links(source_task_id, target_task_id, type);

-- Canvas Hub: named multi-terminal layouts persisted cross-device
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cols INTEGER NOT NULL DEFAULT 2,
  rows INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Canvas Slots: session assignments for each slot in a canvas
CREATE TABLE IF NOT EXISTS canvas_slots (
  canvas_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  session_id TEXT,
  PRIMARY KEY (canvas_id, slot_index),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
) STRICT;

-- Task Spawn Events: audit log of every "implement" button press
CREATE TABLE IF NOT EXISTS task_spawn_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT,
  runtime TEXT,
  agent_name TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) STRICT;
