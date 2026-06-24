/**
 * Conversations API — list recent Claude Code and OpenCode conversations so
 * users can resume one inside a dashboard session.
 *
 * Claude Code: JSONL files at ~/.claude/projects/<dir>/<uuid>.jsonl
 *   Resume with: claude --resume <uuid>
 *
 * OpenCode: SQLite DB at ~/.local/share/opencode/opencode.db (session table)
 *   Resume with: opencode --session <ses_...>
 *
 * Protected by authGuard (JWT bearer required).
 */

import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { Database } from 'bun:sqlite';
import { getDb } from '../db/client';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function opencodeDbPath(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

const MAX_FILES_TO_PARSE = 100;
const MAX_LINES_PER_FILE = 60;
const MAX_RESULTS_PER_SOURCE = 50;
const FIRST_MESSAGE_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationSummary {
  id: string;
  cwd: string;
  firstMessage: string;
  timestamp: string;
  mtime: number;
  source: 'claude' | 'opencode';
  projectId: string;
}

interface JsonlLine {
  type?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

function extractFirstMessage(line: JsonlLine): string | null {
  const content = line.message?.content;
  if (typeof content === 'string') {
    const t = content.trim();
    return t.length > 0 ? t.slice(0, FIRST_MESSAGE_MAX) : null;
  }
  if (Array.isArray(content)) {
    const block = content.find((b) => b?.type === 'text' && typeof b.text === 'string');
    const t = block?.text?.trim();
    return t && t.length > 0 ? t.slice(0, FIRST_MESSAGE_MAX) : null;
  }
  return null;
}

function parseConversationFile(filePath: string, mtime: number): ConversationSummary | null {
  const id = basename(filePath, '.jsonl');
  if (!UUID_RE.test(id)) return null;

  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = text.split('\n');
  let cwd = '';
  let timestamp = '';
  let firstMessage = '';

  const limit = Math.min(lines.length, MAX_LINES_PER_FILE);
  for (let i = 0; i < limit; i++) {
    const raw = lines[i];
    if (!raw?.trim()) continue;
    let parsed: JsonlLine;
    try {
      parsed = JSON.parse(raw) as JsonlLine;
    } catch {
      continue;
    }
    if (!cwd && typeof parsed.cwd === 'string') cwd = parsed.cwd;
    if (!timestamp && typeof parsed.timestamp === 'string') timestamp = parsed.timestamp;
    if (!firstMessage && parsed.type === 'user') {
      const msg = extractFirstMessage(parsed);
      // Skip hook/command injections (<command-message>, <local-command-caveat>, etc.)
      if (msg && !msg.startsWith('<')) firstMessage = msg;
    }
    if (cwd && timestamp && firstMessage) break;
  }

  return {
    id,
    cwd,
    firstMessage: firstMessage || '[no message]',
    timestamp,
    mtime,
    source: 'claude',
    projectId: '',
  };
}

function listClaudeConversations(): ConversationSummary[] {
  const baseDir = claudeProjectsDir();
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(baseDir);
  } catch {
    return [];
  }

  const files: Array<{ path: string; mtime: number }> = [];
  for (const dir of projectDirs) {
    const dirPath = join(baseDir, dir);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(dirPath, entry);
      try {
        const s = statSync(filePath);
        if (s.isFile()) files.push({ path: filePath, mtime: s.mtimeMs });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => b.mtime - a.mtime);
  const conversations: ConversationSummary[] = [];
  for (const file of files.slice(0, MAX_FILES_TO_PARSE)) {
    const s = parseConversationFile(file.path, file.mtime);
    if (s) conversations.push(s);
  }
  conversations.sort((a, b) => b.mtime - a.mtime);
  return conversations.slice(0, MAX_RESULTS_PER_SOURCE);
}

interface OpenCodeRow {
  id: string;
  title: string;
  directory: string;
  time_updated: number;
}

function listOpencodeConversations(): ConversationSummary[] {
  const dbPath = opencodeDbPath();
  if (!existsSync(dbPath)) return [];

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .query<OpenCodeRow, [number]>(
        `SELECT id, title, directory, time_updated
         FROM session
         WHERE time_archived IS NULL
         ORDER BY time_updated DESC
         LIMIT ?`,
      )
      .all(MAX_RESULTS_PER_SOURCE);

    return rows.map((r) => ({
      id: r.id,
      cwd: r.directory,
      firstMessage: r.title || '[no title]',
      timestamp: new Date(r.time_updated).toISOString(),
      mtime: r.time_updated,
      source: 'opencode' as const,
      projectId: '',
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Returns map of normalised directory → project id for all registered projects. */
function registeredProjectDirs(): Map<string, string> {
  try {
    const rows = getDb()
      .query<{ id: string; directory: string }, []>('SELECT id, directory FROM projects')
      .all();
    return new Map(rows.map((r) => [r.directory.replace(/\/$/, ''), r.id]));
  } catch {
    return new Map();
  }
}

/** Returns the project id whose directory contains `cwd`, or null. */
function resolveProjectId(cwd: string, dirs: Map<string, string>): string | null {
  if (!cwd) return null;
  const normalised = cwd.replace(/\/$/, '');
  for (const [dir, id] of dirs) {
    if (normalised === dir || normalised.startsWith(dir + '/')) return id;
  }
  return null;
}

function listAllConversations(): ConversationSummary[] {
  const dirs = registeredProjectDirs();
  if (dirs.size === 0) return [];

  const assign = (c: ConversationSummary): ConversationSummary | null => {
    const projectId = resolveProjectId(c.cwd, dirs);
    if (!projectId) return null;
    return { ...c, projectId };
  };

  return [
    ...listClaudeConversations().map(assign).filter(Boolean),
    ...listOpencodeConversations().map(assign).filter(Boolean),
  ] as ConversationSummary[];
}

export const conversationsRoutes = new Elysia().guard(authGuard, (app) =>
  app.get('/api/conversations', () => {
    return { conversations: listAllConversations() };
  }),
);
