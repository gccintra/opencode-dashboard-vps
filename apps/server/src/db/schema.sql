-- OpenCode Dashboard — Database Schema
-- This file is executed on every server boot. All statements must be idempotent
-- (use IF NOT EXISTS / compatible DDL). Each feature adds its own tables here
-- or in separate SQL files, always using idempotent DDL.

-- Meta-table: tracks which migration files have been applied
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
) STRICT;

-- Projects: registered project directories with metadata
-- harness_id is a soft reference to harnesses (task 07 will add the FK)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  directory TEXT NOT NULL,
  description TEXT,
  harness_id TEXT,
  github_repo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

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

-- Tasks: kanban cards linked to projects
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK(source IN ('local', 'github')),
  "column" TEXT NOT NULL DEFAULT 'backlog' CHECK("column" IN ('backlog', 'in_progress', 'done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  github_issue_url TEXT,
  github_labels TEXT,
  github_issue_number INTEGER,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;
