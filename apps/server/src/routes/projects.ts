import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { existsSync, readdirSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Sanitize and validate a directory path:
 * 1. Resolve to an absolute, normalized path (prevents traversal via ../ or .)
 * 2. Verify the resolved path exists on the filesystem
 */
function validateDirectory(raw: string): { resolved: string } | { error: string } {
  if (!raw || !raw.trim()) {
    return { error: 'directory is required' };
  }
  const resolved = resolve(raw.trim());
  if (!existsSync(resolved)) {
    return { error: `directory does not exist: ${resolved}` };
  }
  return { resolved };
}

/**
 * Check if a directory is non-empty (has files or subdirectories).
 */
function isDirNonEmpty(dirPath: string): boolean {
  try {
    const entries = readdirSync(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the harness directory path given a harness ID.
 * Returns the full path if it exists, or null.
 */
function resolveHarnessDir(harnessId: string): string | null {
  const envPath = process.env.HARNESSES_PATH?.trim();
  const rootPath = envPath ? resolve(envPath) : join(homedir(), '.config', 'opencode', 'harnesses');
  const harnessDir = join(rootPath, harnessId);
  if (!existsSync(harnessDir)) return null;
  return harnessDir;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Map a raw DB row to the API response shape */
function toProject(row: DbRow) {
  return {
    id: row.id as string,
    name: row.name as string,
    directory: row.directory as string,
    description: (row.description as string) || null,
    harnessId: (row.harness_id as string) || null,
    githubRepo: (row.github_repo as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const projectsRoutes = new Elysia({ prefix: '/api/projects' }).guard(authGuard, (app) =>
  app
    // ── GET /api/projects ──────────────────────────────────────────
    .get('/', () => {
      const db = getDb();
      const rows = db
        .query(
          `SELECT id, name, directory, description, harness_id, github_repo, created_at, updated_at
           FROM projects
           ORDER BY name ASC`,
        )
        .all() as DbRow[];
      return rows.map(toProject);
    })

    // ── POST /api/projects ─────────────────────────────────────────
    .post(
      '/',
      ({ body, set }) => {
        const db = getDb();

        // Validate name
        if (!body.name || !body.name.trim()) {
          set.status = 400;
          return { error: 'name is required' };
        }

        // Validate directory
        const dirResult = validateDirectory(body.directory);
        if ('error' in dirResult) {
          set.status = 400;
          return { error: dirResult.error };
        }

        // Check for duplicate name (case-insensitive)
        const existing = db
          .query('SELECT id FROM projects WHERE name = ? COLLATE NOCASE')
          .get(body.name.trim()) as DbRow | null;
        if (existing) {
          set.status = 409;
          return { error: 'project name already exists' };
        }

        const harnessId = body.harnessId?.trim() || null;

        // Handle harness copy if harnessId is provided
        if (harnessId) {
          const harnessDir = resolveHarnessDir(harnessId);
          if (!harnessDir) {
            set.status = 400;
            return { error: `harness not found: ${harnessId}` };
          }

          // Check if project directory is non-empty
          if (isDirNonEmpty(dirResult.resolved)) {
            if (!body.overwrite) {
              set.status = 409;
              return { error: 'Directory not empty. Set overwrite=true to proceed.' };
            }
          }

          // Copy harness files into project directory
          try {
            cpSync(harnessDir, dirResult.resolved, { recursive: true });
          } catch (err) {
            set.status = 500;
            return { error: `failed to copy harness files: ${(err as Error).message}` };
          }
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const githubRepo = body.githubRepo?.trim() || null;

        db.run(
          `INSERT INTO projects (id, name, directory, description, harness_id, github_repo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            body.name.trim(),
            dirResult.resolved,
            body.description?.trim() || null,
            harnessId,
            githubRepo,
            now,
            now,
          ],
        );

        set.status = 201;
        return {
          id,
          name: body.name.trim(),
          directory: dirResult.resolved,
          description: body.description?.trim() || null,
          harnessId,
          githubRepo,
          createdAt: now,
          updatedAt: now,
        };
      },
      {
        body: t.Object({
          name: t.String(),
          directory: t.String(),
          description: t.Optional(t.String()),
          harnessId: t.Optional(t.String()),
          githubRepo: t.Optional(t.String()),
          overwrite: t.Optional(t.Boolean()),
        }),
      },
    )

    // ── GET /api/projects/:id ──────────────────────────────────────
    .get('/:id', ({ params: { id }, set }) => {
      const db = getDb();
      const row = db
        .query(
          `SELECT id, name, directory, description, harness_id, github_repo, created_at, updated_at
           FROM projects
           WHERE id = ?`,
        )
        .get(id) as DbRow | null;

      if (!row) {
        set.status = 404;
        return { error: 'project not found' };
      }

      return toProject(row);
    })

    // ── PUT /api/projects/:id ──────────────────────────────────────
    .put(
      '/:id',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM projects WHERE id = ?').get(id) as DbRow | null;

        if (!existing) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const updates: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values: any[] = [];

        // Validate and update name
        if (body.name !== undefined) {
          if (!body.name || !body.name.trim()) {
            set.status = 400;
            return { error: 'name cannot be empty' };
          }
          const dup = db
            .query('SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id != ?')
            .get(body.name.trim(), id) as DbRow | null;
          if (dup) {
            set.status = 409;
            return { error: 'project name already exists' };
          }
          updates.push('name = ?');
          values.push(body.name.trim());
        }

        // Validate and update directory
        if (body.directory !== undefined) {
          const dirResult = validateDirectory(body.directory);
          if ('error' in dirResult) {
            set.status = 400;
            return { error: dirResult.error };
          }
          updates.push('directory = ?');
          values.push(dirResult.resolved);
        }

        // Update description (nullable)
        if (body.description !== undefined) {
          updates.push('description = ?');
          values.push(body.description?.trim() || null);
        }

        // Update github_repo (nullable)
        if (body.githubRepo !== undefined) {
          updates.push('github_repo = ?');
          values.push(body.githubRepo?.trim() || null);
        }

        // If no changes, return current state
        if (updates.length === 0) {
          return toProject(existing);
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        values.push(now);
        values.push(id);

        db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, values);

        // Return updated project
        const updated = db
          .query(
            `SELECT id, name, directory, description, harness_id, github_repo, created_at, updated_at
           FROM projects
           WHERE id = ?`,
          )
          .get(id) as DbRow;
        return toProject(updated);
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          directory: t.Optional(t.String()),
          description: t.Optional(t.String()),
          githubRepo: t.Optional(t.String()),
        }),
      },
    )

    // ── DELETE /api/projects/:id ───────────────────────────────────
    .delete('/:id', ({ params: { id }, set }) => {
      const db = getDb();
      const existing = db.query('SELECT id FROM projects WHERE id = ?').get(id) as DbRow | null;

      if (!existing) {
        set.status = 404;
        return { error: 'project not found' };
      }

      db.run('DELETE FROM projects WHERE id = ?', [id]);
      set.status = 200;
      return { deleted: true };
    }),
);
