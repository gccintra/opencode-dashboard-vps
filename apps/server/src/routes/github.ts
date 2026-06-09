import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string; color: string }>;
}

/** Extract repo owner/name from github_repo string like "owner/repo" */
function parseRepo(repo: string): { owner: string; repo: string } | null {
  const parts = repo.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/** Fetch open issues from GitHub API */
async function fetchGitHubIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'opencode-dashboard',
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const allIssues: GitHubIssue[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers });

    // Check rate limit
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '60', 10);
    if (remaining === 0) {
      const resetTime = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
      const waitMs = resetTime - Date.now();
      if (waitMs > 0 && waitMs < 60000) {
        console.log(`[github] rate limit hit, waiting ${Math.ceil(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs + 1000));
        continue;
      }
      console.warn('[github] rate limit exhausted, skipping remaining pages');
      break;
    }

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[github] API error ${res.status}: ${errorText}`);
      throw new Error(`GitHub API error: ${res.status} ${errorText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issues = (await res.json()) as any[];
    if (!Array.isArray(issues) || issues.length === 0) break;

    // Filter out pull requests (GitHub API returns PRs as issues too)
    allIssues.push(
      ...issues.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (i: any) => !i.pull_request,
      ),
    );
    page++;
  }

  return allIssues;
}

/** Sync issues for a single project */
async function syncProjectIssues(projectId: string): Promise<number> {
  const db = getDb();
  const project = db.query('SELECT * FROM projects WHERE id = ?').get(projectId) as DbRow | null;
  if (!project || !project.github_repo) return 0;

  const repoInfo = parseRepo(project.github_repo as string);
  if (!repoInfo) {
    console.warn(`[github] invalid github_repo for project ${projectId}: ${project.github_repo}`);
    return 0;
  }

  const issues = await fetchGitHubIssues(repoInfo.owner, repoInfo.repo);
  const now = new Date().toISOString();
  let synced = 0;

  for (const issue of issues) {
    const column = issue.state === 'closed' ? 'done' : 'backlog';
    const labels = JSON.stringify(issue.labels);
    const existing = db
      .query('SELECT id, "column" FROM tasks WHERE project_id = ? AND github_issue_number = ?')
      .get(projectId, issue.number) as DbRow | null;

    if (existing) {
      // Update existing task
      db.run(
        `UPDATE tasks SET title = ?, description = ?, "column" = ?, github_labels = ?, updated_at = ? WHERE id = ?`,
        [issue.title, issue.body, column, labels, now, existing.id],
      );
    } else {
      // Create new task
      const taskId = crypto.randomUUID();
      db.run(
        `INSERT INTO tasks (id, project_id, title, description, source, "column", sort_order, github_issue_url, github_labels, github_issue_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'github', ?, 0, ?, ?, ?, ?, ?)`,
        [
          taskId,
          projectId,
          issue.title,
          issue.body,
          column,
          issue.html_url,
          labels,
          issue.number,
          now,
          now,
        ],
      );
    }
    synced++;
  }

  return synced;
}

/** Background sync: poll every 5 minutes for all projects with github_repo */
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startGithubPolling(): void {
  if (syncInterval) return;

  syncInterval = setInterval(
    async () => {
      try {
        const db = getDb();
        const projects = db
          .query('SELECT id FROM projects WHERE github_repo IS NOT NULL AND github_repo != ?')
          .all('') as DbRow[];

        for (const project of projects) {
          try {
            const count = await syncProjectIssues(project.id as string);
            if (count > 0) {
              console.log(`[github] synced ${count} issues for project ${project.id}`);
            }
          } catch (err) {
            console.error(
              `[github] sync failed for project ${project.id}:`,
              (err as Error).message,
            );
          }
        }
      } catch (err) {
        console.error('[github] polling error:', (err as Error).message);
      }
    },
    5 * 60 * 1000,
  ); // 5 minutes

  console.log('[github] background polling started (every 5 min)');
}

export function stopGithubPolling(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[github] background polling stopped');
  }
}

export const githubRoutes = new Elysia({ prefix: '/api' }).guard(authGuard, (app) =>
  app
    // ── POST /api/projects/:id/github/sync — manual sync ──────
    .post('/projects/:id/github/sync', async ({ params: { id: projectId }, set }) => {
      try {
        const db = getDb();
        const project = db
          .query('SELECT * FROM projects WHERE id = ?')
          .get(projectId) as DbRow | null;
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }
        if (!project.github_repo) {
          set.status = 400;
          return { error: 'Project does not have a linked GitHub repo' };
        }

        const count = await syncProjectIssues(projectId);
        return { synced: count };
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    }),
);
