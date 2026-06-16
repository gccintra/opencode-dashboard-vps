import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { logActivity } from '../lib/taskActivity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export type LinkType = 'relates_to' | 'blocks' | 'blocked_by' | 'duplicates';

const LINK_TYPES: LinkType[] = ['relates_to', 'blocks', 'blocked_by', 'duplicates'];

/** Type as seen from the *other* end of a stored link. */
export function inverseLinkType(type: LinkType): LinkType {
  if (type === 'blocks') return 'blocked_by';
  if (type === 'blocked_by') return 'blocks';
  return type; // relates_to / duplicates are symmetric
}

interface LinkDto {
  id: string;
  type: LinkType;
  createdAt: string;
  task: {
    id: string;
    title: string;
    column: string;
    columnName: string | null;
    projectName: string | null;
  };
}

function taskSummary(db: ReturnType<typeof getDb>, taskId: string) {
  const row = db
    .query(
      `SELECT t.id, t.title, t."column" as column, kc.name as column_name, p.name as project_name
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       LEFT JOIN kanban_columns kc ON kc.id = t."column"
       WHERE t.id = ?`,
    )
    .get(taskId) as DbRow | null;
  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    column: row.column as string,
    columnName: (row.column_name as string) || null,
    projectName: (row.project_name as string) || null,
  };
}

export const taskLinksRoutes = new Elysia({ prefix: '/api' })
  // ── GET /api/tasks/:id/links — links from this task's perspective ──
  .guard(authGuard, (app) =>
    app.get('/tasks/:id/links', ({ params: { id }, set }) => {
      const db = getDb();
      const task = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      const rows = db
        .query('SELECT * FROM task_links WHERE source_task_id = ? OR target_task_id = ?')
        .all(id, id) as DbRow[];

      const links: LinkDto[] = [];
      for (const row of rows) {
        const isSource = (row.source_task_id as string) === id;
        const otherId = isSource ? (row.target_task_id as string) : (row.source_task_id as string);
        const summary = taskSummary(db, otherId);
        if (!summary) continue; // dangling (shouldn't happen due to FK cascade)
        links.push({
          id: row.id as string,
          type: isSource ? (row.type as LinkType) : inverseLinkType(row.type as LinkType),
          createdAt: row.created_at as string,
          task: summary,
        });
      }
      return links;
    }),
  )

  // ── POST /api/tasks/:id/links — create a typed link ──
  .guard(authGuard, (app) =>
    app.post(
      '/tasks/:id/links',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const { targetTaskId, type } = body;

        if (!LINK_TYPES.includes(type as LinkType)) {
          set.status = 400;
          return { error: 'invalid link type' };
        }
        if (targetTaskId === id) {
          set.status = 400;
          return { error: 'cannot link a task to itself' };
        }

        const source = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
        const target = db
          .query('SELECT id, title FROM tasks WHERE id = ?')
          .get(targetTaskId) as DbRow | null;
        if (!source || !target) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        // Reject duplicates regardless of direction (a<-blocks->b == b<-blocked_by->a)
        const inverse = inverseLinkType(type as LinkType);
        const existing = db
          .query(
            `SELECT id FROM task_links
             WHERE (source_task_id = ? AND target_task_id = ? AND type = ?)
                OR (source_task_id = ? AND target_task_id = ? AND type = ?)`,
          )
          .get(id, targetTaskId, type, targetTaskId, id, inverse) as DbRow | null;
        if (existing) {
          set.status = 409;
          return { error: 'link already exists' };
        }

        const linkId = crypto.randomUUID();
        const now = new Date().toISOString();
        db.run(
          'INSERT INTO task_links (id, source_task_id, target_task_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
          [linkId, id, targetTaskId, type, now],
        );

        logActivity(db, id, {
          type: 'linked',
          field: type,
          newValue: targetTaskId,
          body: target.title as string,
        });

        set.status = 201;
        return { id: linkId, type, createdAt: now, task: taskSummary(db, targetTaskId) };
      },
      {
        body: t.Object({
          targetTaskId: t.String(),
          type: t.Union([
            t.Literal('relates_to'),
            t.Literal('blocks'),
            t.Literal('blocked_by'),
            t.Literal('duplicates'),
          ]),
        }),
      },
    ),
  )

  // ── DELETE /api/tasks/:id/links/:linkId — remove a link ──
  .guard(authGuard, (app) =>
    app.delete('/tasks/:id/links/:linkId', ({ params: { id, linkId }, set }) => {
      const db = getDb();
      const row = db
        .query(
          'SELECT * FROM task_links WHERE id = ? AND (source_task_id = ? OR target_task_id = ?)',
        )
        .get(linkId, id, id) as DbRow | null;
      if (!row) {
        set.status = 404;
        return { error: 'Link not found' };
      }
      db.run('DELETE FROM task_links WHERE id = ?', [linkId]);
      logActivity(db, id, { type: 'unlinked', newValue: row.target_task_id as string });
      set.status = 200;
      return { deleted: true };
    }),
  );
