import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve, normalize, sep, basename } from 'node:path';
import { homedir } from 'node:os';

// ── Types ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

interface HarnessEntry {
  id: string;
  name: string;
  description: string;
}

interface FileEntry {
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileEntry[];
}

// ── Helpers ──

/**
 * Resolve the harnesses directory from env or default.
 * Default: ~/.config/opencode/harnesses/
 */
function getHarnessesPath(): string {
  const envPath = process.env.HARNESSES_PATH?.trim();
  if (envPath) return resolve(envPath);
  return join(homedir(), '.config', 'opencode', 'harnesses');
}

/**
 * Read harness metadata from a subdirectory.
 * Looks for harness.json or manifest.json. Falls back to directory name.
 */
function readHarnessMeta(dirPath: string): { name: string; description: string } {
  const harnessJson = join(dirPath, 'harness.json');
  const manifestJson = join(dirPath, 'manifest.json');

  for (const file of [harnessJson, manifestJson]) {
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          name: (parsed.name as string) || '',
          description: (parsed.description as string) || '',
        };
      } catch {
        // Malformed JSON — fall through
      }
    }
  }

  return { name: '', description: '' };
}

/**
 * Recursively count files in a directory (excluding harness.json/manifest.json).
 */
function countFiles(dirPath: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'harness.json' || entry.name === 'manifest.json') continue;
      if (entry.isDirectory()) {
        count += countFiles(join(dirPath, entry.name));
      } else {
        count++;
      }
    }
  } catch {
    // ignore
  }
  return count;
}

/**
 * Sync filesystem harness directories into the DB.
 * - Directories that exist on disk but not in DB are inserted.
 * - DB rows with no corresponding directory are removed.
 */
export function syncHarnessesToDb(): void {
  const rootPath = getHarnessesPath();
  let db;
  try {
    db = getDb();
  } catch {
    return; // DB not initialized yet
  }

  // Get all current FS entries
  const fsIds = new Set<string>();
  if (existsSync(rootPath)) {
    const dirs = readdirSync(rootPath, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
      fsIds.add(dir.name);
    }
  }

  // Get all current DB entries
  const dbRows = db.query('SELECT id, directory FROM harnesses').all() as DbRow[];

  // Upsert FS directories into DB
  const now = new Date().toISOString();
  for (const id of fsIds) {
    const dirPath = join(rootPath, id);
    const meta = readHarnessMeta(dirPath);
    const fileCount = countFiles(dirPath);
    const existing = db.query('SELECT id FROM harnesses WHERE id = ?').get(id) as DbRow | null;
    if (existing) {
      db.run(
        'UPDATE harnesses SET name = ?, description = ?, directory = ?, file_count = ?, updated_at = ? WHERE id = ?',
        [meta.name || id, meta.description, dirPath, fileCount, now, id],
      );
    } else {
      db.run(
        'INSERT INTO harnesses (id, name, description, directory, file_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, meta.name || id, meta.description, dirPath, fileCount, now, now],
      );
    }
  }

  // Remove DB rows that have no corresponding FS directory
  const dbIds = new Set(dbRows.map((r) => r.id as string));
  for (const dbId of dbIds) {
    if (!fsIds.has(dbId)) {
      db.run('DELETE FROM harnesses WHERE id = ?', [dbId]);
    }
  }
}

/**
 * Validate a relative path for harness file operations.
 */
function validateHarnessFilePath(
  harnessDir: string,
  relativePath: string,
): { resolved: string } | { error: string; status: number } {
  if (!relativePath || !relativePath.trim()) {
    return { error: 'path is required', status: 400 };
  }
  if (relativePath.includes('\0')) {
    return { error: 'path contains invalid characters', status: 400 };
  }
  const normalized = normalize(relativePath.replace(/\\/g, '/'));
  if (normalized.startsWith('/')) {
    return { error: 'absolute paths are not allowed', status: 403 };
  }
  const resolved = resolve(harnessDir, normalized);
  if (!resolved.startsWith(harnessDir.endsWith(sep) ? harnessDir : harnessDir + sep)) {
    return { error: 'path traversal detected', status: 403 };
  }
  return { resolved };
}

