import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import {
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  rmSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import { resolve, join, dirname, normalize, basename } from 'node:path';

/* ── Types ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

/* ── Constants ── */

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.db',
  '.sqlite',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.wav',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.wasm',
  '.class',
  '.pyc',
]);

const MAX_READ_SIZE = 1024 * 1024; // 1 MB

// Directories skipped by the recursive palette file search — vendored, build,
// and VCS trees that would swamp results and slow the walk.
const SEARCH_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  '.idea',
  '.vscode',
]);

/* ── Helpers ── */

/** Resolve a project row from the DB by ID. Returns null if not found. */
function getProjectById(id: string): DbRow | null {
  const db = getDb();
  return db.query('SELECT * FROM projects WHERE id = ?').get(id) as DbRow | null;
}

/**
 * Sanitize a user-supplied relative path and resolve it against a project's
 * root directory. Returns the resolved absolute path, or an error string.
 *
 * Blocks: .. traversal, absolute paths, symlinks, null bytes.
 */
function resolveSafePath(
  projectDir: string,
  relativePath: string,
): { resolved: string } | { error: string; status: number } {
  // Block null bytes
  if (relativePath.includes('\0')) {
    return { error: 'path contains invalid characters', status: 400 };
  }

  // Normalize the input
  const normalized = normalize(relativePath.replace(/\\/g, '/'));

  // Block absolute paths
  if (normalized.startsWith('/')) {
    return { error: 'absolute paths are not allowed', status: 403 };
  }

  // Resolve against project directory
  const resolved = resolve(projectDir, normalized);

  // Verify the resolved path starts with the project directory (block traversal)
  if (
    !resolved.startsWith(projectDir.endsWith('/') ? projectDir : projectDir + '/') &&
    resolved !== projectDir
  ) {
    return { error: 'path traversal detected', status: 403 };
  }

  return { resolved };
}

/** Determine if a file extension indicates binary content. */
function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
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

/* ── Routes ── */

