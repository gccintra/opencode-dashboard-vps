/**
 * Sessions REST API.
 *
 * The PTY Manager (`getPtyManager()`) tracks runtime state (pid, cwd,
 * buffer, callbacks) for active sessions. It does NOT track session
 * metadata like name or projectId — those live in this module's
 * in-memory `Map<sessionId, SessionMeta>` so the sessions routes can
 * return a stable, project-scoped list without touching the manager.
 *
 * Persistence is intentionally NOT in scope for Sprint 2: session
 * metadata is in-memory only and resets on server restart. SQLite
 * persistence will be added in a later sprint if needed.
 *
 * Multi-session design (per Task 02):
 *  - POST /api/projects/:id/sessions ALWAYS creates a new session.
 *  - Default name is "Sessão N" (sequential per project).
 *  - Body may override the name.
 *  - Spawning `opencode` is the preferred path; if the worker reports
 *    an error (e.g. ENOENT because `opencode` is not installed on the
 *    host), the handler falls back to plain `bash` so the terminal
 *    still works for ad-hoc operations.
 *
 * All routes are protected by `authGuard` (JWT bearer required).
 */

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getPtyManager } from '../pty/manager';
import { detectStatus, getLastActiveAt } from '../pty/detector';
import { getActiveResourcesForProject } from './resources';
import { getDb } from '../db/client';
import { existsSync } from 'node:fs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Public session metadata shape returned by the routes. */
export interface SessionMeta {
  sessionId: string;
  projectId: string | null;
  name: string;
  status: string;
  type?: 'project' | 'emergency';
  createdAt: number;
}

/** In-memory store of session metadata. Reset on server restart. */
const sessionMeta = new Map<string, SessionMeta>();

/**
 * Compute the next sequential session name for a project.
 *
 * Scans `sessionMeta` for entries belonging to `projectId` whose name
 * matches the "Sessão N" pattern and returns the next number. If a
 * session was created with a custom name (e.g. "Sessão Especial"),
 * it does NOT affect the counter.
 */
