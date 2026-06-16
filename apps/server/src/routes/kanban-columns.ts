import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export type KanbanCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface KanbanColumnDto {
  id: string;
  name: string;
  category: KanbanCategory;
  color: string;
  sortOrder: number;
  createdAt: string;
  taskCount?: number;
}

function toDto(row: DbRow): KanbanColumnDto {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as KanbanCategory,
    color: row.color as string,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    taskCount: row.task_count != null ? (row.task_count as number) : undefined,
  };
}

export const kanbanColumnsRoutes = new Elysia()

  // List all columns ordered by category sort + sort_order
  .guard(authGuard, (app) =>
    app.get('/api/kanban-columns', () => {
      const db = getDb();
      const rows = db
        .query(
          `SELECT kc.*,
                  (SELECT COUNT(*) FROM tasks t WHERE t."column" = kc.id) AS task_count
           FROM kanban_columns kc
           ORDER BY
             CASE kc.category
               WHEN 'backlog'   THEN 0
               WHEN 'unstarted' THEN 1
               WHEN 'started'   THEN 2
               WHEN 'completed' THEN 3
               WHEN 'canceled'  THEN 4
               ELSE 5
             END,
             kc.sort_order ASC,
             kc.created_at ASC`,
        )
        .all() as DbRow[];
      return rows.map(toDto);
    }),
  )

  // Create a new column
  .guard(authGuard, (app) =>
    app.post(
      '/api/kanban-columns',
      ({ body, set }) => {
        const db = getDb();
        const { name, category, color } = body;

        const existing = db
          .query('SELECT id FROM kanban_columns WHERE name = ? COLLATE NOCASE')
          .get(name) as { id: string } | null;
        if (existing) {
          set.status = 409;
          return { error: `Column name "${name}" already exists` };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const maxOrder = (
          db
            .query('SELECT MAX(sort_order) as max FROM kanban_columns WHERE category = ?')
            .get(category) as { max: number | null }
        ).max ?? -1;

        db.run(
          `INSERT INTO kanban_columns (id, name, category, color, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, name.trim(), category, color ?? '#6b7280', maxOrder + 1, now],
        );

        const row = db.query('SELECT * FROM kanban_columns WHERE id = ?').get(id) as DbRow;
        set.status = 201;
        return toDto(row);
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 50 }),
          category: t.Union([
            t.Literal('backlog'),
            t.Literal('unstarted'),
            t.Literal('started'),
            t.Literal('completed'),
            t.Literal('canceled'),
          ]),
          color: t.Optional(t.String()),
        }),
      },
    ),
  )

  // Update a column (name, color, sort_order)
  .guard(authGuard, (app) =>
    app.put(
      '/api/kanban-columns/:id',
      ({ params, body, set }) => {
        const db = getDb();
        const col = db
          .query('SELECT * FROM kanban_columns WHERE id = ?')
          .get(params.id) as DbRow | null;
        if (!col) {
          set.status = 404;
          return { error: 'Column not found' };
        }

        if (body.name !== undefined && body.name.trim() !== col.name) {
          const conflict = db
            .query('SELECT id FROM kanban_columns WHERE name = ? COLLATE NOCASE AND id != ?')
            .get(body.name.trim(), params.id) as { id: string } | null;
          if (conflict) {
            set.status = 409;
            return { error: `Column name "${body.name}" already exists` };
          }
        }

        const updates: string[] = [];
        const values: (string | number)[] = [];

        if (body.name !== undefined) {
          updates.push('name = ?');
          values.push(body.name.trim());
        }
        if (body.color !== undefined) {
          updates.push('color = ?');
          values.push(body.color);
        }
        if (body.sortOrder !== undefined) {
          updates.push('sort_order = ?');
          values.push(body.sortOrder);
        }

        if (updates.length === 0) return toDto(col);

        values.push(params.id);
        db.run(`UPDATE kanban_columns SET ${updates.join(', ')} WHERE id = ?`, values);

        const updated = db
          .query('SELECT * FROM kanban_columns WHERE id = ?')
          .get(params.id) as DbRow;
        return toDto(updated);
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
          color: t.Optional(t.String()),
          sortOrder: t.Optional(t.Number()),
        }),
      },
    ),
  )

  // Delete a column — only if no tasks reference it and it's not the last in category
  .guard(authGuard, (app) =>
    app.delete(
      '/api/kanban-columns/:id',
      ({ params, set }) => {
        const db = getDb();
        const col = db
          .query('SELECT * FROM kanban_columns WHERE id = ?')
          .get(params.id) as DbRow | null;
        if (!col) {
          set.status = 404;
          return { error: 'Column not found' };
        }

        const taskCount = (
          db
            .query('SELECT COUNT(*) as count FROM tasks WHERE "column" = ?')
            .get(params.id) as { count: number }
        ).count;

        if (taskCount > 0) {
          set.status = 409;
          return {
            error: `Cannot delete — ${taskCount} task${taskCount === 1 ? '' : 's'} still in this column. Move them first.`,
            taskCount,
          };
        }

        const categoryCount = (
          db
            .query('SELECT COUNT(*) as count FROM kanban_columns WHERE category = ?')
            .get(col.category) as { count: number }
        ).count;

        if (categoryCount <= 1) {
          set.status = 409;
          return { error: 'Cannot delete the last column in a category.' };
        }

        db.run('DELETE FROM kanban_columns WHERE id = ?', [params.id]);
        set.status = 200;
        return { deleted: true };
      },
      {
        params: t.Object({ id: t.String() }),
      },
    ),
  );
