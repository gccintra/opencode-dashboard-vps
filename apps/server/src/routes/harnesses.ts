import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the harnesses directory from env or default.
 * Default: ~/.config/opencode/harnesses/
 */
function getHarnessesPath(): string {
  const envPath = process.env.HARNESSES_PATH?.trim();
  if (envPath) return resolve(envPath);
  return join(homedir(), '.config', 'opencode', 'harnesses');
}

interface HarnessEntry {
  id: string;
  name: string;
  description: string;
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
        // Malformed JSON — fall through to directory name fallback
      }
    }
  }

  return { name: '', description: '' };
}

/**
 * Scan the harnesses directory and return a list of available harnesses.
 * Returns an empty array if the directory does not exist (no error).
 */
function discoverHarnesses(): HarnessEntry[] {
  const rootPath = getHarnessesPath();

  if (!existsSync(rootPath)) {
    return [];
  }

  const entries: HarnessEntry[] = [];

  try {
    const dirs = readdirSync(rootPath, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const dirPath = join(rootPath, dir.name);
      const meta = readHarnessMeta(dirPath);

      entries.push({
        id: dir.name,
        name: meta.name || dir.name,
        description: meta.description || '',
      });
    }
  } catch {
    // Permission errors or other FS issues — return empty
    return [];
  }

  return entries;
}

export const harnessesRoutes = new Elysia({ prefix: '/api/harnesses' }).guard(authGuard, (app) =>
  app.get('/', () => {
    return discoverHarnesses();
  }),
);
