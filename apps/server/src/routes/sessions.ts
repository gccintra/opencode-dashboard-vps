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
import { buildTmuxSpawnArgs, tmuxKillSession, tmuxListSessions, tmuxHasSession } from '../pty/tmux';
import { getActiveResourcesForProject } from './resources';
import { getDb } from '../db/client';
import { existsSync } from 'node:fs';
import { broadcastSessionEvent } from '../ws/events';

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

/** Single-quote a string for safe inclusion in a bash command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the CLI launch command written to the PTY after spawn. Configures the
 * chosen runtime (opencode/claude) with `--agent` and `--model` flags.
 *
 * Claude "commands" are NOT agents — they are slash-commands injected together
 * with the prompt later (see tasks.ts implement), so they never produce a
 * `--agent` flag here. opencode resources are always agents.
 *
 * `exec zsh` keeps the PTY alive after the CLI exits (falls back to bash).
 */
export function buildCliCommand(opts: {
  agentType?: 'opencode' | 'claude';
  model?: string;
  agent?: string;
  agentSource?: 'agents' | 'commands';
  effort?: string;
  resumeConversationId?: string;
}): string {
  const runtime = opts.agentType === 'opencode' ? 'opencode' : 'claude';
  const parts: string[] = [runtime];

  const agent = opts.agent?.trim();
  const useAgentFlag = !!agent && (runtime === 'opencode' || opts.agentSource === 'agents');
  if (useAgentFlag) {
    parts.push('--agent', shellQuote(agent!));
  }

  const model = opts.model?.trim();
  if (model) {
    parts.push('--model', shellQuote(model));
  }

  // Reasoning effort flag differs per runtime: claude uses `--effort <level>`,
  // opencode uses `--variant <level>` (provider-specific reasoning effort).
  const effort = opts.effort?.trim();
  if (effort) {
    parts.push(runtime === 'opencode' ? '--variant' : '--effort', shellQuote(effort));
  }

  // Resume: claude uses --resume <uuid>; opencode uses --session <ses_id>.
  const resumeConversationId = opts.resumeConversationId?.trim();
  if (resumeConversationId) {
    if (runtime === 'claude') {
      parts.push('--resume', shellQuote(resumeConversationId));
    } else {
      parts.push('--session', shellQuote(resumeConversationId));
    }
  }

  return `${parts.join(' ')}; exec zsh 2>&1 || exec bash\n`;
}

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
 * Called once at server boot after initDb(). Non-terminal sessions are
 * tentatively marked 'exited' because no attach client exists yet at this
 * instant — {@link reconcileTmuxSessions} runs immediately after and REVIVES
 * any whose tmux session is still alive in the daemon.
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
      console.log(
        `[sessions] recovered ${rows.length} sessions from db (${staleIds.length} marked exited)`,
      );
    }
  } catch (err) {
    console.warn('[sessions] failed to load sessions from db:', (err as Error).message);
  }
}

/**
 * Wire the exit callback for a session: mark its metadata + DB row exited when
 * the PTY (tmux attach client + its inner session) dies. Shared by the create,
 * emergency, and boot-reconcile paths so the behavior stays identical.
 */
function wireSessionExit(sessionId: string): void {
  getPtyManager().onSessionExit(sessionId, (code) => {
    const m = sessionMeta.get(sessionId);
    if (m) m.status = 'exited';
    try {
      getDb().run("UPDATE sessions SET status = 'exited' WHERE id = ?", [sessionId]);
    } catch {
      /* non-fatal */
    }
    // Notify every connected events client so lists update without polling.
    broadcastSessionEvent({ action: 'exited', sessionId });
    void code;
  });
}

/**
 * Run a spawn, retrying once if the pty-worker was bouncing when the request
 * landed. When the worker dies/restarts, the manager rejects every in-flight
 * request (`worker exited unexpectedly`) and a spawn that raced the restart
 * would otherwise become a "born dead" session. The worker respawns within a
 * few hundred ms; `tmux new-session -A` is idempotent (re-attaches if the first
 * attempt reached a now-dead worker, starts fresh otherwise), so the retry is
 * safe and never duplicates a session.
 *
 * @param attempt  thunk that performs one spawnSession call
 */
