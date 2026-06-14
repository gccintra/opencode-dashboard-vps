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
