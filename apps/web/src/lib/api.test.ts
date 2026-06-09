import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getToken, saveToken, clearToken, apiFetch } from './api';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});

describe('Token storage', () => {
  it('saves and retrieves a token', () => {
    saveToken('test-token');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_token', 'test-token');
    expect(getToken()).toBe('test-token');
  });

  it('clears a token', () => {
    saveToken('test-token');
    clearToken();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token');
    expect(getToken()).toBeNull();
  });

  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull();
  });
});

describe('apiFetch', () => {
  it('makes a GET request and returns JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    });

    const result = await apiFetch('/api/auth/verify');
    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/verify', {
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('makes a POST request with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'abc' }),
    });

    const result = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'secret' }),
    });

    expect(result).toEqual({ token: 'abc' });
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'secret' }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('attaches Bearer token from localStorage', async () => {
    saveToken('saved-token');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'ok' }),
    });

    await apiFetch('/api/data');
    expect(mockFetch).toHaveBeenCalledWith('/api/data', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer saved-token',
      },
    });
  });

  it('clears token and dispatches logout event on 401', async () => {
    saveToken('expired-token');

    const logoutHandler = vi.fn();
    window.addEventListener('auth:logout', logoutHandler);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    await expect(apiFetch('/api/data')).rejects.toEqual({
      status: 401,
      message: 'Unauthorized',
    });

    expect(getToken()).toBeNull();
    expect(logoutHandler).toHaveBeenCalled();

    window.removeEventListener('auth:logout', logoutHandler);
  });

  it('throws on non-401 errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    await expect(apiFetch('/api/data')).rejects.toEqual({
      status: 500,
      message: 'Server error',
    });
  });

  it('throws with default message when no error body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await expect(apiFetch('/api/missing')).rejects.toEqual({
      status: 404,
      message: 'HTTP 404',
    });
  });
});
