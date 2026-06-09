import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Map a raw DB row to the API response shape */
function toTask(row: DbRow) {
  let labels: unknown = null;
  if (row.github_labels) {
    try {
      labels = JSON.parse(row.github_labels as string);
    } catch {
      labels = null;
    }
  }
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectName: (row.project_name as string) || null,
    title: row.title as string,
    description: (row.description as string) || null,
    source: row.source as string,
    column: row['column'] as string,
    sortOrder: row.sort_order as number,
    githubIssueUrl: (row.github_issue_url as string) || null,
    githubLabels: labels,
    githubIssueNumber: (row.github_issue_number as number) || null,
    sessionId: (row.session_id as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Format task as YAML frontmatter + markdown for .opencode/tasks/*.md files */
function taskToMarkdown(task: DbRow): string {
  const lines: string[] = ['---'];
  lines.push(`title: "${(task.title as string).replace(/"/g, '\\"')}"`);
  lines.push(`status: ${task['column']}`);
  if (task.description) {
    lines.push(`description: "${(task.description as string).replace(/"/g, '\\"')}"`);
  }
  if (task.source) {
    lines.push(`source: ${task.source}`);
  }
  if (task.github_issue_url) {
    lines.push(`github_issue_url: ${task.github_issue_url}`);
  }
  lines.push('---');
  lines.push('');
  if (task.description) {
    lines.push(task.description as string);
    lines.push('');
  }
  return lines.join('\n');
}

/** Read a .md file and extract YAML frontmatter as plain key-value - minimal parser */
function parseTaskMd(
  content: string,
): { title?: string; status?: string; description?: string; body?: string } | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const result: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') break;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      let value = line.substring(colonIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }

  const body = lines
    .slice(i + 1)
    .join('\n')
    .trim();
  return {
    title: result.title,
    status: result.status || 'backlog',
    description: result.description || body || undefined,
    body: body || undefined,
  };
}

/** Write a .md task file to the project's .opencode/tasks/ directory */
function writeTaskMd(projectDirectory: string, taskId: string, task: DbRow): void {
  try {
    const tasksDir = join(projectDirectory, '.opencode', 'tasks');
    if (!existsSync(tasksDir)) {
      mkdirSync(tasksDir, { recursive: true });
    }
    const filePath = join(tasksDir, `${taskId}.md`);
    writeFileSync(filePath, taskToMarkdown(task), 'utf-8');
  } catch (err) {
    console.error(`[tasks] failed to write .md file for task ${taskId}:`, (err as Error).message);
  }
}

/** Remove a .md task file */
function removeTaskMd(projectDirectory: string, taskId: string): void {
  try {
    const filePath = join(projectDirectory, '.opencode', 'tasks', `${taskId}.md`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`[tasks] failed to remove .md file for task ${taskId}:`, (err as Error).message);
  }
}

export const tasksRoutes = new Elysia({ prefix: '/api' })
  // ── GET /api/tasks — global task list (all projects, for kanban) ──
  .guard(authGuard, (app) =>
    app.get('/tasks', ({ query, set }) => {
      try {
        const db = getDb();
        const statusFilter = (query as { status?: string }).status;
        const sourceFilter = (query as { source?: string }).source;
        const projectFilter = (query as { projectId?: string }).projectId;

        let sql =
          'SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE 1=1';
        const params: (string | number)[] = [];

        if (statusFilter && ['backlog', 'in_progress', 'done'].includes(statusFilter)) {
          sql += ' AND t."column" = ?';
          params.push(statusFilter);
        }
        if (sourceFilter && ['local', 'github'].includes(sourceFilter)) {
          sql += ' AND t.source = ?';
          params.push(sourceFilter);
        }
        if (projectFilter) {
          sql += ' AND t.project_id = ?';
          params.push(projectFilter);
        }

        sql += ' ORDER BY t.sort_order ASC';
        const rows = db.query(sql).all(...params) as DbRow[];
        return rows.map(toTask);
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    }),
  )
  // ── POST /api/projects/:id/tasks — create task ───────────────
  .guard(authGuard, (app) =>
    app.post(
      '/projects/:id/tasks',
      ({ params: { id: projectId }, body, set }) => {
        const db = getDb();

        // Verify project exists
        const project = db
          .query('SELECT * FROM projects WHERE id = ?')
          .get(projectId) as DbRow | null;
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }

        if (!body.title || !body.title.trim()) {
          set.status = 400;
          return { error: 'title is required' };
        }

        const taskId = crypto.randomUUID();
        const now = new Date().toISOString();
        const column = body.column || 'backlog';

        // Get max sort_order for column
        const maxOrder = db
          .query(
            'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tasks WHERE project_id = ? AND "column" = ?',
          )
          .get(projectId, column) as DbRow;
        const sortOrder = (maxOrder.max_order as number) + 1;

        db.run(
          `INSERT INTO tasks (id, project_id, title, description, source, "column", sort_order, session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            projectId,
            body.title.trim(),
            body.description?.trim() || null,
            body.source || 'local',
            column,
            sortOrder,
            body.sessionId || null,
            now,
            now,
          ],
        );

        // Write .md file to project directory
        const task = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as DbRow;
        writeTaskMd(project.directory as string, taskId, task);

        set.status = 201;
        return toTask(task);
      },
      {
        body: t.Object({
          title: t.String(),
          description: t.Optional(t.String()),
          column: t.Optional(t.String()),
          source: t.Optional(t.String()),
          sessionId: t.Optional(t.String()),
        }),
      },
    ),
  )

  // ── GET /api/projects/:id/tasks — list tasks ordered ─────────
  .guard(authGuard, (app) =>
    app.get('/projects/:id/tasks', ({ params: { id: projectId }, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id FROM projects WHERE id = ?')
        .get(projectId) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      const rows = db
        .query(`SELECT * FROM tasks WHERE project_id = ? ORDER BY "column", sort_order ASC`)
        .all(projectId) as DbRow[];
      return rows.map(toTask);
    }),
  )

  // ── GET /api/tasks (global) ──────────────────────────────────
  .guard(authGuard, (app) =>
    app.get('/tasks', () => {
      const db = getDb();
      const rows = db
        .query(
          `SELECT t.*, p.name as project_name FROM tasks t
           JOIN projects p ON t.project_id = p.id
           ORDER BY t."column", t.sort_order ASC`,
        )
        .all() as DbRow[];
      return rows.map((row) => {
        const task = toTask(row);
        return { ...task, projectName: row.project_name as string };
      });
    }),
  )

  // ── PUT /api/tasks/:id — edit title, description, column ─────
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        const updates: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values: any[] = [];

        if (body.title !== undefined) {
          if (!body.title.trim()) {
            set.status = 400;
            return { error: 'title cannot be empty' };
          }
          updates.push('title = ?');
          values.push(body.title.trim());
        }

        if (body.description !== undefined) {
          updates.push('description = ?');
          values.push(body.description.trim() || null);
        }

        if (body.column !== undefined) {
          updates.push('"column" = ?');
          values.push(body.column);
        }

        if (updates.length === 0) {
          return toTask(existing);
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        values.push(now);
        values.push(id);

        db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;

        // Sync .md file
        const project = db
          .query('SELECT directory FROM projects WHERE id = ?')
          .get(existing.project_id) as DbRow;
        if (project) {
          writeTaskMd(project.directory as string, id, updated);
        }

        return toTask(updated);
      },
      {
        body: t.Object({
          title: t.Optional(t.String()),
          description: t.Optional(t.String()),
          column: t.Optional(t.String()),
        }),
      },
    ),
  )

  // ── DELETE /api/tasks/:id ────────────────────────────────────
  .guard(authGuard, (app) =>
    app.delete('/tasks/:id', ({ params: { id }, set }) => {
      const db = getDb();
      const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!existing) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      const project = db
        .query('SELECT directory FROM projects WHERE id = ?')
        .get(existing.project_id) as DbRow;

      db.run('DELETE FROM tasks WHERE id = ?', [id]);

      // Remove .md file
      if (project) {
        removeTaskMd(project.directory as string, id);
      }

      set.status = 200;
      return { deleted: true };
    }),
  )

  // ── PUT /api/tasks/:id/move — change column + update sort ────
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/move',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        const newColumn = body.column;
        if (!['backlog', 'in_progress', 'done'].includes(newColumn)) {
          set.status = 400;
          return { error: 'Invalid column. Must be backlog, in_progress, or done' };
        }

        const now = new Date().toISOString();

        // Get max sort_order in target column
        const maxOrder = db
          .query(
            'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tasks WHERE project_id = ? AND "column" = ?',
          )
          .get(existing.project_id, newColumn) as DbRow;
        const newSortOrder = (maxOrder.max_order as number) + 1;

        db.run(`UPDATE tasks SET "column" = ?, sort_order = ?, updated_at = ? WHERE id = ?`, [
          newColumn,
          newSortOrder,
          now,
          id,
        ]);

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;

        // Sync .md
        const project = db
          .query('SELECT directory FROM projects WHERE id = ?')
          .get(existing.project_id) as DbRow;
        if (project) {
          writeTaskMd(project.directory as string, id, updated);
        }

        return toTask(updated);
      },
      {
        body: t.Object({
          column: t.String(),
        }),
      },
    ),
  )

  // ── PUT /api/tasks/:id/reorder — reorder within column ───────
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/reorder',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        const newSortOrder = body.sortOrder;
        const column = existing['column'] as string;
        const projectId = existing.project_id as string;

        // Shift other tasks: if moving down, decrement those between; if moving up, increment those between
        const oldOrder = existing.sort_order as number;
        if (newSortOrder > oldOrder) {
          db.run(
            `UPDATE tasks SET sort_order = sort_order - 1 WHERE project_id = ? AND "column" = ? AND sort_order > ? AND sort_order <= ?`,
            [projectId, column, oldOrder, newSortOrder],
          );
        } else if (newSortOrder < oldOrder) {
          db.run(
            `UPDATE tasks SET sort_order = sort_order + 1 WHERE project_id = ? AND "column" = ? AND sort_order >= ? AND sort_order < ?`,
            [projectId, column, newSortOrder, oldOrder],
          );
        }

        db.run('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?', [
          newSortOrder,
          new Date().toISOString(),
          id,
        ]);

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;
        return toTask(updated);
      },
      {
        body: t.Object({
          sortOrder: t.Number(),
        }),
      },
    ),
  )

  // ── POST /api/projects/:id/tasks/sync — scan .md files ──────
  .guard(authGuard, (app) =>
    app.post('/projects/:id/tasks/sync', ({ params: { id: projectId }, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT * FROM projects WHERE id = ?')
        .get(projectId) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      const tasksDir = join(project.directory as string, '.opencode', 'tasks');
      if (!existsSync(tasksDir)) {
        return { imported: 0, tasks: [] };
      }

      const files = readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
      const imported: DbRow[] = [];

      for (const file of files) {
        const taskId = file.replace(/\.md$/, '');
        // Skip if task already exists
        const existing = db.query('SELECT id FROM tasks WHERE id = ?').get(taskId) as DbRow | null;
        if (existing) continue;

        try {
          const content = readFileSync(join(tasksDir, file), 'utf-8');
          const parsed = parseTaskMd(content);
          if (!parsed || !parsed.title) continue;

          const now = new Date().toISOString();
          const column =
            parsed.status === 'in_progress'
              ? 'in_progress'
              : parsed.status === 'done'
                ? 'done'
                : 'backlog';

          db.run(
            `INSERT INTO tasks (id, project_id, title, description, source, "column", sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'local', ?, 0, ?, ?)`,
            [taskId, projectId, parsed.title, parsed.description || null, column, now, now],
          );

          const task = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as DbRow;
          imported.push(task);
        } catch (err) {
          console.error(`[tasks] failed to import ${file}:`, (err as Error).message);
        }
      }

      return { imported: imported.length, tasks: imported.map(toTask) };
    }),
  )

  // ── PUT /api/tasks/:id/link-issue — link task to GitHub issue ─
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/link-issue',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        if (!body.githubIssueUrl) {
          set.status = 400;
          return { error: 'githubIssueUrl is required' };
        }

        const now = new Date().toISOString();
        db.run(
          `UPDATE tasks SET github_issue_url = ?, github_issue_number = ?, updated_at = ? WHERE id = ?`,
          [body.githubIssueUrl, body.githubIssueNumber || null, now, id],
        );

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;
        return toTask(updated);
      },
      {
        body: t.Object({
          githubIssueUrl: t.String(),
          githubIssueNumber: t.Optional(t.Number()),
        }),
      },
    ),
  );
