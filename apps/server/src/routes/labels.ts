import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Public label shape returned by the API. */
export interface LabelDto {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
}

/** Map a raw DB row to the API response shape. */
export function toLabel(row: DbRow): LabelDto {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    color: row.color as string,
    createdAt: row.created_at as string,
  };
}

/** Validate a hex color string: #rgb or #rrggbb. */
export function isValidHexColor(color: unknown): color is string {
  return typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

export const labelsRoutes = new Elysia({ prefix: '/api' })
  // ── GET /api/projects/:id/labels — list labels for a project ──
  .guard(authGuard, (app) =>
    app.get('/projects/:id/labels', ({ params: { id: projectId }, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id FROM projects WHERE id = ?')
        .get(projectId) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      const rows = db
        .query('SELECT * FROM labels WHERE project_id = ? ORDER BY name COLLATE NOCASE ASC')
        .all(projectId) as DbRow[];
      return rows.map(toLabel);
    }),
  )

  // ── POST /api/projects/:id/labels — create label ──
  .guard(authGuard, (app) =>
    app.post(
      '/projects/:id/labels',
      ({ params: { id: projectId }, body, set }) => {
        const db = getDb();
        const project = db
          .query('SELECT id FROM projects WHERE id = ?')
          .get(projectId) as DbRow | null;
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }

        const name = (body.name || '').trim();
        if (!name) {
          set.status = 400;
          return { error: 'name is required' };
        }
        if (!isValidHexColor(body.color)) {
          set.status = 400;
          return { error: 'color must be a hex value (#rgb or #rrggbb)' };
        }

        // Reject duplicate name within the project (case-insensitive)
        const dup = db
          .query('SELECT id FROM labels WHERE project_id = ? AND name = ? COLLATE NOCASE')
          .get(projectId, name) as DbRow | null;
        if (dup) {
          set.status = 409;
          return { error: 'A label with this name already exists in the project' };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.run(
          'INSERT INTO labels (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)',
          [id, projectId, name, body.color, now],
        );
        const row = db.query('SELECT * FROM labels WHERE id = ?').get(id) as DbRow;
        set.status = 201;
        return toLabel(row);
      },
      {
        body: t.Object({
          name: t.String(),
          color: t.String(),
        }),
      },
    ),
  )

  // ── PUT /api/labels/:id — edit name/color ──
  .guard(authGuard, (app) =>
    app.put(
      '/labels/:id',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM labels WHERE id = ?').get(id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Label not found' };
        }

        const updates: string[] = [];
        const values: (string | number)[] = [];

        if (body.name !== undefined) {
          const name = body.name.trim();
          if (!name) {
            set.status = 400;
            return { error: 'name cannot be empty' };
          }
          // Reject duplicate name within the same project (excluding this label)
          const dup = db
            .query(
              'SELECT id FROM labels WHERE project_id = ? AND name = ? COLLATE NOCASE AND id != ?',
            )
            .get(existing.project_id, name, id) as DbRow | null;
          if (dup) {
            set.status = 409;
            return { error: 'A label with this name already exists in the project' };
          }
          updates.push('name = ?');
          values.push(name);
        }

        if (body.color !== undefined) {
          if (!isValidHexColor(body.color)) {
            set.status = 400;
            return { error: 'color must be a hex value (#rgb or #rrggbb)' };
          }
          updates.push('color = ?');
          values.push(body.color);
        }

        if (updates.length === 0) {
          return toLabel(existing);
        }

        values.push(id);
        db.run(`UPDATE labels SET ${updates.join(', ')} WHERE id = ?`, values);
        const row = db.query('SELECT * FROM labels WHERE id = ?').get(id) as DbRow;
        return toLabel(row);
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          color: t.Optional(t.String()),
        }),
      },
    ),
  )

  // ── DELETE /api/labels/:id — remove (cascade clears task_labels) ──
  .guard(authGuard, (app) =>
    app.delete('/labels/:id', ({ params: { id }, set }) => {
      const db = getDb();
      const existing = db.query('SELECT id FROM labels WHERE id = ?').get(id) as DbRow | null;
      if (!existing) {
        set.status = 404;
        return { error: 'Label not found' };
      }
      db.run('DELETE FROM labels WHERE id = ?', [id]);
      set.status = 200;
      return { deleted: true };
    }),
  );
