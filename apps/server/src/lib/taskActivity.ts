/**
 * Task activity log helpers.
 *
 * `task_activity` is a unified GitLab-style timeline: immutable system events
 * (created, moved, title/description/priority changes, label add/remove, link
 * add/remove) and free-text comments (`type='comment'`) live in one table,
 * ordered by `created_at` on render. This module centralizes inserts/reads so
 * both the tasks routes and the dedicated activity/comments route stay
 * consistent.
 */
import type { getDb } from '../db/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = ReturnType<typeof getDb>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export type ActivityType =
  | 'created'
  | 'moved'
  | 'title_changed'
  | 'description_changed'
  | 'priority_changed'
  | 'label_added'
  | 'label_removed'
  | 'linked'
  | 'unlinked'
  | 'comment';

export interface ActivityEvent {
  type: ActivityType;
  body?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}

export interface ActivityDto {
  id: string;
  taskId: string;
  type: ActivityType;
  body: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toActivity(row: DbRow): ActivityDto {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    type: row.type as ActivityType,
    body: (row.body as string) ?? null,
    field: (row.field as string) ?? null,
    oldValue: (row.old_value as string) ?? null,
    newValue: (row.new_value as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Insert one activity row. Returns the generated id. */
export function logActivity(db: Db, taskId: string, ev: ActivityEvent): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO task_activity (id, task_id, type, body, field, old_value, new_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      ev.type,
      ev.body ?? null,
      ev.field ?? null,
      ev.oldValue ?? null,
      ev.newValue ?? null,
      now,
      now,
    ],
  );
  return id;
}

/** Fetch the full activity timeline for a task, oldest first. */
export function getTaskActivity(db: Db, taskId: string): ActivityDto[] {
  const rows = db
    .query('SELECT * FROM task_activity WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(taskId) as DbRow[];
  return rows.map(toActivity);
}

/** Count free-text comments on a task (for card badges). */
export function countComments(db: Db, taskId: string): number {
  const row = db
    .query("SELECT COUNT(*) as c FROM task_activity WHERE task_id = ? AND type = 'comment'")
    .get(taskId) as { c: number };
  return row.c;
}
