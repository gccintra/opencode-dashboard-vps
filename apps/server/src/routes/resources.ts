/**
 * Resources API — scan, list, and manage opencode resources
 * (skills, agents, MCPs) per project.
 *
 * Scan logic:
 *   - Skills:  ~/.config/opencode/skills/<name>/SKILL.md
 *   - Agents:   ~/.config/opencode/agents/<name>.md
 *   - MCPs:     ~/.config/opencode/mcps/<name>.(json|yaml|yml|toml|js|ts|mjs)
 *
 * Cache is populated on boot and refreshed on-demand via POST /api/resources/scan.
 * Project-resource activation state lives in the `project_resources` SQLite table.
 *
 * All routes are protected by `authGuard` (JWT bearer required).
 */

import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Types ──────────────────────────────────────────────────────────

export interface Resource {
  id: string; // "skill:name", "agent:name", "mcp:name"
  name: string;
  description: string;
  type: 'skill' | 'agent' | 'mcp';
  available: boolean;
}

export interface ProjectResource {
  resourceId: string;
  name: string;
  description: string;
  type: 'skill' | 'agent' | 'mcp';
  active: boolean;
  available: boolean;
}

// ── Cache ──────────────────────────────────────────────────────────

let cachedResources: Resource[] = [];
let lastScanTime = 0;

const OPENCODE_DIR = join(homedir(), '.config', 'opencode');
const SKILLS_DIR = join(OPENCODE_DIR, 'skills');
const AGENTS_DIR = join(OPENCODE_DIR, 'agents');
const MCPS_DIR = join(OPENCODE_DIR, 'mcps');

// ── Description extraction ─────────────────────────────────────────

/**
 * Extract a human-readable description from a markdown file.
 * Skips YAML frontmatter (--- delimiters) and heading lines (#).
 * Returns the first substantive non-empty line, stripping leading
 * bullet markers (`* `, `- `).
 */
function extractMarkdownDescription(content: string): string {
  let lines = content.split('\n');
  // Strip YAML frontmatter if present
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    lines = endIndex > -1 ? lines.slice(endIndex + 1) : lines;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('/*')
    ) {
      return trimmed.replace(/^[*-]\s*/, '');
    }
  }
  return '';
}

// ── Scanners ───────────────────────────────────────────────────────