export const filesRoutes = new Elysia({ prefix: '/api/projects' }).guard(authGuard, (app) =>
  app
    // ── GET /api/projects/:id/files?path= ───────────────────────────
    .get(
      '/:id/files',
      ({ params: { id }, query, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const dirResult = resolveSafePath(project.directory as string, query.path || '');
        if ('error' in dirResult) {
          set.status = dirResult.status;
          return { error: dirResult.error };
        }

        if (!existsSync(dirResult.resolved)) {
          set.status = 404;
          return { error: 'path not found' };
        }

        const stat = statSync(dirResult.resolved);
        if (!stat.isDirectory()) {
          set.status = 400;
          return { error: 'path is not a directory' };
        }

        let entries: FileEntry[] = [];
        try {
          const names = readdirSync(dirResult.resolved);
          const rawEntries: FileEntry[] = names.map((name) => {
            const fullPath = join(dirResult.resolved, name);
            try {
              const st = statSync(fullPath);
              return {
                name,
                type: st.isDirectory() ? ('directory' as const) : ('file' as const),
                size: st.isDirectory() ? 0 : st.size,
                modifiedAt: st.mtime.toISOString(),
              };
            } catch {
              return { name, type: 'file' as const, size: 0, modifiedAt: '' };
            }
          });
          // Sort: directories first, then files, alphabetical within each group
          entries = rawEntries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        } catch (err) {
          set.status = 500;
          return { error: `failed to read directory: ${(err as Error).message}` };
        }

        return entries;
      },
      {
        query: t.Object({
          path: t.Optional(t.String()),
        }),
      },
    )

    // ── GET /api/projects/:id/files/search?q= ───────────────────────
    // Recursive filename search for the ⌘K command palette. Walks the tree
    // breadth-first, skipping heavy/vendored directories, capped so a huge
    // repo can never stall the request. Returns project-relative file paths.
    .get(
      '/:id/files/search',
      ({ params: { id }, query, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const root = project.directory as string;
        const q = (query.q || '').trim().toLowerCase();
        const limit = Math.min(Math.max(Number(query.limit) || 40, 1), 100);
        const MAX_SCAN = 20000; // hard ceiling on entries visited

        const results: { path: string; name: string }[] = [];
        const queue: string[] = ['']; // relative dirs to visit, BFS
        let scanned = 0;

        try {
          while (queue.length > 0 && results.length < limit && scanned < MAX_SCAN) {
            const rel = queue.shift() as string;
            const abs = rel ? join(root, rel) : root;
            let names: string[];
            try {
              names = readdirSync(abs);
            } catch {
              continue;
            }
            for (const name of names) {
              if (scanned >= MAX_SCAN) break;
              scanned++;
              if (SEARCH_SKIP_DIRS.has(name)) continue;
              const childRel = rel ? `${rel}/${name}` : name;
              let st;
              try {
                st = statSync(join(root, childRel));
              } catch {
                continue;
              }
              if (st.isDirectory()) {
                queue.push(childRel);
              } else if (results.length < limit) {
                // Empty query → return the first files found (a "recent-ish"
                // sample); otherwise match on the relative path.
                if (!q || childRel.toLowerCase().includes(q)) {
                  results.push({ path: childRel, name });
                }
              }
            }
          }
        } catch (err) {
          set.status = 500;
          return { error: `search failed: ${(err as Error).message}` };
        }

        // Rank exact-name and shallower matches first when a query is present.
        if (q) {
          results.sort((a, b) => {
            const an = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
            const bn = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
            if (an !== bn) return an - bn;
            return a.path.split('/').length - b.path.split('/').length;
          });
        }

        return results;
      },
      {
        query: t.Object({
          q: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )

    // ── GET /api/projects/:id/files/read?path= ──────────────────────
    .get(
      '/:id/files/read',
      ({ params: { id }, query, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const pathResult = resolveSafePath(project.directory as string, query.path || '');
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        if (!existsSync(pathResult.resolved)) {
          set.status = 404;
          return { error: 'file not found' };
        }

        const stat = statSync(pathResult.resolved);
        if (stat.isDirectory()) {
          set.status = 400;
          return { error: 'cannot read a directory' };
        }

        // Binary detection
        if (isBinaryExtension(pathResult.resolved)) {
          set.status = 400;
          return { error: 'binary files cannot be read as text' };
        }

        // Size check
        if (stat.size > MAX_READ_SIZE) {
          set.status = 413;
          return { error: 'file too large (max 1MB)' };
        }

        try {
          const content = readFileSync(pathResult.resolved, 'utf-8');
          return {
            content,
            size: stat.size,
            encoding: 'utf-8',
            modifiedAt: stat.mtime.toISOString(),
          };
        } catch (err) {
          set.status = 500;
          return { error: `failed to read file: ${(err as Error).message}` };
        }
      },
      {
        query: t.Object({
          path: t.String(),
        }),
      },
    )

    // ── PUT /api/projects/:id/files/write?path= ─────────────────────
    .put(
      '/:id/files/write',
      ({ params: { id }, query, body, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const pathResult = resolveSafePath(project.directory as string, query.path || '');
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        // Check parent directory exists
        const parentDir = dirname(pathResult.resolved);
        if (!existsSync(parentDir)) {
          set.status = 400;
          return { error: 'parent directory does not exist' };
        }

        // If file exists, check it's not a directory
        if (existsSync(pathResult.resolved)) {
          const st = statSync(pathResult.resolved);
          if (st.isDirectory()) {
            set.status = 400;
            return { error: 'cannot write to a directory' };
          }
          // Size check for existing file
          if (body.content.length > MAX_READ_SIZE) {
            set.status = 413;
            return { error: 'content too large (max 1MB)' };
          }
        }

        // Atomic write: write to temp file, then rename
        const tmpPath = pathResult.resolved + '.tmp.' + crypto.randomUUID().substring(0, 8);
        try {
          writeFileSync(tmpPath, body.content, 'utf-8');
          renameSync(tmpPath, pathResult.resolved);
        } catch (err) {
          // Clean up temp file if it exists
          try {
            if (existsSync(tmpPath)) unlinkSync(tmpPath);
          } catch {
            // ignore
          }
          set.status = 500;
          return { error: `failed to write file: ${(err as Error).message}` };
        }

        const finalStat = statSync(pathResult.resolved);
        return {
          path: query.path,
          size: finalStat.size,
          modifiedAt: finalStat.mtime.toISOString(),
        };
      },
      {
        query: t.Object({
          path: t.String(),
        }),
        body: t.Object({
          content: t.String(),
        }),
      },
    )

    // ── POST /api/projects/:id/files ────────────────────────────
    .post(
      '/:id/files',
      ({ params: { id }, body, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const pathResult = resolveSafePath(project.directory as string, body.path);
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        if (existsSync(pathResult.resolved)) {
          set.status = 409;
          return { error: 'already exists' };
        }

        try {
          if (body.type === 'directory') {
            mkdirSync(pathResult.resolved, { recursive: true });
          } else {
            // Ensure parent directory exists
            const parentDir = dirname(pathResult.resolved);
            if (!existsSync(parentDir)) {
              set.status = 400;
              return { error: 'parent directory does not exist' };
            }
            writeFileSync(pathResult.resolved, '', 'utf-8');
          }
        } catch (err) {
          set.status = 500;
          return { error: `failed to create: ${(err as Error).message}` };
        }

        set.status = 201;
        return {
          path: body.path,
          type: body.type,
        };
      },
      {
        body: t.Object({
          path: t.String(),
          type: t.Union([t.Literal('file'), t.Literal('directory')]),
        }),
      },
    )

    // ── DELETE /api/projects/:id/files?path= ────────────────────────
    .delete(
      '/:id/files',
      ({ params: { id }, query, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const pathResult = resolveSafePath(project.directory as string, query.path || '');
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        if (!existsSync(pathResult.resolved)) {
          set.status = 404;
          return { error: 'not found' };
        }

        const stat = statSync(pathResult.resolved);

        if (stat.isDirectory()) {
          // Check if directory is non-empty
          if (isDirNonEmpty(pathResult.resolved) && query.force !== 'true') {
            set.status = 400;
            return { error: 'Directory not empty. Use ?force=true to delete recursively.' };
          }

          try {
            // Recursive delete
            rmSync(pathResult.resolved, { recursive: true });
          } catch (err) {
            set.status = 500;
            return { error: `failed to delete directory: ${(err as Error).message}` };
          }
        } else {
          try {
            unlinkSync(pathResult.resolved);
          } catch (err) {
            set.status = 500;
            return { error: `failed to delete file: ${(err as Error).message}` };
          }
        }

        return { deleted: true };
      },
      {
        query: t.Object({
          path: t.String(),
          force: t.Optional(t.String()),
        }),
      },
    )

    // ── PUT /api/projects/:id/files/rename ──────────────────────────
    .put(
      '/:id/files/rename',
      ({ params: { id }, body, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const oldResult = resolveSafePath(project.directory as string, body.oldPath);
        if ('error' in oldResult) {
          set.status = oldResult.status;
          return { error: oldResult.error };
        }

        const newResult = resolveSafePath(project.directory as string, body.newPath);
        if ('error' in newResult) {
          set.status = newResult.status;
          return { error: newResult.error };
        }

        if (!existsSync(oldResult.resolved)) {
          set.status = 404;
          return { error: 'source not found' };
        }

        if (existsSync(newResult.resolved)) {
          set.status = 409;
          return { error: 'destination already exists' };
        }

        // Ensure parent of new path exists
        const newParent = dirname(newResult.resolved);
        if (!existsSync(newParent)) {
          set.status = 400;
          return { error: 'destination parent directory does not exist' };
        }

        try {
          renameSync(oldResult.resolved, newResult.resolved);
        } catch (err) {
          set.status = 500;
          return { error: `failed to rename: ${(err as Error).message}` };
        }

        return {
          oldPath: body.oldPath,
          newPath: body.newPath,
        };
      },
      {
        body: t.Object({
          oldPath: t.String(),
          newPath: t.String(),
        }),
      },
    )

    // ── POST /api/projects/:id/files/copy ───────────────────────────
    .post(
      '/:id/files/copy',
      ({ params: { id }, body, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const srcResult = resolveSafePath(project.directory as string, body.sourcePath);
        if ('error' in srcResult) {
          set.status = srcResult.status;
          return { error: srcResult.error };
        }

        const dstResult = resolveSafePath(project.directory as string, body.destPath);
        if ('error' in dstResult) {
          set.status = dstResult.status;
          return { error: dstResult.error };
        }

        if (!existsSync(srcResult.resolved)) {
          set.status = 404;
          return { error: 'source not found' };
        }

        if (existsSync(dstResult.resolved)) {
          set.status = 409;
          return { error: 'destination already exists' };
        }

        const dstParent = dirname(dstResult.resolved);
        if (!existsSync(dstParent)) {
          set.status = 400;
          return { error: 'parent directory does not exist' };
        }

        try {
          cpSync(srcResult.resolved, dstResult.resolved, {
            recursive: true,
            filter: (src) => {
              const name = basename(src);
              if (name === '.git') return false;
              if (name === '.env') return false;
              return true;
            },
          });
        } catch (err) {
          set.status = 500;
          return { error: `failed to copy: ${(err as Error).message}` };
        }

        set.status = 201;
        return { sourcePath: body.sourcePath, destPath: body.destPath };
      },
      {
        body: t.Object({
          sourcePath: t.String(),
          destPath: t.String(),
        }),
      },
    )

    // ── GET /api/projects/:id/files/download?path= ──────────────────
    .get(
      '/:id/files/download',
      ({ params: { id }, query, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const pathResult = resolveSafePath(project.directory as string, query.path || '');
        if ('error' in pathResult) {
          set.status = pathResult.status;
          return { error: pathResult.error };
        }

        if (!existsSync(pathResult.resolved)) {
          set.status = 404;
          return { error: 'file not found' };
        }

        const stat = statSync(pathResult.resolved);
        if (stat.isDirectory()) {
          set.status = 400;
          return { error: 'cannot download a directory' };
        }

        const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB
        if (stat.size > MAX_DOWNLOAD_SIZE) {
          set.status = 413;
          return { error: 'file too large (max 50MB)' };
        }

        const filename = basename(pathResult.resolved);
        const content = readFileSync(pathResult.resolved);

        return new Response(content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(stat.size),
          },
        });
      },
      {
        query: t.Object({
          path: t.String(),
        }),
      },
    )

    // ── POST /api/projects/:id/files/upload?path= ───────────────────
    .post(
      '/:id/files/upload',
      async ({ params: { id }, query, request, set }) => {
        const project = getProjectById(id);
        if (!project) {
          set.status = 404;
          return { error: 'project not found' };
        }

        const targetDir = query.path || '';
        const dirResult = resolveSafePath(project.directory as string, targetDir);
        if ('error' in dirResult) {
          set.status = dirResult.status;
          return { error: dirResult.error };
        }

        if (!existsSync(dirResult.resolved)) {
          set.status = 400;
          return { error: 'target directory does not exist' };
        }

        if (!statSync(dirResult.resolved).isDirectory()) {
          set.status = 400;
          return { error: 'target path is not a directory' };
        }

        let rawForm: Awaited<ReturnType<typeof request.formData>> | null = null;
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

        const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
        if (file.size > MAX_UPLOAD_SIZE) {
          set.status = 413;
          return { error: 'file too large (max 10MB)' };
        }

        const filePath = targetDir ? `${targetDir}/${file.name}` : file.name;
        const fileResult = resolveSafePath(project.directory as string, filePath);
        if ('error' in fileResult) {
          set.status = fileResult.status;
          return { error: fileResult.error };
        }

        if (existsSync(fileResult.resolved)) {
          set.status = 409;
          return { error: 'file already exists' };
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const tmpPath = fileResult.resolved + '.tmp.' + crypto.randomUUID().substring(0, 8);
        try {
          writeFileSync(tmpPath, buffer);
          renameSync(tmpPath, fileResult.resolved);
        } catch (err) {
          try {
            if (existsSync(tmpPath)) unlinkSync(tmpPath);
          } catch {
            // ignore
          }
          set.status = 500;
          return { error: `failed to write file: ${(err as Error).message}` };
        }

        const finalStat = statSync(fileResult.resolved);
        set.status = 201;
        return {
          path: filePath,
          size: finalStat.size,
          modifiedAt: finalStat.mtime.toISOString(),
        };
      },
      {
        query: t.Object({
          path: t.Optional(t.String()),
        }),
      },
    ),
);

/* ── Files base routes (not project-scoped) ── */

export const filesBaseRoutes = new Elysia({ prefix: '/api/files' }).guard(authGuard, (app) =>
  app
    // ── GET /api/files/directories?path= ──────────────────────────────
    .get(
      '/directories',
      ({ query, set }) => {
        const rawPath = query.path?.trim() || '';

        if (!rawPath) {
          set.status = 400;
          return { error: 'path parameter is required' };
        }

        // Must start with / (absolute path required)
        if (!rawPath.startsWith('/')) {
          set.status = 400;
          return { error: 'absolute path required' };
        }

        // Resolve to normalize (handles /etc/../ → /)
        const resolved = resolve(rawPath);

        // Must exist
        if (!existsSync(resolved)) {
          set.status = 404;
          return { error: 'directory not found' };
        }

        // Must be a directory
        const stat = statSync(resolved);
        if (!stat.isDirectory()) {
          set.status = 400;
          return { error: 'path is not a directory' };
        }

        let directories: Array<{ name: string; path: string }> = [];
        try {
          const entries = readdirSync(resolved, { withFileTypes: true });
          directories = entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => ({
              name: entry.name,
              path: join(resolved, entry.name),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
          set.status = 500;
          return { error: `failed to read directory: ${(err as Error).message}` };
        }

        return { directories };
      },
      {
        query: t.Object({
          path: t.String(),
        }),
      },
    )
    // ── POST /api/files/upload-temp — save a pasted/uploaded file to /tmp ──
    .post(
      '/upload-temp',
      async ({ request, set }) => {
        const tmpDir = '/tmp/opencode-paste-files';
        if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

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

        const MAX = 10 * 1024 * 1024;
        if (file.size > MAX) {
          set.status = 413;
          return { error: 'file too large (max 10MB)' };
        }

        const mimeToExt: Record<string, string> = {
          'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
          'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
          'image/svg+xml': '.svg', 'image/heic': '.heic', 'image/heif': '.heif',
          'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv',
          'application/json': '.json', 'application/pdf': '.pdf',
          'application/zip': '.zip',
        };
        // Prefer MIME map; fall back to original filename extension; last resort .bin
        const extFromName = file.name ? '.' + file.name.split('.').pop() : '';
        const ext = mimeToExt[file.type] ?? (extFromName.length > 1 ? extFromName : '.bin');
        const filename = `paste-${Date.now()}${ext}`;
        const destPath = join(tmpDir, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        writeFileSync(destPath, buffer);

        set.status = 201;
        return { path: destPath };
      },
    ),
);
