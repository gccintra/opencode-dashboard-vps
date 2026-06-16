const TOKEN_KEY = 'auth_token';

function getBaseUrl(): string {
  // In dev, Vite proxies /api to the backend, so use relative paths
  if (import.meta.env.DEV) {
    return '';
  }
  return import.meta.env.VITE_API_URL || '';
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getStoredToken();
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError {
  status: number;
  message: string;
}

// ── Harness API Types ──

export interface HarnessEntry {
  id: string;
  name: string;
  description: string;
}

export interface FileEntry {
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileEntry[];
}

export interface HarnessDetail extends HarnessEntry {
  fileCount: number;
}

export interface HarnessFilesResponse {
  id: string;
  name: string;
  files: FileEntry[];
}

export interface HarnessPreviewResponse {
  harness: HarnessEntry;
  files: FileEntry[];
  conflicts: string[];
}

export interface CopyResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

// ── Harness API Functions ──

export async function fetchHarnesses(): Promise<HarnessEntry[]> {
  return apiFetch<HarnessEntry[]>('/api/harnesses');
}

export async function createHarness(data: {
  name: string;
  description?: string;
  files?: Array<{ path: string; content: string }>;
}): Promise<HarnessDetail> {
  return apiFetch<HarnessDetail>('/api/harnesses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateHarness(
  id: string,
  data: { name?: string; description?: string },
): Promise<HarnessEntry> {
  return apiFetch<HarnessEntry>(`/api/harnesses/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteHarness(id: string): Promise<void> {
  await apiFetch(`/api/harnesses/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchHarnessFiles(id: string): Promise<HarnessFilesResponse> {
  return apiFetch<HarnessFilesResponse>(`/api/harnesses/${encodeURIComponent(id)}/files`);
}

export async function uploadHarnessFile(
  harnessId: string,
  path: string,
  content: string,
): Promise<{ path: string; size: number }> {
  return apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/files`, {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
}

export async function deleteHarnessFile(
  harnessId: string,
  path: string,
): Promise<void> {
  const searchParams = new URLSearchParams({ path });
  await apiFetch(
    `/api/harnesses/${encodeURIComponent(harnessId)}/files?${searchParams.toString()}`,
    { method: 'DELETE' },
  );
}

export async function previewHarnessOnProject(
  projectId: string,
  harnessId: string,
): Promise<HarnessPreviewResponse> {
  const searchParams = new URLSearchParams({ harnessId });
  return apiFetch<HarnessPreviewResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/harness/preview?${searchParams.toString()}`,
  );
}

export async function applyHarnessToProject(
  projectId: string,
  harnessId: string,
  overwrite = false,
): Promise<CopyResult> {
  return apiFetch<CopyResult>(`/api/projects/${encodeURIComponent(projectId)}/harness`, {
    method: 'POST',
    body: JSON.stringify({ harnessId, overwrite }),
  });
}

// ── Kanban Columns ──

export type KanbanCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface KanbanColumn {
  id: string;
  name: string;
  category: KanbanCategory;
  color: string;
  sortOrder: number;
  createdAt: string;
  taskCount?: number;
}

export async function fetchKanbanColumns(): Promise<KanbanColumn[]> {
  return apiFetch<KanbanColumn[]>('/api/kanban-columns');
}

export async function createKanbanColumn(data: {
  name: string;
  category: KanbanCategory;
  color?: string;
}): Promise<KanbanColumn> {
  return apiFetch<KanbanColumn>('/api/kanban-columns', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateKanbanColumn(
  id: string,
  data: { name?: string; color?: string; sortOrder?: number },
): Promise<KanbanColumn> {
  return apiFetch<KanbanColumn>(`/api/kanban-columns/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteKanbanColumn(id: string): Promise<void> {
  await apiFetch(`/api/kanban-columns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Labels & Attachments (rich tasks) ──

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

export async function fetchLabels(): Promise<Label[]> {
  return apiFetch<Label[]>('/api/labels');
}

export async function createLabel(data: { name: string; color: string }): Promise<Label> {
  return apiFetch<Label>('/api/labels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLabel(
  labelId: string,
  data: { name?: string; color?: string },
): Promise<Label> {
  return apiFetch<Label>(`/api/labels/${encodeURIComponent(labelId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteLabel(labelId: string): Promise<void> {
  await apiFetch(`/api/labels/${encodeURIComponent(labelId)}`, { method: 'DELETE' });
}

export async function applyTaskLabels<T = unknown>(taskId: string, labelIds: string[]): Promise<T> {
  return apiFetch<T>(`/api/tasks/${encodeURIComponent(taskId)}/labels`, {
    method: 'PUT',
    body: JSON.stringify({ labelIds }),
  });
}

export async function fetchTaskAttachments(taskId: string): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/api/tasks/${encodeURIComponent(taskId)}/attachments`);
}

/**
 * Upload an attachment via multipart. We do NOT use apiFetch here because it
 * forces `Content-Type: application/json`; for multipart the browser must set
 * the boundary itself, so we issue a raw fetch and inject the bearer token.
 */
export async function uploadTaskAttachment(taskId: string, file: File): Promise<Attachment> {
  const baseUrl = getBaseUrl();
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(
    `${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/attachments`,
    { method: 'POST', headers, body: formData },
  );

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw {
      status: response.status,
      message: (data as { error?: string }).error || `HTTP ${response.status}`,
    } as ApiError;
  }
  return data as Attachment;
}

export async function deleteTaskAttachment(taskId: string, attachmentId: string): Promise<void> {
  await apiFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  );
}

/** Build the authenticated URL for an attachment binary (for <img>/<a> use). */
export function attachmentUrl(taskId: string, attachmentId: string): string {
  return `${getBaseUrl()}/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * Fetch an attachment binary as a Blob. The serve endpoint sits behind
 * `authGuard` (Bearer only), so a raw `<img src>`/`<a href>` would 401 in a real
 * browser (it cannot attach the Authorization header). We fetch the bytes with
 * the bearer token here; callers wrap the Blob in an object URL and must call
 * `URL.revokeObjectURL` when done to avoid leaks.
 */
export async function fetchAttachmentBlob(taskId: string, attachmentId: string): Promise<Blob> {
  const baseUrl = getBaseUrl();
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(
    `${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers },
  );

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message: `HTTP ${response.status}`,
    } as ApiError;
  }

  return response.blob();
}

export async function setTaskSession<T = unknown>(
  taskId: string,
  sessionId: string | null,
): Promise<T> {
  return apiFetch<T>(`/api/tasks/${encodeURIComponent(taskId)}/session`, {
    method: 'PUT',
    body: JSON.stringify({ sessionId }),
  });
}

export async function implementTask(
  taskId: string,
  delayMs?: number,
): Promise<{ started: boolean; delayedMs?: number }> {
  return apiFetch<{ started: boolean; delayedMs?: number }>(
    `/api/tasks/${encodeURIComponent(taskId)}/implement`,
    {
      method: 'POST',
      body: JSON.stringify(delayMs && delayMs > 0 ? { delayMs } : {}),
    },
  );
}

export interface SpawnEvent {
  id: string;
  sessionId: string | null;
  runtime: string | null;
  agentName: string | null;
  model: string | null;
  createdAt: string;
}

export async function fetchSpawnHistory(taskId: string): Promise<SpawnEvent[]> {
  return apiFetch<SpawnEvent[]>(`/api/tasks/${encodeURIComponent(taskId)}/spawn-history`);
}

// ── Task priority ──
export type TaskPriority = 'low' | 'medium' | 'high';

export async function updateTaskPriority(taskId: string, priority: TaskPriority): Promise<void> {
  await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ priority }),
  });
}