function scanSkills(): Resource[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const results: Resource[] = [];
  try {
    for (const entry of readdirSync(SKILLS_DIR)) {
      const entryPath = join(SKILLS_DIR, entry);
      const skillMdPath = join(entryPath, 'SKILL.md');
      if (!statSync(entryPath).isDirectory() || !existsSync(skillMdPath)) continue;
      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        const description = extractMarkdownDescription(content);
        results.push({
          id: `skill:${entry}`,
          name: entry,
          description: description || 'A skill for opencode',
          type: 'skill',
          available: true,
        });
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Graceful — directory error not catastrophic
  }
  return results;
}

function scanAgents(): Resource[] {
  if (!existsSync(AGENTS_DIR)) return [];
  const results: Resource[] = [];
  try {
    for (const entry of readdirSync(AGENTS_DIR)) {
      if (!entry.endsWith('.md')) continue;
      const entryPath = join(AGENTS_DIR, entry);
      if (!statSync(entryPath).isFile()) continue;
      try {
        const content = readFileSync(entryPath, 'utf-8');
        const description = extractMarkdownDescription(content);
        const name = entry.replace(/\.md$/, '');
        results.push({
          id: `agent:${name}`,
          name,
          description: description || 'An agent for opencode',
          type: 'agent',
          available: true,
        });
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Graceful
  }
  return results;
}

function scanMcps(): Resource[] {
  if (!existsSync(MCPS_DIR)) return [];
  const results: Resource[] = [];
  const validExts = new Set(['json', 'yaml', 'yml', 'toml', 'js', 'ts', 'mjs']);
  try {
    for (const entry of readdirSync(MCPS_DIR)) {
      const entryPath = join(MCPS_DIR, entry);
      if (!statSync(entryPath).isFile()) continue;
      const ext = entry.split('.').pop()?.toLowerCase() ?? '';
      if (!validExts.has(ext)) continue;
      let description = 'MCP Server';
      try {
        const content = readFileSync(entryPath, 'utf-8');
        if (ext === 'json') {
          const parsed = JSON.parse(content);
          description = parsed.description || parsed.name || 'MCP Server';
        } else {
          const desc = extractMarkdownDescription(content);
          if (desc) description = desc;
        }
      } catch {
        // Use default description
      }
      const name = entry.replace(/\.[^.]+$/, '');
      results.push({
        id: `mcp:${name}`,
        name,
        description,
        type: 'mcp',
        available: true,
      });
    }
  } catch {
    // Graceful
  }
  return results;
}

// ── Public API ─────────────────────────────────────────────────────

/** Scan all resource directories and populate the in-memory cache. */
export function scanResources(): Resource[] {
  const skills = scanSkills();
  const agents = scanAgents();
  const mcps = scanMcps();
  cachedResources = [...skills, ...agents, ...mcps];
  lastScanTime = Date.now();
  return cachedResources;
}

/** Return the cached scan result. Call scanResources() first for fresh data. */
export function getCachedResources(): Resource[] {
  return cachedResources;
}

/**
 * Return the active resource ids for a project. Filters to only those
 * resources that exist in the cache AND are marked active in the DB.
 */
export function getActiveResourcesForProject(projectId: string): {
  skills: string[];
  agents: string[];
  mcps: string[];
} {
  const db = getDb();
  const rows = db
    .query('SELECT resource_id, active FROM project_resources WHERE project_id = ?')
    .all(projectId) as Array<{ resource_id: string; active: number }>;

  const activeSet = new Set(rows.filter((r) => r.active).map((r) => r.resource_id));
  const result = { skills: [] as string[], agents: [] as string[], mcps: [] as string[] };

  for (const resource of cachedResources) {
    if (!activeSet.has(resource.id)) continue;
    if (resource.type === 'skill') result.skills.push(resource.name);
    else if (resource.type === 'agent') result.agents.push(resource.name);
    else if (resource.type === 'mcp') result.mcps.push(resource.name);
  }

  return result;
}

/**
 * Merge scanned resources with DB activation state for a project.
 * Resources that were previously activated but are no longer in the
 * scan result are marked `available: false`.
 */
export function getProjectResources(projectId: string): ProjectResource[] {
  const db = getDb();
  const dbRows = db
    .query('SELECT resource_id, active FROM project_resources WHERE project_id = ?')
    .all(projectId) as Array<{ resource_id: string; active: number }>;

  const dbMap = new Map<string, boolean>();
  for (const r of dbRows) {
    dbMap.set(r.resource_id, r.active === 1);
  }

  const resultMap = new Map<string, ProjectResource>();

  // Scanned resources (available)
  for (const resource of cachedResources) {
    const active = dbMap.has(resource.id) ? dbMap.get(resource.id)! : false;
    resultMap.set(resource.id, {
      resourceId: resource.id,
      name: resource.name,
      description: resource.description,
      type: resource.type,
      active,
      available: true,
    });
  }

  // Resources in DB but NOT in scan → unavailable
  for (const [resourceId, active] of dbMap) {
    if (!resultMap.has(resourceId)) {
      // Extract name and type from the resource id
      const [type, ...nameParts] = resourceId.split(':');
      resultMap.set(resourceId, {
        resourceId,
        name: nameParts.join(':') || resourceId,
        description: 'Unavailable resource',
        type: (type as 'skill' | 'agent' | 'mcp') || 'skill',
        active,
        available: false,
      });
    }
  }

  return Array.from(resultMap.values());
}

// ── Routes ─────────────────────────────────────────────────────────

export const resourcesRoutes = new Elysia().guard(authGuard, (app) =>
  app
    // GET /api/resources — list all scanned resources (filter by ?type=skill|agent|mcp)
    .get('/api/resources', ({ query }) => {
      const typeFilter = (query as { type?: string }).type;
      let resources = cachedResources;
      if (typeFilter && ['skill', 'agent', 'mcp'].includes(typeFilter)) {
        resources = resources.filter((r) => r.type === typeFilter);
      }
      return {
        resources,
        count: resources.length,
        lastScan: lastScanTime ? new Date(lastScanTime).toISOString() : null,
      };
    })

    // POST /api/resources/scan — force rescan
    .post('/api/resources/scan', () => {
      const resources = scanResources();
      return {
        resources,
        count: resources.length,
        scannedAt: new Date().toISOString(),
      };
    })

    // GET /api/projects/:id/resources — list with activation status
    .get('/api/projects/:id/resources', ({ params, set }) => {
      const projectId = params.id;
      const db = getDb();

      const project = db.query('SELECT id FROM projects WHERE id = ?').get(projectId) as Record<
        string,
        unknown
      > | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      const resources = getProjectResources(projectId);
      return { resources };
    })

    // PUT /api/projects/:id/resources/:resourceId — toggle activation
    .put('/api/projects/:id/resources/:resourceId', ({ params, set }) => {
      const { id: projectId, resourceId } = params;
      const db = getDb();

      const project = db.query('SELECT id FROM projects WHERE id = ?').get(projectId) as Record<
        string,
        unknown
      > | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      // Toggle: if row exists flip active; if not, insert with active=1
      const existing = db
        .query('SELECT active FROM project_resources WHERE project_id = ? AND resource_id = ?')
        .get(projectId, resourceId) as { active: number } | null;

      if (existing) {
        const newActive = existing.active === 1 ? 0 : 1;
        db.run('UPDATE project_resources SET active = ? WHERE project_id = ? AND resource_id = ?', [
          newActive,
          projectId,
          resourceId,
        ]);
        return { resourceId, active: newActive === 1 };
      }

      db.run('INSERT INTO project_resources (project_id, resource_id, active) VALUES (?, ?, 1)', [
        projectId,
        resourceId,
      ]);
      return { resourceId, active: true };
    })

    // DELETE /api/projects/:id/resources/unavailable — batch remove orphan configs
    .delete('/api/projects/:id/resources/unavailable', ({ params, set }) => {
      const projectId = params.id;
      const db = getDb();

      const project = db.query('SELECT id FROM projects WHERE id = ?').get(projectId) as Record<
        string,
        unknown
      > | null;
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      // Build the set of currently-available resource ids from the cache
      const availableIds = new Set(cachedResources.map((r) => r.id));

      const allRows = db
        .query('SELECT resource_id FROM project_resources WHERE project_id = ?')
        .all(projectId) as Array<{ resource_id: string }>;

      let removed = 0;
      for (const row of allRows) {
        if (!availableIds.has(row.resource_id)) {
          db.run('DELETE FROM project_resources WHERE project_id = ? AND resource_id = ?', [
            projectId,
            row.resource_id,
          ]);
          removed += 1;
        }
      }

      return { removed };
    }),
);
