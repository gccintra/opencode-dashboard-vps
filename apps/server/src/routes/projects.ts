import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  copyHarnessToDir,
  resolveHarnessDir,
  getFileTree,
  detectOverwriteConflicts,
  syncHarnessesToDb,
} from './harnesses';

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
          try {
            // Sync filesystem -> DB to ensure harness exists for FK constraint
            syncHarnessesToDb();
            copyHarnessToDir(harnessId, dirResult.resolved, !!body.overwrite);
          } catch (err) {
            const e = err as Error & { status?: number; conflicts?: string[] };
            set.status = (e.status as number) || 500;
            if (e.conflicts) {
              return { error: e.message, conflicts: e.conflicts };
            }
            return { error: e.message || 'failed to copy harness files' };
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
    })

    // ── POST /api/projects/:id/harness ─────────────────────────────
    // Apply a harness template to an existing project directory.
    .post(
      '/:id/harness',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const project = db
          .query('SELECT id, directory FROM projects WHERE id = ?')
          .get(id) as DbRow | null;

        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const harnessId = body.harnessId?.trim();
        if (!harnessId) {
          set.status = 400;
          return { error: 'harnessId is required' };
        }

        try {
          // Sync filesystem -> DB to ensure harness exists for FK constraint
          syncHarnessesToDb();
          const result = copyHarnessToDir(harnessId, project.directory as string, !!body.overwrite);

          // Update project's harness_id to reflect applied template
          db.run('UPDATE projects SET harness_id = ?, updated_at = ? WHERE id = ?', [
            harnessId,
            new Date().toISOString(),
            id,
          ]);

          return { copied: result.copied, skipped: result.conflicts, errors: [] };
        } catch (err) {
          const e = err as Error & { status?: number; conflicts?: string[] };
          set.status = (e.status as number) || 500;
          if (e.conflicts) {
            return { error: e.message, conflicts: e.conflicts };
          }
          return { error: e.message || 'failed to copy harness' };
        }
      },
      {
        body: t.Object({
          harnessId: t.String(),
          overwrite: t.Optional(t.Boolean()),
          files: t.Optional(t.Array(t.String())),
        }),
      },
    )

    // ── GET /api/projects/:id/harness/preview ──────────────────────
    // Dry-run: list files that would be copied and any conflicts.
    .get('/:id/harness/preview', ({ params: { id }, query, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id, directory FROM projects WHERE id = ?')
        .get(id) as DbRow | null;

      if (!project) {
        set.status = 404;
        return { error: 'project not found' };
      }

      const harnessId = query.harnessId?.trim();
      if (!harnessId) {
        set.status = 400;
        return { error: 'harnessId query parameter is required' };
      }

      const harnessDir = resolveHarnessDir(harnessId);
      if (!harnessDir) {
        set.status = 400;
        return { error: `harness not found: ${harnessId}` };
      }

      // Get harness metadata from DB
      const harnessRow = db
        .query('SELECT id, name, description FROM harnesses WHERE id = ?')
        .get(harnessId) as DbRow | null;

      // Build file tree for the harness
      const files = getFileTree(harnessDir);

      // Detect conflicts with existing project files
      let conflicts: string[] = [];
      if (existsSync(project.directory as string)) {
        conflicts = detectOverwriteConflicts(harnessDir, project.directory as string);
      }

      return {
        harness: {
          id: harnessId,
          name: harnessRow?.name || harnessId,
          description: harnessRow?.description || '',
        },
        files,
        conflicts,
      };
    }),
);
