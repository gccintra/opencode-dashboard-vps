/**
 * Agents Panel API.
 *
 * Provides aggregate views of all sessions across all projects for the
 * AgentPanel dashboard component. Combines data from:
 *  - sessionMeta (in-memory session metadata from sessions.ts)
 *  - PtyManager (per-session buffer for output preview)
 *  - projects table (project name)
 *  - tasks table (linked task info)
 *
 * All routes are protected by authGuard.
 */

import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getAllSessionMeta } from './sessions';
import { getPtyManager } from '../pty/manager';
import { stripAnsi, detectStatus } from '../pty/detector';
import { getDb } from '../db/client';
import type { SessionMeta } from './sessions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Shape returned by GET /api/agents */
export interface AgentInfo {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  type: string;
  createdAt: number;
  lastActiveAt: number;
  outputPreview: string;
  linkedTaskId?: string;
  linkedTaskTitle?: string;
}

/** Shape returned by GET /api/agents/metrics */
export interface AgentMetrics {
  total: number;
  active: number;
  waiting: number;
  finished: number;
  emergency: number;
}

/** Max age for finished sessions to appear in the list (5 minutes in ms). */
const FINISHED_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Extract the last N non-empty lines from the session's buffer,
 * strip ANSI sequences, and truncate to `maxChars`.
 */
function buildOutputPreview(buffer: string, maxChars = 100, lineLimit = 2): string {
  if (!buffer) return '(sem output ainda)';
  const clean = stripAnsi(buffer);
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  const last = lines.slice(-lineLimit);
  const joined = last.join(' | ');
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars - 3) + '...';
}

/** Status ordering for sort: waiting=0, active=1, finished=2. */
function statusOrder(status: string): number {
  if (status === 'waiting') return 0;
  if (status === 'active') return 1;
  return 2;
}

/** Resolve the detected status for a session. */
function resolveStatus(sessionId: string, _meta: SessionMeta): string {
  const manager = getPtyManager();
  const ptyStatus = manager.getSessionStatus(sessionId);
  if (!ptyStatus) {
    // Not tracked by PtyManager → treat as finished.
    return 'finished';
  }
  const buffer = manager.getSessionBuffer(sessionId);
  return detectStatus({ status: ptyStatus, buffer });
}

/** Build an AgentInfo object for a single session. */
function buildAgentInfo(
  meta: SessionMeta,
  projectMap: Map<string, string>,
  taskMap: Map<string, { title: string }>,
): AgentInfo {
  const status = resolveStatus(meta.sessionId, meta);
  const manager = getPtyManager();
  const buffer = manager.getSessionBuffer(meta.sessionId);
  const linkedTask = meta.sessionId ? taskMap.get(meta.sessionId) : undefined;

  return {
    id: meta.sessionId,
    name: meta.name,
    projectId: meta.projectId,
    projectName: meta.projectId ? (projectMap.get(meta.projectId) ?? null) : null,
    status,
    type: meta.type || 'project',
    createdAt: meta.createdAt,
    lastActiveAt: meta.createdAt, // Best-effort — manager dataAt not publicly exposed
    outputPreview: buildOutputPreview(buffer),
    ...(linkedTask ? { linkedTaskId: meta.sessionId, linkedTaskTitle: linkedTask.title } : {}),
  };
}

/** Fetch all project names into a map. */
function buildProjectMap(): Map<string, string> {
  const db = getDb();
  const rows = db.query('SELECT id, name FROM projects').all() as DbRow[];
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.id as string, r.name as string);
  }
  return map;
}

/** Fetch task links: session_id → title. */
function buildTaskMap(): Map<string, { title: string }> {
  const db = getDb();
  try {
    const rows = db
      .query(
        "SELECT session_id, title FROM tasks WHERE session_id IS NOT NULL AND session_id != ''",
      )
      .all() as DbRow[];
    const map = new Map<string, { title: string }>();
    for (const r of rows) {
      map.set(r.session_id as string, { title: r.title as string });
    }
    return map;
  } catch {
    // tasks table may not exist yet — that's fine.
    return new Map();
  }
}

export const agentsRoutes = new Elysia().guard(authGuard, (app) =>
  app
    // ── GET /api/agents ──────────────────────────────────────────
    .get('/api/agents', ({ query, set }) => {
      try {
        const allMeta = getAllSessionMeta();
        const projectMap = buildProjectMap();
        const taskMap = buildTaskMap();
        const now = Date.now();

        const statusFilter = (query as { status?: string }).status;
        const projectFilter = (query as { projectId?: string }).projectId;
        const allowedStatuses = statusFilter
          ? statusFilter
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null;

        const agents: AgentInfo[] = [];

        for (const meta of allMeta) {
          const status = resolveStatus(meta.sessionId, meta);

          // Exclude finished sessions older than 5 min.
          if (status === 'finished') {
            if (now - meta.createdAt > FINISHED_MAX_AGE_MS) continue;
          }

          // Apply status filter.
          if (allowedStatuses && !allowedStatuses.includes(status)) continue;

          // Apply project filter.
          if (projectFilter && meta.projectId !== projectFilter) continue;

          agents.push(buildAgentInfo(meta, projectMap, taskMap));
        }

        // Sort: waiting first, then active, then finished (by lastActiveAt desc).
        agents.sort((a, b) => {
          const orderDiff = statusOrder(a.status) - statusOrder(b.status);
          if (orderDiff !== 0) return orderDiff;
          return b.lastActiveAt - a.lastActiveAt;
        });

        return agents;
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    })

    // ── GET /api/agents/metrics ──────────────────────────────────
    .get('/api/agents/metrics', ({ set }) => {
      try {
        const allMeta = getAllSessionMeta();
        const now = Date.now();

        let total = 0;
        let active = 0;
        let waiting = 0;
        let finished = 0;
        let emergency = 0;

        for (const meta of allMeta) {
          if (meta.type === 'emergency') {
            emergency++;
            continue;
          }
          const status = resolveStatus(meta.sessionId, meta);
          // Finished sessions >5min are excluded from metrics too.
          if (status === 'finished' && now - meta.createdAt > FINISHED_MAX_AGE_MS) continue;

          total++;
          if (status === 'active') active++;
          else if (status === 'waiting') waiting++;
          else if (status === 'finished') finished++;
        }

        return { total, active, waiting, finished, emergency } satisfies AgentMetrics;
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    }),
);