export async function updateTaskProject(taskId: string, projectId: string): Promise<void> {
  await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ projectId }),
  });
}

// ── Task activity timeline + comments ──
export type ActivityType =
  | 'created'
  | 'moved'
  | 'title_changed'
  | 'description_changed'
  | 'priority_changed'
  | 'project_changed'
  | 'label_added'
  | 'label_removed'
  | 'linked'
  | 'unlinked'
  | 'comment';

export interface TaskActivity {
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

export async function fetchTaskActivity(taskId: string): Promise<TaskActivity[]> {
  return apiFetch<TaskActivity[]>(`/api/tasks/${encodeURIComponent(taskId)}/activity`);
}

export async function postComment(taskId: string, body: string): Promise<TaskActivity> {
  return apiFetch<TaskActivity>(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function editComment(
  taskId: string,
  commentId: string,
  body: string,
): Promise<TaskActivity> {
  return apiFetch<TaskActivity>(
    `/api/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'PUT', body: JSON.stringify({ body }) },
  );
}

export async function deleteComment(taskId: string, commentId: string): Promise<void> {
  await apiFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
}

// ── Task links (GitLab-style typed relations) ──
export type LinkType = 'relates_to' | 'blocks' | 'blocked_by' | 'duplicates';

export interface TaskLink {
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

export async function fetchTaskLinks(taskId: string): Promise<TaskLink[]> {
  return apiFetch<TaskLink[]>(`/api/tasks/${encodeURIComponent(taskId)}/links`);
}

export async function createTaskLink(
  taskId: string,
  targetTaskId: string,
  type: LinkType,
): Promise<TaskLink> {
  return apiFetch<TaskLink>(`/api/tasks/${encodeURIComponent(taskId)}/links`, {
    method: 'POST',
    body: JSON.stringify({ targetTaskId, type }),
  });
}

export async function deleteTaskLink(taskId: string, linkId: string): Promise<void> {
  await apiFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  );
}

export async function setTaskAgentType(
  taskId: string,
  agentType: 'opencode' | 'claude' | null,
): Promise<void> {
  await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ agentType }),
  });
}

/** Agent/command selected for a task, plus the LLM model. */
export type AgentSource = 'agents' | 'commands';

export interface TaskAgentConfig {
  agentType?: 'opencode' | 'claude' | null;
  agentName?: string | null;
  agentSource?: AgentSource | null;
  model?: string | null;
  /** Reasoning effort: claude `--effort`, opencode `--variant`. */
  effort?: string | null;
}

/** Persist the chosen agent/command + model on a task. */
export async function updateTaskAgentConfig(
  taskId: string,
  config: TaskAgentConfig,
): Promise<void> {
  await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export interface CatalogEntry {
  name: string;
  description: string;
}

export interface AgentCatalog {
  opencode: { agents: CatalogEntry[] };
  claude: { agents: CatalogEntry[]; commands: CatalogEntry[] };
}

/** List agents/commands discovered in a project's `.claude` / `.opencode` dirs. */
export async function fetchAgentCatalog(projectId: string): Promise<AgentCatalog> {
  return apiFetch<AgentCatalog>(
    `/api/projects/${encodeURIComponent(projectId)}/agent-catalog`,
  );
}

export interface AgentModel {
  id: string;
  label: string;
}

/** List selectable LLM models for a runtime (claude aliases or `opencode models`). */
export async function fetchAgentModels(
  runtime: 'opencode' | 'claude',
): Promise<AgentModel[]> {
  const data = await apiFetch<{ models: AgentModel[] }>(
    `/api/agent-models?runtime=${encodeURIComponent(runtime)}`,
  );
  return Array.isArray(data.models) ? data.models : [];
}

export interface AgentHint {
  hint: 'opencode' | 'claude' | 'both' | null;
  hasOpencode: boolean;
  hasClaude: boolean;
}

export async function fetchAgentHint(projectId: string): Promise<AgentHint> {
  return apiFetch<AgentHint>(`/api/projects/${encodeURIComponent(projectId)}/agent-hint`);
}

export interface ProjectSession {
  sessionId: string;
  name: string;
  status: string;
  createdAt: number;
}

/** List the live PTY sessions belonging to a project (for task association). */
export async function fetchProjectSessions(projectId: string): Promise<ProjectSession[]> {
  return apiFetch<ProjectSession[]>(
    `/api/projects/${encodeURIComponent(projectId)}/sessions`,
  );
}

/** Create a new PTY session for a project. */
export async function createSession(
  projectId: string,
  opts?: {
    name?: string;
    cols?: number;
    rows?: number;
    agentType?: 'opencode' | 'claude';
    model?: string;
    agent?: string;
    agentSource?: AgentSource;
    effort?: string;
  },
): Promise<ProjectSession> {
  return apiFetch<ProjectSession>(
    `/api/projects/${encodeURIComponent(projectId)}/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    },
  );
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    // Dispatch a custom event so the auth context can react
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

  const data = await response.json();

  if (!response.ok) {
    throw {
      status: response.status,
      message: (data as { error?: string }).error || `HTTP ${response.status}`,
    } as ApiError;
  }

  return data as T;
}
