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
import { join } from 'node:path';
import { getPtyManager } from '../pty/manager';
import { getSessionMetaByProject } from './sessions';
import { getAttachmentsDir, getDataDir, resolveSafePath } from '../lib/dataDir';
import { toLabel, type LabelDto } from './labels';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Attachment DTO returned in enriched task responses. */
export interface AttachmentDto {
  id: string;
  taskId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

function toAttachment(row: DbRow): AttachmentDto {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    filename: row.filename as string,
    mime: row.mime as string,
    size: row.size as number,
    createdAt: row.created_at as string,
  };
}

/** Fetch labels applied to a task. */
function getTaskLabels(db: ReturnType<typeof getDb>, taskId: string): LabelDto[] {
  const rows = db
    .query(
      `SELECT l.* FROM labels l
       JOIN task_labels tl ON tl.label_id = l.id
       WHERE tl.task_id = ?
       ORDER BY l.name COLLATE NOCASE ASC`,
    )
    .all(taskId) as DbRow[];
  return rows.map(toLabel);
}

/** Fetch attachment metadata for a task. */
function getTaskAttachments(db: ReturnType<typeof getDb>, taskId: string): AttachmentDto[] {
  const rows = db
    .query('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as DbRow[];
  return rows.map(toAttachment);
}

/**
 * Derive the live session status for an associated session_id.
 * Sessions are volatile (reset on restart). null/exited/killed → 'expired';
 * any tracked status otherwise → 'active'. No association → null.
 */
function deriveSessionStatus(sessionId: string | null): 'active' | 'expired' | null {
  if (!sessionId) return null;
  const status = getPtyManager().getSessionStatus(sessionId);
  if (status === null || status === 'exited' || status === 'killed') return 'expired';
  return 'active';
}

/**
 * Map a raw DB row to the API response shape, enriched with labels,
 * attachments, and live session status.
 */
function toTask(row: DbRow) {
  let labels: unknown = null;
  if (row.github_labels) {
    try {
      labels = JSON.parse(row.github_labels as string);
    } catch {
      labels = null;
    }
  }
  const db = getDb();
  const taskId = row.id as string;
  const sessionId = (row.session_id as string) || null;
  return {
    id: taskId,
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
    sessionId,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    labels: getTaskLabels(db, taskId),
    attachments: getTaskAttachments(db, taskId),
    sessionStatus: deriveSessionStatus(sessionId),
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
  )

  // ── PUT /api/tasks/:id/labels — replace applied labels ──
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/labels',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const task = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!task) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        const labelIds = Array.isArray(body.labelIds) ? body.labelIds : [];

        // Validate every label belongs to the task's project
        for (const labelId of labelIds) {
          const label = db
            .query('SELECT id, project_id FROM labels WHERE id = ?')
            .get(labelId) as DbRow | null;
          if (!label) {
            set.status = 400;
            return { error: `Label not found: ${labelId}` };
          }
          if (label.project_id !== task.project_id) {
            set.status = 400;
            return { error: `Label ${labelId} does not belong to the task's project` };
          }
        }

        // Replace the set of applied labels
        db.run('DELETE FROM task_labels WHERE task_id = ?', [id]);
        for (const labelId of labelIds) {
          db.run('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)', [
            id,
            labelId,
          ]);
        }

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;
        return toTask(updated);
      },
      {
        body: t.Object({
          labelIds: t.Array(t.String()),
        }),
      },
    ),
  )

  // ── POST /api/tasks/:id/attachments — upload attachment (multipart) ──
  .guard(authGuard, (app) =>
    app.post('/tasks/:id/attachments', async ({ params: { id }, request, set }) => {
      const db = getDb();
      const task = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawForm: any;
      try {
        rawForm = await request.formData();
      } catch {
        set.status = 400;
        return { error: 'invalid multipart form data' };
      }

      const file = rawForm.get('file');
      if (!file || !(file instanceof File)) {
        set.status = 400;
        return { error: 'missing file field' };
      }

      const MAX = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX) {
        set.status = 413;
        return { error: 'file too large (max 10MB)' };
      }

      const ext = ATTACHMENT_MIME_WHITELIST[file.type];
      if (!ext) {
        set.status = 415;
        return { error: `unsupported file type: ${file.type || 'unknown'}` };
      }

      const attId = crypto.randomUUID();
      const now = new Date().toISOString();
      const filename = `${attId}${ext}`;
      const dir = getAttachmentsDir(id);

      // All file I/O goes through resolveSafePath against the neutral base dir
      const pathResult = resolveSafePath(dir, filename);
      if ('error' in pathResult) {
        set.status = pathResult.status;
        return { error: pathResult.error };
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(pathResult.resolved, buffer);

      const relPath = join('attachments', id, filename);
      const originalName = (file.name as string) || filename;
      db.run(
        `INSERT INTO task_attachments (id, task_id, filename, rel_path, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [attId, id, originalName, relPath, file.type, file.size, now],
      );

      const row = db.query('SELECT * FROM task_attachments WHERE id = ?').get(attId) as DbRow;
      set.status = 201;
      return toAttachment(row);
    }),
  )

  // ── GET /api/tasks/:id/attachments — list attachments ──
  .guard(authGuard, (app) =>
    app.get('/tasks/:id/attachments', ({ params: { id }, set }) => {
      const db = getDb();
      const task = db.query('SELECT id FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return getTaskAttachments(db, id);
    }),
  )

  // ── GET /api/tasks/:id/attachments/:attId — serve binary ──
  .guard(authGuard, (app) =>
    app.get('/tasks/:id/attachments/:attId', ({ params: { id, attId }, set }) => {
      const db = getDb();
      const row = db
        .query('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?')
        .get(attId, id) as DbRow | null;
      if (!row) {
        set.status = 404;
        return { error: 'Attachment not found' };
      }

      // Resolve the stored rel_path safely against the neutral data dir
      const pathResult = resolveSafePath(getDataDir(), row.rel_path as string);
      if ('error' in pathResult) {
        set.status = pathResult.status;
        return { error: pathResult.error };
      }
      if (!existsSync(pathResult.resolved)) {
        set.status = 404;
        return { error: 'Attachment file missing on disk' };
      }

      const buffer = readFileSync(pathResult.resolved);
      const contentType = (row.mime as string) || 'application/octet-stream';
      // Defense-in-depth: prevent MIME sniffing so a mislabeled/crafted file
      // cannot be reinterpreted as executable content (e.g. HTML/SVG) by the browser.
      set.headers['Content-Type'] = contentType;
      set.headers['X-Content-Type-Options'] = 'nosniff';
      set.headers['Content-Disposition'] =
        `inline; filename="${(row.filename as string).replace(/"/g, '')}"`;
      return new Response(buffer, {
        headers: {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `inline; filename="${(row.filename as string).replace(/"/g, '')}"`,
        },
      });
    }),
  )

  // ── DELETE /api/tasks/:id/attachments/:attId — remove row + file ──
  .guard(authGuard, (app) =>
    app.delete('/tasks/:id/attachments/:attId', ({ params: { id, attId }, set }) => {
      const db = getDb();
      const row = db
        .query('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?')
        .get(attId, id) as DbRow | null;
      if (!row) {
        set.status = 404;
        return { error: 'Attachment not found' };
      }

      const pathResult = resolveSafePath(getDataDir(), row.rel_path as string);
      if (!('error' in pathResult) && existsSync(pathResult.resolved)) {
        try {
          unlinkSync(pathResult.resolved);
        } catch (err) {
          console.error(
            `[tasks] failed to delete attachment file ${row.rel_path}:`,
            (err as Error).message,
          );
        }
      }

      db.run('DELETE FROM task_attachments WHERE id = ?', [attId]);
      set.status = 200;
      return { deleted: true };
    }),
  )

  // ── PUT /api/tasks/:id/session — associate/dissociate a session ──
  .guard(authGuard, (app) =>
    app.put(
      '/tasks/:id/session',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const task = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
        if (!task) {
          set.status = 404;
          return { error: 'Task not found' };
        }

        const sessionId = body.sessionId ?? null;

        if (sessionId !== null) {
          // Session must exist and belong to the task's project.
          const projectSessions = getSessionMetaByProject(task.project_id as string);
          const match = projectSessions.find((s) => s.sessionId === sessionId);
          if (!match) {
            set.status = 400;
            return { error: 'Session does not exist or does not belong to this task\'s project' };
          }
        }

        const now = new Date().toISOString();
        db.run('UPDATE tasks SET session_id = ?, updated_at = ? WHERE id = ?', [
          sessionId,
          now,
          id,
        ]);

        const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow;
        return toTask(updated);
      },
      {
        body: t.Object({
          sessionId: t.Union([t.String(), t.Null()]),
        }),
      },
    ),
  )

  // ── POST /api/tasks/:id/implement — inject prompt into associated session ──
  .guard(authGuard, (app) =>
    app.post('/tasks/:id/implement', ({ params: { id }, set }) => {
      const db = getDb();
      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | null;
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      const sessionId = (task.session_id as string) || null;
      if (!sessionId) {
        set.status = 409;
        return { error: 'No session associated with this task. Associate a session first.' };
      }

      const status = deriveSessionStatus(sessionId);
      if (status !== 'active') {
        set.status = 409;
        return {
          error: 'The associated session has expired. Re-associate a live session.',
        };
      }

      const prompt = buildImplementPrompt(db, task);
      getPtyManager().writeToSession(sessionId, prompt + '\n');

      return { started: true };
    }),
  );

