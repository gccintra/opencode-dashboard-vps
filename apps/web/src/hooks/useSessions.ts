/**
 * useSessions — hook for fetching and managing the session list.
 *
 * Provides a session list grouped by project that the Sidebar can
 * render as a nested tree. Exposes actions for rename, close, and
 * create operations.
 *
 * Sessions are fetched from:
 *   GET /api/projects — to get the project list
 *   GET /api/projects/:id/sessions — to get sessions per project
 *
 * The hook auto-refreshes after mutations (rename, close, create).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, type ApiError } from '../lib/api';

/* ── Types ── */

export interface SessionItem {
  sessionId: string;
  projectId: string;
  name: string;
  status: string;
  createdAt: number;
}

export interface ProjectItem {
  id: string;
  name: string;
  directory: string;
}

export interface SessionGroup {
  project: ProjectItem;
  sessions: SessionItem[];
}

export interface UseSessionsReturn {
  /** Sessions grouped by project (dead sessions excluded). */
  groups: SessionGroup[];
  /** Whether the initial fetch is in progress. */
  loading: boolean;
  /** Last error message, if any. */
  error: string | null;
  /** Refresh the session list from the server. */
  refresh: () => Promise<void>;
  /** Rename a session via PUT /api/sessions/:id. */
  renameSession: (sessionId: string, name: string) => Promise<SessionItem>;
  /** Close/kill a session via DELETE /api/sessions/:id. */
  closeSession: (sessionId: string) => Promise<void>;
  /** Create a new session for a project via POST /api/projects/:id/sessions. */
  createSession: (projectId: string, dims?: { cols: number; rows: number }) => Promise<SessionItem>;
}

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);

/* ── Helpers ── */

/**
 * Validate that a project id is usable for API calls. Skips falsy,
 * non-string, empty-string, and the literal strings "undefined"/"null"
 * that can leak from JSON serialization bugs or corrupted responses.
 */
function isValidProjectId(id: unknown): id is string {
  if (!id || typeof id !== 'string' || id === 'undefined' || id === 'null') {
    return false;
  }
  return id.trim().length > 0;
}

/* ── Hook ── */

export function useSessions(): UseSessionsReturn {
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);
  const initializedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      // Only show loading spinner on the very first fetch, not on poll cycles
      if (!initializedRef.current) setLoading(true);
      setError(null);

      // Fetch all projects first.
      const projects = await apiFetch<ProjectItem[]>('/api/projects');
      const safeProjects: ProjectItem[] = Array.isArray(projects) ? projects : [];

      // Fetch sessions for each project in parallel — skip projects with
      // invalid ids to avoid 404s on `/api/projects/undefined/sessions`.
      const results = await Promise.allSettled(
        safeProjects.flatMap((project) => {
          if (!isValidProjectId(project.id)) {
            console.warn('[useSessions] skipping project with invalid id:', project);
            return [];
          }
          return [
            (async () => {
              const sessions = await apiFetch<SessionItem[]>(
                `/api/projects/${project.id}/sessions`,
              );
              return {
                project,
                sessions: Array.isArray(sessions)
                  ? sessions.filter((s) => !DEAD_STATUSES.has(s.status))
                  : [],
              };
            })(),
          ];
        }),
      );

      const loaded: SessionGroup[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          loaded.push(result.value);
        }
        // If a single project's sessions fail to load, we skip it rather
        // than breaking the entire sidebar. The user can still see other
        // projects.
      }

      setGroups(loaded);
      initializedRef.current = true;
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchAll();

    // Poll every 10 s so the sidebar stays in sync with external changes
    // (sessions created/closed from ProjectDetail, session exits, etc.).
    const interval = setInterval(fetchAll, 10_000);

    // Also respond immediately when any component dispatches the
    // 'sessions-changed' custom event (create / close from ProjectDetail).
    const handleChanged = () => {
      fetchAll();
    };
    window.addEventListener('sessions-changed', handleChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('sessions-changed', handleChanged);
    };
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll();
  }, [fetchAll]);

  const renameSession = useCallback(
    async (sessionId: string, name: string): Promise<SessionItem> => {
      const updated = await apiFetch<SessionItem>(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      // Optimistically update local state.
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          sessions: g.sessions.map((s) =>
            s.sessionId === sessionId ? { ...s, name: updated.name } : s,
          ),
        })),
      );
      return updated;
    },
    [],
  );

  const closeSession = useCallback(async (sessionId: string) => {
    await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    // Remove the session from local state.
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        sessions: g.sessions.filter((s) => s.sessionId !== sessionId),
      })),
    );
  }, []);

  const createSession = useCallback(async (projectId: string, dims?: { cols: number; rows: number }): Promise<SessionItem> => {
    const created = await apiFetch<SessionItem>(`/api/projects/${projectId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(dims ?? {}),
    });
    // Add the new session to local state (only if not already dead, which shouldn't happen).
    if (!DEAD_STATUSES.has(created.status)) {
      setGroups((prev) =>
        prev.map((g) =>
          g.project.id === projectId ? { ...g, sessions: [...g.sessions, created] } : g,
        ),
      );
    }
    return created;
  }, []);

  return {
    groups,
    loading,
    error,
    refresh,
    renameSession,
    closeSession,
    createSession,
  };
}