// ── Shared helper exports (used by projects.ts) ──

/**
 * Resolve the harness directory path given a harness ID.
 * Returns the full path if it exists, or null.
 */
export function resolveHarnessDir(harnessId: string): string | null {
  const rootPath = getHarnessesPath();
  const harnessDir = join(rootPath, harnessId);
  if (!existsSync(harnessDir)) return null;
  return harnessDir;
}

/**
 * Check if a directory is non-empty (has files or subdirectories).
 */
export function isDirNonEmpty(dirPath: string): boolean {
  try {
    const entries = readdirSync(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Copy harness files into a target directory.
 * Returns { copied: string[], conflicts: string[] } or throws.
 * If overwrite is false and conflicts exist, throws with conflict info.
 */
export function copyHarnessToDir(
  harnessId: string,
  targetDir: string,
  overwrite = false,
): { copied: string[]; conflicts: string[] } {
  const harnessDir = resolveHarnessDir(harnessId);
  if (!harnessDir) {
    throw Object.assign(new Error(`harness not found: ${harnessId}`), { status: 400 });
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Detect if target directory has any files (even those not in the harness)
  const targetIsNonEmpty = isDirNonEmpty(targetDir);

  // Detect actual file-name conflicts between harness and target
  const actualConflicts = targetIsNonEmpty ? detectOverwriteConflicts(harnessDir, targetDir) : [];

  if (targetIsNonEmpty && !overwrite) {
    throw Object.assign(
      new Error('Directory not empty. Set overwrite=true to proceed.'),
      { status: 409, conflicts: actualConflicts },
    );
  }

  // Copy all files from harness to target
  const copied = copyFilesRecursive(harnessDir, targetDir, harnessDir);
  return { copied, conflicts: actualConflicts };
}

/**
 * Recursively copy files from source to destination, tracking what was copied.
 */
function copyFilesRecursive(
  sourceDir: string,
  destDir: string,
  baseSourceDir: string,
): string[] {
  const copied: string[] = [];
  try {
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'harness.json' || entry.name === 'manifest.json') continue;
      const srcPath = join(sourceDir, entry.name);
      const dstPath = join(destDir, entry.name);
      if (entry.isDirectory()) {
        if (!existsSync(dstPath)) {
          mkdirSync(dstPath, { recursive: true });
        }
        copied.push(...copyFilesRecursive(srcPath, dstPath, baseSourceDir));
      } else {
        const content = readFileSync(srcPath);
        writeFileSync(dstPath, content);
        const relativePath = srcPath.substring(baseSourceDir.length + 1);
        copied.push(relativePath);
      }
    }
  } catch {
    // ignore
  }
  return copied;
}

/**
 * Detect which files in harnessDir already exist in targetDir.
 * Returns relative paths from the harness root.
 */
export function detectOverwriteConflicts(
  harnessDir: string,
  targetDir: string,
  prefix = '',
): string[] {
  const conflicts: string[] = [];
  try {
    const entries = readdirSync(harnessDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'harness.json' || entry.name === 'manifest.json') continue;
      const harnessPath = join(harnessDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (existsSync(targetPath)) {
          conflicts.push(...detectOverwriteConflicts(harnessPath, targetPath, relPath));
        }
      } else {
        if (existsSync(targetPath)) {
          conflicts.push(relPath);
        }
      }
    }
  } catch {
    // ignore
  }
  return conflicts;
}

/**
 * Recursively build a file tree for a directory.
 */
export function getFileTree(dirPath: string, basePath = ''): FileEntry[] {
  const entries: FileEntry[] = [];
  try {
    const dirEntries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name === 'harness.json' || entry.name === 'manifest.json') continue;
      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push({
          path: relativePath,
          size: 0,
          isDirectory: true,
          children: getFileTree(fullPath, relativePath),
        });
      } else {
        try {
          const stat = statSync(fullPath);
          entries.push({
            path: relativePath,
            size: stat.size,
            isDirectory: false,
          });
        } catch {
          entries.push({
            path: relativePath,
            size: 0,
            isDirectory: false,
          });
        }
      }
    }
  } catch {
    // ignore
  }
  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return entries;
}