async function spawnWithRetry(attempt: () => Promise<number>): Promise<number> {
  // Backoff delays (ms) between successive retries. Long enough for the
  // CPU-spin watchdog (2 × 1000ms samples) to detect, kill, and restart
  // the worker before the next attempt lands.
  const delays = [2000, 3000, 3000];
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await attempt();
    } catch (err) {
      const msg = (err as Error).message || '';
      const transient =
        msg.includes('worker exited') ||
        msg.includes('spawn timeout') ||
        msg.includes('manager shut down') ||
        msg.includes('transport not started') ||
        // tmux exits code=1 when spawned from a CPU-spinning worker (node-pty
        // EAGAIN bug corrupts the PTY for new children). Treat as transient so
        // we wait for the watchdog to kill+restart the worker before retrying.
        msg.includes('process exited before spawn completed');
      if (!transient) throw err;
      lastErr = err;
      if (i < delays.length) {
        console.warn(
          `[sessions] spawn raced a worker restart (${msg}); retrying in ${delays[i]}ms (attempt ${i + 1}/${delays.length})`,
        );
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }
  throw lastErr;
}

/**
 * Reconcile in-memory/DB session metadata with the live tmux daemon at boot.
 *
 * tmux sessions outlive the server, so after a restart the processes are still
 * running even though `loadSessionsFromDb` just marked every non-terminal
 * session 'exited' (no attach clients exist yet at that instant). This:
 *
 *  1. RE-ADOPTS each live tmux session that has known metadata — spawning a
 *     fresh attach client and flipping the status back to 'active'. The session
 *     becomes immediately usable again (the WS reconnects on its own).
 *  2. KILLS orphan tmux sessions that have no metadata (cleanup).
 *
 * Best-effort and idempotent: failures are logged, never fatal.
 */
export async function reconcileTmuxSessions(): Promise<void> {
  let liveIds: string[];
  try {
    liveIds = await tmuxListSessions();
  } catch (err) {
    console.warn('[sessions] tmux reconcile skipped:', (err as Error).message);
    return;
  }
  if (liveIds.length === 0) return;

  const db = getDb();
  const manager = getPtyManager();
  let readopted = 0;
  let orphansKilled = 0;

  for (const sessionId of liveIds) {
    const meta = sessionMeta.get(sessionId);
    if (!meta) {
      // Orphan tmux session — no metadata to attach it to. Reap it.
      await tmuxKillSession(sessionId);
      orphansKilled += 1;
      continue;
    }

    // Resolve the working directory: project dir for project sessions, /root
    // for the emergency terminal.
    let cwd = '/root';
    if (meta.projectId) {
      try {
        const project = db
          .query('SELECT directory FROM projects WHERE id = ?')
          .get(meta.projectId) as { directory?: string } | null;
        if (project?.directory && existsSync(project.directory)) cwd = project.directory;
      } catch {
        /* fall back to /root */
      }
    }

    try {
      // `new-session -A` attaches to the existing session (innerCmd ignored).
      await manager.spawnSession(
        sessionId,
        cwd,
        'tmux',
        buildTmuxSpawnArgs(sessionId, 120, 35),
        undefined,
        120,
        35,
      );
      wireSessionExit(sessionId);
      meta.status = 'active';
      try {
        db.run("UPDATE sessions SET status = 'active' WHERE id = ?", [sessionId]);
      } catch {
        /* non-fatal */
      }
      readopted += 1;
    } catch (err) {
      console.warn(
        `[sessions] failed to re-adopt tmux session ${sessionId}:`,
        (err as Error).message,
      );
    }
  }

  console.log(
    `[sessions] tmux reconcile: re-adopted ${readopted}, killed ${orphansKilled} orphan(s)`,
  );
}

/** Resolve a session's working directory: project dir if valid, else /root. */
function resolveSessionCwd(meta: SessionMeta): string {
  if (!meta.projectId) return '/root';
  try {
    const project = getDb()
      .query('SELECT directory FROM projects WHERE id = ?')
      .get(meta.projectId) as { directory?: string } | null;
    if (project?.directory && existsSync(project.directory)) return project.directory;
  } catch {
    /* fall back */
  }
  return '/root';
}

