import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { getTaskActivity, logActivity, toActivity } from '../lib/taskActivity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export const taskActivityRoutes = new Elysia({ prefix: '/api' })
  // ── GET /api/tasks/:id/activity — full timeline (system events + comments) ──
  .guard(authGuard, (app) =>
    app.get('/tasks/:id/activity', ({ params: { id }, set }) => {
      const db = getDb();
      const task = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return getTaskActivity(db, id);
    }),
  )

  // ── POST /api/tasks/:id/comments — add a free-text comment ──
  .guard(authGuard, (app) =>
    app.post(
      '/tasks/:id/comments',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const task = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!task) {
          set.status = 404;
          return { error: 'Task not found' };
        }
        const text = body.body?.trim();
        if (!text) {
          set.status = 400;
          return { error: 'body is required' };
        }
        const activityId = logActivity(db, id, { type: 'comment', body: text });
        const row = db
          .query('SELECT * FROM task_activity WHERE id = ?')
          .get(activityId) as DbRow;
        set.status = 201;
        return toActivity(row);
      },
      { body: t.Object({ body: t.String() }) },
    ),
  )

  // ── PUT /api/tasks/:id/comments/:cid — edit a comment ──
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/comments/:cid',
      ({ params: { id, cid }, body, set }) => {
        const db = getDb();
        const row = db
          .query("SELECT * FROM task_activity WHERE id = ? AND task_id = ? AND type = 'comment'")
          .get(cid, id) as DbRow | null;
        if (!row) {
          set.status = 404;
          return { error: 'Comment not found' };
        }
        const text = body.body?.trim();
        if (!text) {
          set.status = 400;
          return { error: 'body is required' };
        }
        const now = new Date().toISOString();
        db.run('UPDATE task_activity SET body = ?, updated_at = ? WHERE id = ?', [text, now, cid]);
        const updated = db.query('SELECT * FROM task_activity WHERE id = ?').get(cid) as DbRow;
        return toActivity(updated);
      },
      { body: t.Object({ body: t.String() }) },
    ),
  )

  // ── DELETE /api/tasks/:id/comments/:cid — remove a comment ──
  .guard(authGuard, (app) =>
    app.delete('/tasks/:id/comments/:cid', ({ params: { id, cid }, set }) => {
      const db = getDb();
      const row = db
        .query("SELECT id FROM task_activity WHERE id = ? AND task_id = ? AND type = 'comment'")
        .get(cid, id) as DbRow | null;
      if (!row) {
        set.status = 404;
        return { error: 'Comment not found' };
      }
      db.run('DELETE FROM task_activity WHERE id = ?', [cid]);
      set.status = 200;
      return { deleted: true };
    }),
  );