/** Whitelisted attachment MIME types → file extension. */
const ATTACHMENT_MIME_WHITELIST: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  // NOTE: image/svg+xml is intentionally excluded. SVG can embed <script> and
  // would execute as stored-XSS on the app origin when served inline.
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/zip': '.zip',
};

/**
 * Build a deterministic implementation prompt from a task: title, body
 * (markdown description) and absolute paths of attachments. CLI-agnostic plain
 * text injected via PTY stdin.
 *
 * Acceptance criteria: in Fase A there is no separate structured criteria field.
 * Acceptance criteria live INSIDE the markdown body (`task.description`), so they
 * are already included in the prompt by emitting the full description verbatim.
 * Fase B may introduce a dedicated criteria field; when it does, append it here.
 */
function buildImplementPrompt(db: ReturnType<typeof getDb>, task: DbRow): string {
  const lines: string[] = [];
  lines.push(`# Task: ${task.title as string}`);
  lines.push('');
  if (task.description) {
    // Full markdown body — includes acceptance criteria embedded in the body (Fase A).
    lines.push(task.description as string);
    lines.push('');
  }

  const attachments = db
    .query('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC')
    .all(task.id as string) as DbRow[];
  if (attachments.length > 0) {
    lines.push('## Attachments');
    const dataDir = getDataDir();
    for (const att of attachments) {
      lines.push(`- ${att.filename as string}: ${join(dataDir, att.rel_path as string)}`);
    }
    lines.push('');
  }

  lines.push('Please implement this task.');
  return lines.join('\n');
}
