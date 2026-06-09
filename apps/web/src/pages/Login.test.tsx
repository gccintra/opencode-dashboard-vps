import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './Login';

// Mock useAuth
const mockLogin = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function renderLogin(initialRoute = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

function mockUnauthenticated() {
  mockUseAuth.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    login: mockLogin,
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUnauthenticated();
});

describe('LoginPage', () => {
  it('renders the login form', () => {
    renderLogin();

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Your VPS sessions, under control.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Master Password/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('renders footer info', () => {
    renderLogin();

    expect(screen.getByText('Single user access')).toBeInTheDocument();
    expect(screen.getByText('JWT secured')).toBeInTheDocument();
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();
  });

  it('disables sign in button when password is empty', () => {
    renderLogin();

    const button = screen.getByRole('button', { name: /Sign in/ });
    expect(button).toBeDisabled();
  });

  it('enables sign in button when password is entered', async () => {
    const user = userEvent.setup();

    renderLogin();

    const input = screen.getByLabelText(/Master Password/);
    await user.type(input, 'secret');

    const button = screen.getByRole('button', { name: /Sign in/ });
    expect(button).toBeEnabled();
  });

  it('calls login on form submission', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValueOnce({ success: true });

    renderLogin();

    await user.type(screen.getByLabelText(/Master Password/), 'secret');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(mockLogin).toHaveBeenCalledWith('secret');
  });

  it('shows error message on login failure', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValueOnce({
      success: false,
      error: 'Invalid credentials',
    });

    renderLogin();

    await user.type(screen.getByLabelText(/Master Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();

    renderLogin();

    const input = screen.getByLabelText(/Master Password/) as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggleButton = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggleButton);

    expect(input.type).toBe('text');
  });

  it('clears error when user types', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValueOnce({
      success: false,
      error: 'Invalid credentials',
    });

    renderLogin();

    await user.type(screen.getByLabelText(/Master Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/Master Password/), ' more');

    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
  });

  it('redirects to /projects when already authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      login: mockLogin,
      logout: vi.fn(),
    });

    renderLogin();

    // Should not render the login form
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('shows the banner with branding', () => {
    renderLogin();

    expect(screen.getByText('OpenCode Dashboard')).toBeInTheDocument();
    expect(screen.getByText('> _')).toBeInTheDocument();
  });

  it('disables button while submitting', async () => {
    const user = userEvent.setup();

    // Make login never resolve so we can check the submitting state
    let resolveLogin!: (value: unknown) => void;
    const loginPromise = new Promise((resolve) => {
      resolveLogin = resolve;
    });
    mockLogin.mockReturnValueOnce(loginPromise);

    renderLogin();

    await user.type(screen.getByLabelText(/Master Password/), 'secret');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    // Button should show loading text and be disabled
    const button = screen.getByRole('button', { name: /Signing in/ });
    expect(button).toBeDisabled();

    // Resolve so the test can clean up
    resolveLogin({ success: true });
  });
});