/**
 * Ensure a session has a LIVE attach client, reviving it if its tmux session
 * outlived the client (the "born dead" / stranded case: the attach client died
 * — e.g. a resize EBADF or a worker SIGKILL — but claude/opencode is still
 * running in the tmux daemon). This is the backbone of seamless recovery:
 * the WS layer calls it on connect, so a stranded session is reattached and
 * streams again with no user action.
 *
 * @returns true if the session is (now) attached and usable; false if it is
 *          genuinely gone (no metadata, or no live tmux session).
 */
export async function ensureSessionAttached(sessionId: string): Promise<boolean> {
  const manager = getPtyManager();
  const status = manager.getSessionStatus(sessionId);
  if (status === 'active' || status === 'pending') return true; // already attached

  const meta = sessionMeta.get(sessionId);
  if (!meta) return false; // unknown session
  if (!(await tmuxHasSession(sessionId))) return false; // tmux gone → truly dead

  // tmux is alive but there's no live attach client — reattach. spawnSession
  // clears any stale 'exited' SessionState and re-runs `tmux new-session -A`,
  // which idempotently attaches to the existing session (claude keeps running).
  try {
    await spawnWithRetry(() =>
      manager.spawnSession(
        sessionId,
        resolveSessionCwd(meta),
        'tmux',
        buildTmuxSpawnArgs(sessionId, 120, 35),
        undefined,
        120,
        35,
      ),
    );
  } catch (err) {
    // A concurrent revive may have already re-attached it — treat that as success.
    if (manager.getSessionStatus(sessionId) === 'active') return true;
    console.warn(
      `[sessions] ensureSessionAttached failed for ${sessionId}:`,
      (err as Error).message,
    );
    return false;
  }
  wireSessionExit(sessionId);
  meta.status = 'active';
  try {
    getDb().run("UPDATE sessions SET status = 'active' WHERE id = ?", [sessionId]);
  } catch {
    /* non-fatal */
  }
  return true;
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

          // The CLI command run INSIDE the tmux session. agentType 'opencode'
          // → opencode CLI; default (claude/undefined) → claude CLI. Configured
          // with the selected agent (--agent), LLM (--model), and effort. Ends
          // with `exec zsh || exec bash` so the tmux session stays alive (drops
          // to a shell) when the CLI exits.
          const initialCmd = buildCliCommand({
            agentType: body?.agentType,
            model: body?.model,
            agent: body?.agent,
            agentSource: body?.agentSource,
            effort: body?.effort,
            resumeConversationId: body?.resumeConversationId,
          });

          // tmux-backed spawn: control mode runs a `tmux -C new-session -A`
          // control client; the real processes live in the tmux daemon and
          // survive the server being killed. `command` is ignored by the
          // control transport (it derives the binary from args[0] === 'tmux').
          // The TUI launches at the requested cols×rows; tmux repaints on the
          // client's first resize, so no deferred-launch arming is needed.
          const spawnCommand = 'tmux';
          const spawnArgs = buildTmuxSpawnArgs(sessionId, cols, rows, initialCmd, extraEnv);

          // Spawn with one retry. A spawn that lands while the pty-worker is
          // bouncing (a tsx --watch reload in dev, or the CPU-spin self-heal
          // restart) gets its in-flight request rejected by rejectAllPending,
          // which would otherwise surface as a "born dead" session. The worker
          // respawns within a few hundred ms; `tmux new-session -A` is
          // idempotent, so a retry safely re-attaches if the first attempt did
          // reach a now-dead worker, or starts fresh if it never did.
          try {
            await spawnWithRetry(() =>
              manager.spawnSession(
                sessionId,
                directory,
                spawnCommand,
                spawnArgs,
                extraEnv,
                cols,
                rows,
              ),
            );
          } catch (spawnErr) {
            sessionMeta.delete(sessionId);
            db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
            // Reap any orphan tmux session: `new-session -A` may have created
            // the session in the daemon before the attach client died, which
            // would otherwise leave a detached session running forever.
            void tmuxKillSession(sessionId);
            set.status = 500;
            return {
              error: `Failed to spawn session: ${(spawnErr as Error).message}`,
            };
          }

          // 7. Wire the exit callback: mark the session exited when the PTY dies.
          //
          //    No auto-respawn anymore. It existed only to paper over the Linux
          //    PTY SIGHUP race (sessions dying seconds after spawn). That race is
          //    now eliminated at the source by pty-sighup-exec (SIGHUP=SIG_IGN
          //    before exec — see the spawnCommand comment above), so a PTY exit
          //    is a genuine exit (user typed `exit`, process crashed) and should
          //    be reflected, not silently respawned.
          wireSessionExit(sessionId);

          const createdMeta = sessionMeta.get(sessionId)!;
          // Notify every connected events client so lists update without polling.
          broadcastSessionEvent({
            action: 'created',
            sessionId,
            projectId: createdMeta.projectId,
            name: createdMeta.name,
          });

          set.status = 201;
          return createdMeta;
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
          agentType: t.Optional(t.Union([t.Literal('opencode'), t.Literal('claude')])),
          model: t.Optional(t.String()),
          agent: t.Optional(t.String()),
          agentSource: t.Optional(t.Union([t.Literal('agents'), t.Literal('commands')])),
          effort: t.Optional(t.String()),
          resumeConversationId: t.Optional(t.String()),
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
        // Notify every connected events client so lists update without polling.
        broadcastSessionEvent({ action: 'renamed', sessionId, name: meta.name });
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
            } catch {
              /* non-fatal */
            }
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
          // tmux-backed: no innerCmd → tmux launches the default shell at /root.
          await manager.spawnSession(
            sessionId,
            '/root',
            'tmux',
            buildTmuxSpawnArgs(sessionId, 120, 35),
            undefined,
            120,
            35,
          );
        } catch (err) {
          sessionMeta.delete(sessionId);
          try {
            getDb().run('DELETE FROM sessions WHERE id = ?', [sessionId]);
          } catch {
            // non-fatal
          }
          // Reap any orphan tmux session created before the attach client died.
          void tmuxKillSession(sessionId);
          set.status = 500;
          return {
            error: `Failed to spawn emergency terminal: ${(err as Error).message}`,
          };
        }

        // Wire exit callback.
        wireSessionExit(sessionId);

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
        const project = db.query('SELECT id FROM projects WHERE id = ?').get(projectId) as {
          id: string;
        } | null;
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
          // Best-effort: reap any lingering tmux session (idempotent).
          void tmuxKillSession(id);
        }

        if (toRemove.length > 0) {
          const placeholders = toRemove.map(() => '?').join(',');
          try {
            db.run(`DELETE FROM sessions WHERE id IN (${placeholders})`, toRemove);
          } catch {
            // non-fatal
          }
        }

        if (toRemove.length > 0) {
          // Notify every connected events client so lists update without polling.
          broadcastSessionEvent({ action: 'cleared', projectId, count: toRemove.length });
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
          const row = getDb().query('SELECT id FROM sessions WHERE id = ?').get(sessionId) as {
            id: string;
          } | null;
          if (!row) {
            set.status = 404;
            return { error: 'Session not found' };
          }
          // Known to DB but not in memory — PTY is already gone. Reap any
          // lingering tmux session, then clean up the row.
          await tmuxKillSession(sessionId);
          getDb().run('DELETE FROM sessions WHERE id = ?', [sessionId]);
          // Notify every connected events client so lists update without polling.
          broadcastSessionEvent({ action: 'closed', sessionId });
          return { success: true };
        }

        // Kill the tmux session FIRST: this terminates the real processes in
        // the daemon (the attach client alone surviving would leave a detached
        // session running forever). Idempotent — a missing session is a no-op.
        await tmuxKillSession(sessionId);

        // Then kill the attach client. If the PTY has already exited (session
        // is 'finished', or it died when its tmux session went away above),
        // killSession throws "session not found: id" — we still clean up
        // metadata, the goal is removal.
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
        // Notify every connected events client so lists update without polling.
        broadcastSessionEvent({ action: 'closed', sessionId });
        return { success: true };
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    }),
);
