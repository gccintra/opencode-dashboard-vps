import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

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

// Dynamically import to pick up the mocked modules
let AuthProvider: typeof import('./AuthContext').AuthProvider;
let useAuth: typeof import('./AuthContext').useAuth;

beforeEach(async () => {
  vi.clearAllMocks();
  localStorageMock.clear();
  fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };

  // Reset modules so the auth context picks up fresh mocks
  vi.resetModules();
  const mod = await import('./AuthContext');
  AuthProvider = mod.AuthProvider;
  useAuth = mod.useAuth;
});

// Helper component to read auth state
function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <button data-testid="login-btn" onClick={() => auth.login('password')}>
        Login
      </button>
      <button data-testid="logout-btn" onClick={() => auth.logout()}>
        Logout
      </button>
    </div>
  );
}

function renderWithProvider(ui?: ReactNode) {
  return render(<AuthProvider>{ui ?? <AuthConsumer />}</AuthProvider>);
}

describe('AuthContext', () => {
  it('does not call verify when no token exists', async () => {
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('verifies token on mount when token exists (success)', async () => {
    localStorage.setItem('auth_token', 'existing-token');
    fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer existing-token',
        }),
      }),
    );
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
  });

  it('sets authenticated false when verify fails', async () => {
    localStorage.setItem('auth_token', 'bad-token');
    fetchResponse = { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('login success saves token and sets authenticated', async () => {
    const user = userEvent.setup();

    // No token on mount
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    // Set up login response
    fetchResponse = { ok: true, status: 200, json: async () => ({ token: 'new-token' }) };

    await user.click(screen.getByTestId('login-btn'));

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(localStorage.getItem('auth_token')).toBe('new-token');
  });

  it('login failure does not set authenticated', async () => {
    const user = userEvent.setup();

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    fetchResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' }),
    };

    await user.click(screen.getByTestId('login-btn'));

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('logout clears token and sets unauthenticated', async () => {
    const user = userEvent.setup();

    // Start authenticated
    localStorage.setItem('auth_token', 'existing-token');
    fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('true');
    });

    await user.click(screen.getByTestId('logout-btn'));

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('handles forced logout from auth:logout event', async () => {
    localStorage.setItem('auth_token', 'existing-token');
    fetchResponse = { ok: true, status: 200, json: async () => ({ valid: true }) };

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('true');
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('false');
    });
  });

  it('throws error when useAuth used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<AuthConsumer />)).toThrow('useAuth must be used within an AuthProvider');

    spy.mockRestore();
  });
});
