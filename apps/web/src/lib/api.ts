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

// ── Labels & Attachments (rich tasks) ──

export interface Label {
  id: string;
  projectId: string;
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

export async function fetchLabels(projectId: string): Promise<Label[]> {
  return apiFetch<Label[]>(`/api/projects/${encodeURIComponent(projectId)}/labels`);
}

export async function createLabel(
  projectId: string,
  data: { name: string; color: string },
): Promise<Label> {
  return apiFetch<Label>(`/api/projects/${encodeURIComponent(projectId)}/labels`, {
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

export async function implementTask(taskId: string): Promise<{ started: boolean }> {
  return apiFetch<{ started: boolean }>(
    `/api/tasks/${encodeURIComponent(taskId)}/implement`,
    { method: 'POST' },
  );
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
