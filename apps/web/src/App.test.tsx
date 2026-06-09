import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

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
let fetchResponse: { ok: boolean; status: number; json: () => Promise<unknown> };
const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(fetchResponse));
global.fetch = mockFetch;

// Default mock: when not authenticated, auth verify returns 401
const defaultFetch = () => {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/auth/verify')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'invalid' }) });
    }
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorageMock.clear();
  fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };

  // Reset modules so auth context picks up fresh state
  vi.resetModules();

  // Reset URL
  window.history.pushState({}, '', '/');
});

describe('App routing', () => {
  it('renders the login page at /login when not authenticated', async () => {
    defaultFetch();
    window.history.pushState({}, '', '/login');

    const { default: AppMod } = await import('./App');
    render(<AppMod />);

    await waitFor(
      () => {
        expect(screen.getByText('Welcome back')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('redirects to login from root when not authenticated', async () => {
    defaultFetch();

    const { default: AppMod } = await import('./App');
    render(<AppMod />);

    await waitFor(
      () => {
        expect(screen.getByText('Welcome back')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('redirects to projects from root when authenticated', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/auth/verify')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ valid: true }) });
      }
      if (url.includes('/api/projects')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { default: AppMod } = await import('./App');
    render(<AppMod />);

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('redirects to projects from login when already authenticated', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/auth/verify')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ valid: true }) });
      }
      if (url.includes('/api/projects')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    window.history.pushState({}, '', '/login');

    const { default: AppMod } = await import('./App');
    render(<AppMod />);

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('shows loading spinner while verifying', async () => {
    localStorage.setItem('auth_token', 'some-token');
    // Don't resolve the promise so it stays in loading state
    mockFetch.mockReturnValueOnce(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const { default: AppMod } = await import('./App');
    render(<AppMod />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
