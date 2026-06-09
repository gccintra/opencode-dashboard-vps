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