function nextSessionName(projectId: string): string {
  let maxN = 0;
  for (const s of sessionMeta.values()) {
    if (s.projectId === projectId) {
      const match = s.name.match(/^Sessão (\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  return `Sessão ${maxN + 1}`;
}

/**
 * Test helper: clear the in-memory store.
 */
export function resetSessionMeta(): void {
  sessionMeta.clear();
}

/**
 * Restore session metadata from SQLite into the in-memory Map.
 * Called once at server boot after initDb(). Sessions that were
 * active when the server last stopped are marked 'exited' since
 * their PTY processes no longer exist.
 */
export function loadSessionsFromDb(): void {
  try {
    const db = getDb();
    const rows = db
      .query('SELECT id, project_id, name, status, type, created_at FROM sessions')
      .all() as DbRow[];
    const staleIds: string[] = [];
    for (const row of rows) {
      const wasTerminal = row.status === 'exited' || row.status === 'killed';
      const effectiveStatus = wasTerminal ? (row.status as string) : 'exited';
      sessionMeta.set(row.id as string, {
        sessionId: row.id as string,
        projectId: (row.project_id as string | null) ?? null,
        name: row.name as string,
        status: effectiveStatus,
        type: (row.type as 'project' | 'emergency') ?? 'project',
        createdAt: row.created_at as number,
      });
      if (!wasTerminal) staleIds.push(row.id as string);
    }
    // Sync DB: mark sessions that were mid-flight when the server stopped
    if (staleIds.length > 0) {
      const placeholders = staleIds.map(() => '?').join(',');
      db.run(`UPDATE sessions SET status = 'exited' WHERE id IN (${placeholders})`, staleIds);
    }
    if (rows.length > 0) {
      console.log(`[sessions] recovered ${rows.length} sessions from db (${staleIds.length} marked exited)`);
    }
  } catch (err) {
    console.warn('[sessions] failed to load sessions from db:', (err as Error).message);
  }
}

/**
 * Return all session metadata entries. Used by the agents panel API
 * to list sessions across all projects.
 */
export function getAllSessionMeta(): SessionMeta[] {
  return Array.from(sessionMeta.values());
}

/**
 * Return a single session metadata entry by id, or undefined.
 */
export function getSessionMetaById(sessionId: string): SessionMeta | undefined {
  return sessionMeta.get(sessionId);
}

/**
 * Return all session metadata entries belonging to a given project.
 * Reuses the single in-memory source of truth — does NOT duplicate state.
 */
export function getSessionMetaByProject(projectId: string): SessionMeta[] {
  return Array.from(sessionMeta.values()).filter((s) => s.projectId === projectId);
}

/**
 * Test helper: inject session metadata directly (for test setup).
 */
export function setSessionMeta(sessionId: string, meta: SessionMeta): void {
  sessionMeta.set(sessionId, meta);
}

export const sessionsRoutes = new Elysia().guard(authGuard, (app) =>
  app
    // ── POST /api/projects/:id/sessions ────────────────────────
    // Multi-session: always creates a new session. NEVER returns
    // an existing one. Returns 201 with the new session metadata.
    .post(
      '/api/projects/:id/sessions',
      async ({ params, body, set }) => {
        try {
          const projectId = params.id;
          console.error(`[sessions] POST /api/projects/${projectId}/sessions received`);
          const db = getDb();

          // 1. Verify the project exists in the DB.
          const project = db
            .query('SELECT * FROM projects WHERE id = ?')
            .get(projectId) as DbRow | null;
          if (!project) {
            set.status = 404;
            return { error: 'Project not found' };
          }

          // 2. Verify the project directory still exists on disk.
          //    A project can become stale if its directory was removed
          //    between when the project was registered and now.
          const directory = project.directory as string;
          if (!existsSync(directory)) {
            set.status = 400;
            return { error: 'Project directory does not exist' };
          }

          // 3. Soft limits: log a warning (never block) when the
          //    total number of active sessions exceeds thresholds.
          {
            let totalActive = 0;
            let projectActive = 0;
            const TERMINAL_STATUSES = new Set(['exited', 'killed']);
            for (const s of sessionMeta.values()) {
              if (!TERMINAL_STATUSES.has(s.status)) {
                totalActive += 1;
                if (s.projectId === projectId) projectActive += 1;
              }
            }
            if (totalActive > 10) {
              console.warn(`[sessions] soft limit: ${totalActive} total active sessions (>10)`);
            }
            if (projectActive > 5) {
              console.warn(
                `[sessions] soft limit: ${projectActive} active sessions in project ${projectId} (>5)`,
              );
            }
          }

          // 4. Generate session id and name. A custom name from the
          //    body wins over the auto-incremented "Sessão N".
          const sessionId = crypto.randomUUID();
          const name =
            body?.name?.trim() && body.name.trim().length > 0
              ? body.name.trim()
              : nextSessionName(projectId);

          // 4. Reserve the metadata slot BEFORE spawning. If the
          //    spawn fails, the slot is rolled back in the catch.
          const createdAt = Date.now();
          sessionMeta.set(sessionId, {
            sessionId,
            projectId,
            name,
            status: 'active',
            type: 'project',
            createdAt,
          });
          db.run(
            'INSERT OR REPLACE INTO sessions (id, project_id, name, status, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [sessionId, projectId, name, 'active', 'project', createdAt],
          );

          // 5. Query active resources for this project and build env vars.
          //    Only resources that exist in the cache (available) are passed.
          //    Unavailable resources are logged and skipped.
          let extraEnv: Record<string, string> | undefined;
          try {
            const active = getActiveResourcesForProject(projectId);
            if (active.skills.length > 0)
              (extraEnv ??= {})['OPENCODE_ACTIVE_SKILLS'] = active.skills.join(',');
            if (active.agents.length > 0)
              (extraEnv ??= {})['OPENCODE_ACTIVE_AGENTS'] = active.agents.join(',');
            if (active.mcps.length > 0)
              (extraEnv ??= {})['OPENCODE_ACTIVE_MCPS'] = active.mcps.join(',');
          } catch (err) {
            // Resource scan may not have been run yet or DB query failed.
            // This is non-fatal — the session still works with all resources.
            console.warn('[sessions] failed to resolve active resources:', (err as Error).message);
          }

          // 6. Spawn the PTY wrapped in bash.
          //
          //    We always launch `bash -c 'opencode; exec bash'` rather than
          //    spawning opencode directly. This has two benefits:
          //
          //    a) Ctrl+C sends SIGINT to opencode, which exits cleanly. The
          //       subsequent `exec bash` replaces the subshell with an
          //       interactive bash, keeping the PTY and the session alive so
          //       the user can continue working in the terminal.
          //
          //    b) If opencode is not installed on the host, the shell simply
          //       prints "command not found" and drops the user into bash —
          //       the session is still usable without a hard error.
          const cols = typeof body?.cols === 'number' && body.cols > 0 ? body.cols : 120;
          const rows = typeof body?.rows === 'number' && body.rows > 0 ? body.rows : 35;

          const manager = getPtyManager();

          // Spawn args extracted so the auto-respawn closure can reuse them.
          //
          // IMPORTANT: spawn only `bash` (not `bash -c 'claude; ...'`).
          // The hedge system creates 3 parallel PTYs to survive the Linux PTY
          // SIGHUP race. If the spawn command includes `claude`, all 3 hedges
          // start claude in the same project directory simultaneously — they
          // compete for claude's per-project lock/local-server, causing the
          // winner's claude to detect the conflict and exit cleanly (code=0).
          // Instead, spawn a bare bash shell, then write the initial command
          // to the PTY *after* the winner hedge is confirmed alive. This
          // guarantees only ONE claude instance ever starts per session.
          const spawnCommand = 'pty-sighup-exec';
          const spawnArgs = ['bash'];
          // The command written to the winner's PTY after successful spawn.
          const initialCmd = 'claude; exec zsh 2>&1 || exec bash\n';

          try {
            await manager.spawnSession(
              sessionId,
              directory,
              // pty-sighup-exec sets SIGHUP=SIG_IGN via sigaction() BEFORE exec-ing
              // bash. SIG_IGN is inherited across all fork/exec descendants (POSIX
              // guarantee), so claude, zsh, and the fallback bash are all immune
              // from the very first instruction — zero race window vs the ~2ms
              // window that `trap "" HUP` inside bash has (bash must start up and
              // parse the script before trap takes effect). This eliminates the
              // Linux PTY SIGHUP race where a stale SIGHUP queued by close(master_fd)
              // hits the new session's pgrp when the kernel reuses the same /dev/pts/N.
              // Binary compiled from apps/pty-worker/src/pty-sighup-exec.c and
              // installed at /usr/local/bin/pty-sighup-exec.
              spawnCommand,
              spawnArgs,
              extraEnv,
              cols,
              rows,
            );
            // Start claude in the winner's shell. Writing to the PTY stdin
            // buffers the command for bash to execute as soon as it's ready.
            // This runs AFTER the 1000ms hedge settle, so bash is confirmed alive.
            manager.writeToSession(sessionId, initialCmd);
          } catch (spawnErr) {
            sessionMeta.delete(sessionId);
            db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
            set.status = 500;
            return {
              error: `Failed to spawn session: ${(spawnErr as Error).message}`,
            };
          }

          // 7. Wire the exit callback with transparent auto-respawn.
          //
          //    When the PTY process dies within RESPAWN_THRESHOLD_MS of being
          //    spawned, we assume it was a victim of the SIGHUP kernel race and
          //    automatically re-spawn under the same sessionId. The browser's
          //    WebSocket reconnect logic (exponential back-off, up to 10 attempts)
          //    handles the brief gap between exit and respawn transparently.
          //
          //    Auto-respawn is limited to MAX_AUTORESPAWNS attempts so a truly
          //    broken command doesn't loop forever.
          const RESPAWN_THRESHOLD_MS = 6_000;
          const MAX_AUTORESPAWNS = 4;
          let autoRespawnCount = 0;
          let lastSpawnedAt = Date.now();

          const registerExitCallback = () => {
            manager.onSessionExit(sessionId, async (code) => {
              const aliveMs = Date.now() - lastSpawnedAt;
              const m = sessionMeta.get(sessionId);

              if (aliveMs < RESPAWN_THRESHOLD_MS && autoRespawnCount < MAX_AUTORESPAWNS && m) {
                autoRespawnCount++;
                console.error(
                  `[sessions] auto-respawn ${autoRespawnCount}/${MAX_AUTORESPAWNS} for ${sessionId} (lived ${aliveMs}ms code=${code})`,
                );
                m.status = 'active'; // keep session visible while respawning

                // Brief pause so pending kernel SIGHUPs drain before the next spawn.
                await new Promise<void>((r) => setTimeout(r, 2_000));

                try {
                  lastSpawnedAt = Date.now();
                  await manager.spawnSession(
                    sessionId,
                    directory,
                    spawnCommand,
                    spawnArgs,
                    extraEnv,
                    cols,
                    rows,
                  );
                  // Same as initial spawn: write command after winner is confirmed.
                  manager.writeToSession(sessionId, initialCmd);
                  registerExitCallback(); // wire for the new process
                  console.error(`[sessions] auto-respawn ${autoRespawnCount} succeeded for ${sessionId}`);
                } catch (respawnErr) {
                  console.error(
                    `[sessions] auto-respawn ${autoRespawnCount} failed for ${sessionId}: ${(respawnErr as Error).message}`,
                  );
                  if (m) m.status = 'exited';
                  try { getDb().run("UPDATE sessions SET status = 'exited' WHERE id = ?", [sessionId]); } catch { /* non-fatal */ }
                }
              } else {
                // Normal exit (lived long enough) or retries exhausted.
                if (m) m.status = 'exited';
                try {
                  getDb().run("UPDATE sessions SET status = 'exited' WHERE id = ?", [sessionId]);
                } catch { /* non-fatal */ }
                void code;
              }
            });
          };

          registerExitCallback();

          set.status = 201;
          return sessionMeta.get(sessionId)!;
        } catch (err) {
          set.status = 500;
          return { error: (err as Error).message };
        }
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          cols: t.Optional(t.Number()),
          rows: t.Optional(t.Number()),
        }),
      },
    )

    // ── GET /api/projects/:id/sessions ─────────────────────────
    // Returns all sessions for a project (active + exited) so the
    // UI can show historical sessions that may still have buffer
    // state in the PTY Manager (for reconnection).
    // Optional query param `?status=active` filters to only
    // sessions whose status is NOT exited/killed.
    .get('/api/projects/:id/sessions', ({ params, query, set }) => {
      try {
        const projectId = params.id;
        const db = getDb();

        const project = db
          .query('SELECT id FROM projects WHERE id = ?')
          .get(projectId) as DbRow | null;
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }

        const statusFilter = (query as { status?: string }).status;
        const manager = getPtyManager();

        const sessions: Array<{
          sessionId: string;
          name: string;
          status: string;
          createdAt: number;
        }> = [];

        for (const s of sessionMeta.values()) {
          if (s.projectId !== projectId) continue;

          // Compute the semantically-detected status for live sessions so the
          // UI can show accurate `active` / `waiting` / `finished` labels
          // instead of the raw `active` stored in sessionMeta (which is never
          // updated to reflect waiting vs running state).
          let detectedStatus: string;
          if (s.status === 'exited' || s.status === 'killed') {
            detectedStatus = 'finished';
          } else {
            const ptyStatus = manager.getSessionStatus(s.sessionId);
            if (!ptyStatus) {
              // PTY process has been cleaned up — treat as finished.
              detectedStatus = 'finished';
            } else {
              const buffer = manager.getSessionBuffer(s.sessionId);
              detectedStatus = detectStatus({ status: ptyStatus, buffer });
            }
          }

          if (statusFilter === 'active' && detectedStatus === 'finished') continue;

          sessions.push({
            sessionId: s.sessionId,
            name: s.name,
            status: detectedStatus,
            createdAt: s.createdAt,
          });
        }
        return sessions;
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    })

    // ── PUT /api/sessions/:id (rename) ──────────────────────────
    .put(
      '/api/sessions/:id',
      ({ params, body, set }) => {
        const sessionId = params.id;
        const meta = sessionMeta.get(sessionId);
        if (!meta) {
          set.status = 404;
          return { error: 'Session not found' };
        }
        const { name } = body;
        if (!name || name.trim().length === 0) {
          set.status = 400;
          return { error: 'Name cannot be empty' };
        }
        meta.name = name.trim();
        try {
          getDb().run('UPDATE sessions SET name = ? WHERE id = ?', [meta.name, sessionId]);
        } catch {
          // non-fatal
        }
        return meta;
      },
      {
        body: t.Object({
          name: t.String(),
        }),
      },
    )

    // ── GET /api/sessions/:id/status ──────────────────────────
    // Returns the semantically-detected status of a session plus
    // the lastActiveAt timestamp. Uses the detector module to
    // differentiate between 'active', 'waiting', and 'finished'.
    .get('/api/sessions/:id/status', ({ params, set }) => {
      const sessionId = params.id;
      const meta = sessionMeta.get(sessionId);
      if (!meta) {
        set.status = 404;
        return { error: 'Session not found' };
      }

      const manager = getPtyManager();
      const ptyStatus = manager.getSessionStatus(sessionId);
      if (!ptyStatus) {
        // Session exists in metadata but not in PtyManager — the
        // PTY has been cleaned up (likely killed). Treat as finished.
        return {
          status: 'finished',
          lastActiveAt: meta.createdAt,
        };
      }

      // Use the session's buffer + raw status to detect semantic status.
      const buffer = manager.getSessionBuffer(sessionId);
      const detected = detectStatus({ status: ptyStatus, buffer });
      const lastActiveAt = getLastActiveAt({
        createdAt: meta.createdAt,
        dataAt: undefined, // Manager doesn't expose dataAt publicly — use meta.createdAt fallback
      });

      return { status: detected, lastActiveAt };
    })

    // ── POST /api/sessions/:id/resize ──────────────────────────
    // Propagates terminal resize events from the frontend down to
    // the PTY so the child process (opencode/bash) receives SIGWINCH
    // and can re-render its TUI at the new dimensions.
    .post(
      '/api/sessions/:id/resize',
      ({ params, body, set }) => {
        const sessionId = params.id;
        if (!sessionMeta.has(sessionId)) {
          set.status = 404;
          return { error: 'Session not found' };
        }
        const { cols, rows } = body;
        if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 1 || rows < 1) {
          set.status = 400;
          return { error: 'cols and rows must be positive numbers' };
        }
        console.error(`[sessions] resize request: ${sessionId} -> ${cols}x${rows}`);
        try {
          getPtyManager().resizeSession(sessionId, cols, rows);
        } catch (err) {
          set.status = 500;
          return { error: (err as Error).message };
        }
        return { success: true };
      },
      {
        body: t.Object({
          cols: t.Number(),
          rows: t.Number(),
        }),
      },
    )

    // ── POST /api/emergency-terminal ────────────────────────────
    // Creates a special emergency root terminal session.
    // Only 1 emergency session may exist at a time.
    // Sessions have projectId=null, type='emergency', cwd='/root'.
    .post('/api/emergency-terminal', async ({ set }) => {
      try {
        // Check for existing live emergency session.
        for (const s of sessionMeta.values()) {
          if (s.type === 'emergency') {
            // Only reuse if the PTY process is still running.
            const ptyStatus = getPtyManager().getSessionStatus(s.sessionId);
            if (ptyStatus && ptyStatus !== 'exited' && ptyStatus !== 'killed') {
              set.status = 200;
              return s;
            }
            // PTY is dead — remove the stale entry so we can create a fresh session.
            sessionMeta.delete(s.sessionId);
            try {
              getDb().run('DELETE FROM sessions WHERE id = ?', [s.sessionId]);
            } catch { /* non-fatal */ }
            break;
          }
        }

        const sessionId = crypto.randomUUID();
        const name = 'Emergency Terminal';
        const emergencyCreatedAt = Date.now();

        // Reserve metadata BEFORE spawning.
        sessionMeta.set(sessionId, {
          sessionId,
          projectId: null,
          name,
          status: 'active',
          type: 'emergency',
          createdAt: emergencyCreatedAt,
        });
        try {
          getDb().run(
            'INSERT OR REPLACE INTO sessions (id, project_id, name, status, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [sessionId, null, name, 'active', 'emergency', emergencyCreatedAt],
          );
        } catch {
          // non-fatal
        }

        const manager = getPtyManager();
        try {
          await manager.spawnSession(sessionId, '/root', 'bash', [], undefined, 120, 35);
        } catch (err) {
          sessionMeta.delete(sessionId);
          try {
            getDb().run('DELETE FROM sessions WHERE id = ?', [sessionId]);
          } catch {
            // non-fatal
          }
          set.status = 500;
          return {
            error: `Failed to spawn emergency terminal: ${(err as Error).message}`,
          };
        }

        // Wire exit callback.
        manager.onSessionExit(sessionId, (code) => {
          const m = sessionMeta.get(sessionId);
          if (m) m.status = 'exited';
          try {
            getDb().run("UPDATE sessions SET status = 'exited' WHERE id = ?", [sessionId]);
          } catch {
            // non-fatal
          }
          void code;
        });

        set.status = 201;
        return sessionMeta.get(sessionId)!;
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    })

    // ── GET /api/projects/stats ────────────────────────────────
    // Returns per-project session counts (active, waiting, finished).
    .get('/api/projects/stats', () => {
      const byProject: Record<string, { active: number; waiting: number; finished: number }> = {};

      for (const s of sessionMeta.values()) {
        if (s.projectId === null) continue;
        const entry = (byProject[s.projectId] ??= { active: 0, waiting: 0, finished: 0 });

        if (s.status === 'exited' || s.status === 'killed') {
          entry.finished += 1;
        } else if (s.status === 'waiting') {
          entry.waiting += 1;
        } else {
          entry.active += 1;
        }
      }

      return byProject;
    })

    // ── DELETE /api/projects/:id/sessions/finished ────────────
    // Bulk-removes all finished (exited/killed) sessions for a project.
    // Dead sessions have no live PTY — no kill is needed, just metadata
    // and DB cleanup. Returns the count of sessions removed.
    .delete('/api/projects/:id/sessions/finished', ({ params, set }) => {
      try {
        const projectId = params.id;
        const db = getDb();
        const project = db.query('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | null;
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }

        const TERMINAL_STATUSES = new Set(['exited', 'killed', 'finished']);
        const toRemove: string[] = [];
        for (const s of sessionMeta.values()) {
          if (s.projectId === projectId && TERMINAL_STATUSES.has(s.status)) {
            toRemove.push(s.sessionId);
          }
        }

        for (const id of toRemove) {
          sessionMeta.delete(id);
        }

        if (toRemove.length > 0) {
          const placeholders = toRemove.map(() => '?').join(',');
          try {
            db.run(`DELETE FROM sessions WHERE id IN (${placeholders})`, toRemove);
          } catch {
            // non-fatal
          }
        }

        return { removed: toRemove.length };
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    })

    // ── DELETE /api/sessions/:id ───────────────────────────────
    // Kills the PTY (if still running) and removes all metadata.
    // Idempotent: finished/missing PTY sessions are cleaned from DB and succeed.
    .delete('/api/sessions/:id', async ({ params, set }) => {
      try {
        const sessionId = params.id;

        // Verify the session exists at all (memory or DB).
        if (!sessionMeta.has(sessionId)) {
          const row = getDb().query('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | null;
          if (!row) {
            set.status = 404;
            return { error: 'Session not found' };
          }
          // Known to DB but not in memory — PTY is already gone, just clean up.
          getDb().run('DELETE FROM sessions WHERE id = ?', [sessionId]);
          return { success: true };
        }

        // Attempt to kill the live PTY. If the PTY process has already exited
        // (session is 'finished'), killSession throws "session not found: id".
        // In that case we still clean up metadata — the goal is removal.
        try {
          await getPtyManager().killSession(sessionId);
        } catch (killErr) {
          const msg = (killErr as Error).message ?? '';
          if (!msg.includes('session not found')) {
            // Unexpected error — surface it.
            set.status = 500;
            return { error: msg };
          }
          // PTY already dead — fall through to cleanup.
        }

        sessionMeta.delete(sessionId);
        try {
          getDb().run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        } catch {
          // non-fatal
        }
        return { success: true };
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    }),
);