/**
 * Get harness DB row by ID, returning 404 if not found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHarnessRow(id: string, set: any): DbRow | null {
  const db = getDb();
  const row = db.query('SELECT * FROM harnesses WHERE id = ?').get(id) as DbRow | null;
  if (!row) {
    set.status = 404;
    return null;
  }
  return row;
}

// ── Ensure harnesses directory exists on boot ──
function ensureHarnessesDir(): void {
  const rootPath = getHarnessesPath();
  if (!existsSync(rootPath)) {
    mkdirSync(rootPath, { recursive: true });
    console.log(`[harnesses] created directory: ${rootPath}`);
  }
}

// ── Run sync on first import ──
// (sync is also called on every GET / to stay fresh, but this ensures
//  the DB is populated on server boot)
ensureHarnessesDir();

// ── Routes ──

export const harnessesRoutes = new Elysia({ prefix: '/api/harnesses' }).guard(authGuard, (app) =>
  app
    // ── GET /api/harnesses ──────────────────────────────────────────
    .get('/', () => {
      // Sync FS -> DB on every list request to stay current.
      // Falls back to filesystem-only if DB is not yet initialized.
      try {
        syncHarnessesToDb();
        const db = getDb();
        const rows = db
          .query('SELECT id, name, description FROM harnesses ORDER BY name ASC')
          .all() as HarnessEntry[];
        return rows;
      } catch {
        // DB not available — return filesystem-only listing (backwards compat)
        const rootPath = getHarnessesPath();
        if (!existsSync(rootPath)) return [];
        const entries: HarnessEntry[] = [];
        try {
          const dirs = readdirSync(rootPath, { withFileTypes: true });
          for (const dir of dirs) {
            if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
            const dirPath = join(rootPath, dir.name);
            const meta = readHarnessMeta(dirPath);
            entries.push({
              id: dir.name,
              name: meta.name || dir.name,
              description: meta.description || '',
            });
          }
        } catch {
          // ignore
        }
        return entries;
      }
    })

    // ── POST /api/harnesses ─────────────────────────────────────────
    .post(
      '/',
      ({ body, set }) => {
        const db = getDb();
        const rootPath = getHarnessesPath();

        // Validate name
        if (!body.name || !body.name.trim()) {
          set.status = 400;
          return { error: 'name is required' };
        }
        const name = body.name.trim();

        // Check for duplicate name (directory-based ID)
        const existing = db.query('SELECT id FROM harnesses WHERE id = ?').get(name) as DbRow | null;
        if (existing) {
          set.status = 409;
          return { error: 'harness name already exists' };
        }

        // Create harness directory
        const harnessDir = join(rootPath, name);
        if (existsSync(harnessDir)) {
          set.status = 409;
          return { error: 'harness directory already exists on disk' };
        }
        mkdirSync(harnessDir, { recursive: true });

        // Write harness.json metadata
        const description = body.description?.trim() || '';
        writeFileSync(
          join(harnessDir, 'harness.json'),
          JSON.stringify({ name, description }, null, 2),
        );

        // Write initial files if provided
        if (body.files && Array.isArray(body.files)) {
          for (const file of body.files) {
            const filePathResult = validateHarnessFilePath(harnessDir, file.path);
            if ('error' in filePathResult) continue; // skip invalid paths
            const dirPath = resolve(filePathResult.resolved, '..');
            if (!existsSync(dirPath)) {
              mkdirSync(dirPath, { recursive: true });
            }
            try {
              writeFileSync(filePathResult.resolved, Buffer.from(file.content, 'base64'));
            } catch {
              // skip files that fail to write
            }
          }
        }

        // Create DB row
        const id = name;
        const now = new Date().toISOString();
        const fileCount = countFiles(harnessDir);

        db.run(
          'INSERT INTO harnesses (id, name, description, directory, file_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, name, description, harnessDir, fileCount, now, now],
        );

        set.status = 201;
        return { id, name, description, fileCount };
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          files: t.Optional(
            t.Array(
              t.Object({
                path: t.String(),
                content: t.String(),
              }),
            ),
          ),
        }),
      },
    )

    // ── PUT /api/harnesses/:id ──────────────────────────────────────
    .put(
      '/:id',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };

        const harnessDir = row.directory as string;
        const now = new Date().toISOString();

        // Update name if provided (rename directory + DB id)
        if (body.name !== undefined && body.name.trim() && body.name.trim() !== id) {
          const newName = body.name.trim();
          const rootPath = getHarnessesPath();
          const newDir = join(rootPath, newName);

          if (existsSync(newDir)) {
            set.status = 409;
            return { error: 'harness name already exists on disk' };
          }

          // Rename directory
          try {
            renameSync(harnessDir, newDir);
          } catch {
            set.status = 500;
            return { error: 'failed to rename harness directory' };
          }

          // Update harness.json
          const newDescription = body.description?.trim() ?? ((row.description as string) || '');
          writeFileSync(
            join(newDir, 'harness.json'),
            JSON.stringify({ name: newName, description: newDescription }, null, 2),
          );

          // Update DB: delete old row, insert new
          const fileCount = countFiles(newDir);
          db.run('DELETE FROM harnesses WHERE id = ?', [id]);
          db.run(
            'INSERT INTO harnesses (id, name, description, directory, file_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newName, newName, newDescription, newDir, fileCount, row.created_at as string, now],
          );

          return {
            id: newName,
            name: newName,
            description: newDescription,
          };
        }

        // Update description only
        if (body.description !== undefined) {
          const description = body.description?.trim() || '';
          db.run('UPDATE harnesses SET description = ?, updated_at = ? WHERE id = ?', [
            description,
            now,
            id,
          ]);

          // Update harness.json on disk
          try {
            const meta = readHarnessMeta(harnessDir);
            writeFileSync(
              join(harnessDir, 'harness.json'),
              JSON.stringify(
                { name: body.name?.trim() || meta.name || id, description },
                null,
                2,
              ),
            );
          } catch {
            // non-fatal
          }
        }

        const updated = db.query('SELECT * FROM harnesses WHERE id = ?').get(id) as DbRow;
        return {
          id: updated.id as string,
          name: updated.name as string,
          description: updated.description as string,
        };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          description: t.Optional(t.String()),
        }),
      },
    )

    // ── DELETE /api/harnesses/:id ───────────────────────────────────
    .delete('/:id', ({ params: { id }, set }) => {
      const db = getDb();
      const row = getHarnessRow(id, set);
      if (!row) return { error: 'harness not found' };

      const harnessDir = row.directory as string;

      // Remove directory
      try {
        rmSync(harnessDir, { recursive: true, force: true });
      } catch {
        set.status = 500;
        return { error: 'failed to delete harness directory' };
      }

      // Remove DB row (cascade sets projects.harness_id to NULL via trigger)
      db.run('DELETE FROM harnesses WHERE id = ?', [id]);

      set.status = 200;
      return { deleted: true };
    })

    // ── GET /api/harnesses/:id/files ────────────────────────────────
    .get('/:id/files', ({ params: { id }, set }) => {
      const row = getHarnessRow(id, set);
      if (!row) return { error: 'harness not found' };

      const harnessDir = row.directory as string;
      const files = getFileTree(harnessDir);

      return {
        id: row.id as string,
        name: row.name as string,
        files,
      };
    })

    // ── POST /api/harnesses/:id/files ───────────────────────────────
    .post(
      '/:id/files',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };

        const harnessDir = row.directory as string;

        // Validate path
        const pathResult = validateHarnessFilePath(harnessDir, body.path);
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        // Check if file already exists
        if (existsSync(pathResult.resolved)) {
          set.status = 409;
          return { error: 'file already exists' };
        }

        // Ensure parent directory exists
        const parentDir = resolve(pathResult.resolved, '..');
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }

        // Write file
        try {
          writeFileSync(pathResult.resolved, Buffer.from(body.content, 'base64'));
        } catch (err) {
          set.status = 500;
          return { error: `failed to write file: ${(err as Error).message}` };
        }

        // Update file count
        const fileCount = countFiles(harnessDir);
        db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [
          fileCount,
          new Date().toISOString(),
          id,
        ]);

        const fileStat = statSync(pathResult.resolved);
        set.status = 201;
        return { path: body.path, size: fileStat.size };
      },
      {
        body: t.Object({
          path: t.String(),
          content: t.String(),
        }),
      },
    )

    // ── DELETE /api/harnesses/:id/files ─────────────────────────────
    .delete('/:id/files', ({ params: { id }, query, set }) => {
      const db = getDb();
      const row = getHarnessRow(id, set);
      if (!row) return { error: 'harness not found' };

      const harnessDir = row.directory as string;

      if (!query.path || !query.path.trim()) {
        set.status = 400;
        return { error: 'path query parameter is required' };
      }

      // Validate path
      const pathResult = validateHarnessFilePath(harnessDir, query.path);
      if ('error' in pathResult) {
        set.status = pathResult.status;
        return { error: pathResult.error };
      }

      // Check if file exists
      if (!existsSync(pathResult.resolved)) {
        set.status = 404;
        return { error: 'file not found' };
      }

      // Delete file or directory
      try {
        rmSync(pathResult.resolved, { recursive: true, force: true });
      } catch {
        set.status = 500;
        return { error: 'failed to delete file' };
      }

      // Update file count
      const fileCount = countFiles(harnessDir);
      db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [
        fileCount,
        new Date().toISOString(),
        id,
      ]);

      set.status = 200;
      return { deleted: true };
    })

    // ══════════════════════════════════════════════════════════════════
    // Harness File Manager routes  /api/harnesses/:id/fm/files/...
    // Mirror the project files API so FileTree+CodeEditor can be reused.
    // ══════════════════════════════════════════════════════════════════

    // ── GET /api/harnesses/:id/fm/files?path= ── list directory ──────
    .get(
      '/:id/fm/files',
      ({ params: { id }, query, set }) => {
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const dirPath = query.path ?? '';
        let resolvedDir: string;
        if (dirPath === '') {
          resolvedDir = harnessDir;
        } else {
          const r = validateHarnessFilePath(harnessDir, dirPath);
          if ('error' in r) { set.status = r.status; return { error: r.error }; }
          resolvedDir = r.resolved;
        }

        if (!existsSync(resolvedDir)) { set.status = 404; return { error: 'directory not found' }; }
        if (!statSync(resolvedDir).isDirectory()) { set.status = 400; return { error: 'path is not a directory' }; }

        const entries = readdirSync(resolvedDir, { withFileTypes: true });
        return entries
          .filter((e) => e.name !== 'harness.json' && e.name !== 'manifest.json')
          .map((e) => {
            const full = join(resolvedDir, e.name);
            const s = statSync(full);
            return {
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
              size: e.isDirectory() ? 0 : s.size,
              modifiedAt: s.mtime.toISOString(),
            };
          });
      },
      { query: t.Object({ path: t.Optional(t.String()) }) },
    )

    // ── GET /api/harnesses/:id/fm/files/read?path= ── read file ──────
    .get(
      '/:id/fm/files/read',
      ({ params: { id }, query, set }) => {
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const r = validateHarnessFilePath(harnessDir, query.path);
        if ('error' in r) { set.status = r.status; return { error: r.error }; }
        if (!existsSync(r.resolved)) { set.status = 404; return { error: 'file not found' }; }
        if (statSync(r.resolved).isDirectory()) { set.status = 400; return { error: 'path is a directory' }; }

        const stat = statSync(r.resolved);
        const MAX_READ = 2 * 1024 * 1024; // 2 MB
        if (stat.size > MAX_READ) { set.status = 413; return { error: 'file too large to read (max 2MB)' }; }

        const content = readFileSync(r.resolved, 'utf-8');
        return { content, size: stat.size, encoding: 'utf-8', modifiedAt: stat.mtime.toISOString() };
      },
      { query: t.Object({ path: t.String() }) },
    )

    // ── PUT /api/harnesses/:id/fm/files/write?path= ── write file ────
    .put(
      '/:id/fm/files/write',
      ({ params: { id }, query, body, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const r = validateHarnessFilePath(harnessDir, query.path);
        if ('error' in r) { set.status = r.status; return { error: r.error }; }

        const parentDir = resolve(r.resolved, '..');
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

        writeFileSync(r.resolved, body.content, 'utf-8');
        const s = statSync(r.resolved);

        const fileCount = countFiles(harnessDir);
        db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [fileCount, new Date().toISOString(), id]);

        return { modifiedAt: s.mtime.toISOString() };
      },
      {
        query: t.Object({ path: t.String() }),
        body: t.Object({ content: t.String() }),
      },
    )

    // ── PUT /api/harnesses/:id/fm/files/rename ── rename / move ──────
    .put(
      '/:id/fm/files/rename',
      ({ params: { id }, body, set }) => {
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const src = validateHarnessFilePath(harnessDir, body.oldPath);
        if ('error' in src) { set.status = src.status; return { error: src.error }; }
        const dst = validateHarnessFilePath(harnessDir, body.newPath);
        if ('error' in dst) { set.status = dst.status; return { error: dst.error }; }

        if (!existsSync(src.resolved)) { set.status = 404; return { error: 'source not found' }; }
        if (existsSync(dst.resolved)) { set.status = 409; return { error: 'destination already exists' }; }

        const parentDir = resolve(dst.resolved, '..');
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

        renameSync(src.resolved, dst.resolved);
        return { ok: true };
      },
      {
        body: t.Object({ oldPath: t.String(), newPath: t.String() }),
      },
    )

    // ── POST /api/harnesses/:id/fm/files ── create file or directory ─
    .post(
      '/:id/fm/files',
      ({ params: { id }, body, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const r = validateHarnessFilePath(harnessDir, body.path);
        if ('error' in r) { set.status = r.status; return { error: r.error }; }
        if (existsSync(r.resolved)) { set.status = 409; return { error: 'already exists' }; }

        const parentDir = resolve(r.resolved, '..');
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

        if (body.type === 'directory') {
          mkdirSync(r.resolved, { recursive: true });
        } else {
          writeFileSync(r.resolved, '', 'utf-8');
        }

        const fileCount = countFiles(harnessDir);
        db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [fileCount, new Date().toISOString(), id]);

        set.status = 201;
        return { ok: true };
      },
      {
        body: t.Object({ path: t.String(), type: t.Union([t.Literal('file'), t.Literal('directory')]) }),
      },
    )

    // ── DELETE /api/harnesses/:id/fm/files?path=&force= ── delete ────
    .delete(
      '/:id/fm/files',
      ({ params: { id }, query, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        if (!query.path?.trim()) { set.status = 400; return { error: 'path required' }; }

        const r = validateHarnessFilePath(harnessDir, query.path);
        if ('error' in r) { set.status = r.status; return { error: r.error }; }
        if (!existsSync(r.resolved)) { set.status = 404; return { error: 'not found' }; }

        const isDir = statSync(r.resolved).isDirectory();
        if (isDir && query.force !== 'true') { set.status = 400; return { error: 'use force=true to delete directories' }; }

        rmSync(r.resolved, { recursive: true, force: true });

        const fileCount = countFiles(harnessDir);
        db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [fileCount, new Date().toISOString(), id]);

        set.status = 200;
        return { deleted: true };
      },
      { query: t.Object({ path: t.Optional(t.String()), force: t.Optional(t.String()) }) },
    )

    // ── POST /api/harnesses/:id/fm/files/upload?path= ── multipart ───
    .post(
      '/:id/fm/files/upload',
      async ({ params: { id }, query, request, set }) => {
        const db = getDb();
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const targetPath = query.path ?? '';
        let resolvedDir: string;
        if (targetPath === '') {
          resolvedDir = harnessDir;
        } else {
          const r = validateHarnessFilePath(harnessDir, targetPath);
          if ('error' in r) { set.status = r.status; return { error: r.error }; }
          resolvedDir = r.resolved;
        }

        if (!existsSync(resolvedDir)) mkdirSync(resolvedDir, { recursive: true });
        if (!statSync(resolvedDir).isDirectory()) { set.status = 400; return { error: 'target is not a directory' }; }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rawForm: any;
        try {
          rawForm = await request.formData();
        } catch {
          set.status = 400;
          return { error: 'invalid multipart form data' };
        }

        const file = rawForm.get('file');
        if (!file || !(file instanceof File)) { set.status = 400; return { error: 'missing file field' }; }

        const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB
        if (file.size > MAX_UPLOAD) { set.status = 413; return { error: 'file too large (max 50MB)' }; }

        const destPath = join(resolvedDir, file.name);
        const fileResult = validateHarnessFilePath(harnessDir, destPath.slice(harnessDir.length + 1));
        if ('error' in fileResult) { set.status = fileResult.status; return { error: fileResult.error }; }

        if (existsSync(fileResult.resolved)) { set.status = 409; return { error: 'file already exists' }; }

        const buffer = Buffer.from(await file.arrayBuffer());
        const tmpPath = fileResult.resolved + '.tmp.' + Math.random().toString(36).slice(2, 10);
        try {
          writeFileSync(tmpPath, buffer);
          renameSync(tmpPath, fileResult.resolved);
        } catch (err) {
          try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
          set.status = 500;
          return { error: `write failed: ${(err as Error).message}` };
        }

        const fileCount = countFiles(harnessDir);
        db.run('UPDATE harnesses SET file_count = ?, updated_at = ? WHERE id = ?', [fileCount, new Date().toISOString(), id]);

        const s = statSync(fileResult.resolved);
        set.status = 201;
        return { path: file.name, size: s.size };
      },
      { query: t.Object({ path: t.Optional(t.String()) }) },
    )

    // ── GET /api/harnesses/:id/fm/files/download?path= ── download ───
    .get(
      '/:id/fm/files/download',
      ({ params: { id }, query, set }) => {
        const row = getHarnessRow(id, set);
        if (!row) return { error: 'harness not found' };
        const harnessDir = row.directory as string;

        const r = validateHarnessFilePath(harnessDir, query.path);
        if ('error' in r) { set.status = r.status; return { error: r.error }; }
        if (!existsSync(r.resolved)) { set.status = 404; return { error: 'file not found' }; }
        const s = statSync(r.resolved);
        if (s.isDirectory()) { set.status = 400; return { error: 'cannot download a directory' }; }

        const MAX_DOWNLOAD = 50 * 1024 * 1024;
        if (s.size > MAX_DOWNLOAD) { set.status = 413; return { error: 'file too large (max 50MB)' }; }

        const content = readFileSync(r.resolved);
        return new Response(content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${basename(r.resolved)}"`,
            'Content-Length': String(s.size),
          },
        });
      },
      { query: t.Object({ path: t.String() }) },
    )
);
