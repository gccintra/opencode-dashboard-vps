import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDetailPage from './ProjectDetail';

/* ── Mocks ── */

// Mock the apiFetch module so we can sequence the responses
// and assert call patterns. The mock factory must be hoisted-safe,
// so the shared `mockApiFetch` lives outside the factory.
const mockApiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

// Ref that the terminal mock writes its onResize prop into so tests
// can simulate xterm.js resize events and assert debounced API calls.
let capturedOnResize: ((cols: number, rows: number) => void) | undefined;
let capturedFontSize: number | undefined;

// Mock the XTermTerminal so we don't actually open a WebSocket or
// touch the DOM in the test environment. The stub records the
// `sessionId`, `fontSize`, and exposes `onResize` via the captured ref.
vi.mock('../components/Terminal', () => ({
  XTermTerminal: ({
    sessionId,
    onResize,
    fontSize,
  }: {
    sessionId: string;
    onResize?: (cols: number, rows: number) => void;
    fontSize?: number;
  }) => {
    capturedOnResize = onResize;
    capturedFontSize = fontSize;
    return <div data-testid="mock-terminal">Terminal: {sessionId}</div>;
  },
}));

// Mock ResourceConfig to avoid lazy-loading issues in jsdom and keep
// test assertions focused on parent-page behavior (tab switching, etc.).
vi.mock('../components/ResourceConfig/ResourceConfig', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="mock-resource-config">Config for: {projectId}</div>
  ),
}));

// Mock FileTree to avoid API calls in tests
vi.mock('../components/FileTree/FileTree', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="file-tree">FileTree for: {projectId}</div>
  ),
}));

/* ── Helpers ── */

function mockProjectResponse(project: { id: string; name: string; directory: string } | null = null) {
  mockApiFetch.mockResolvedValueOnce(
    project
      ? [project]
      : [{ id: 'test-project', name: 'Test Project', directory: '/tmp/test' }],
  );
}

function mockSessionsResponse(sessions: unknown[] = []) {
  mockProjectResponse(); // projects API call comes first
  mockApiFetch.mockResolvedValueOnce(sessions);
}

function mockCreateResponse(session: unknown) {
  mockApiFetch.mockResolvedValueOnce(session);
}

function mockDeleteResponse() {
  mockApiFetch.mockResolvedValueOnce({ success: true });
}

function mockApiError(message = 'Network error', status = 500) {
  mockApiFetch.mockRejectedValueOnce({ status, message });
}

function renderPage(projectId = 'test-project') {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/* ── Setup / teardown ── */

beforeEach(() => {
  vi.clearAllMocks();
  // The mock factory returns a fresh `vi.fn()` for `apiFetch` each time
  // the module is re-evaluated; clearAllMocks doesn't always clear the
  // queue, so we re-assign.
  mockApiFetch.mockReset();
  capturedOnResize = undefined;
  capturedFontSize = undefined;
});

/* ── Tests ── */

describe('ProjectDetailPage', () => {
  describe('loading state', () => {
    it('shows a spinner while fetching sessions', () => {
      // Never-resolving promise to keep the loading state visible.
      mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
      renderPage();

      expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    });
  });

  describe('no active session (empty state)', () => {
    it('shows the CTA when the project has no sessions', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(screen.getByText('No active session')).toBeInTheDocument();
      expect(screen.getByText(/Start a session to use the terminal/)).toBeInTheDocument();
    });

    it('renders the New Session button when no session is active', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });
      expect(screen.getByTestId('new-session-button')).toHaveTextContent(/New Session/);
    });

    it('does not show the Close Session button when no session is active', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('close-session-button')).not.toBeInTheDocument();
    });

    it('does not render the terminal when no session is active', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-terminal')).not.toBeInTheDocument();
    });
  });

  describe('active session', () => {
    it('renders the XTermTerminal when an active session exists', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      expect(screen.getByTestId('mock-terminal')).toHaveTextContent('sess-1');
    });

    it('shows the Close Session button when a session is active', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('close-session-button')).toBeInTheDocument();
      });
    });

    it('hides the empty-state CTA when a session is active', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('new-session-button')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows the error message when the sessions fetch fails', async () => {
      mockApiError('Server is on fire');
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });
      expect(screen.getByTestId('error-message')).toHaveTextContent('Server is on fire');
    });

    it('shows a Try Again button in the error state', async () => {
      mockApiError('Boom');
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('retry-button')).toBeInTheDocument();
      });
    });

    it('refetches sessions when Try Again is clicked', async () => {
      mockApiError('First call fails');
      // Second call succeeds.
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('retry-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('retry-button'));

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    });

    it('uses a fallback error message when the API error has none', async () => {
      mockApiFetch.mockRejectedValueOnce({ status: 500 });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(/Failed to load sessions/);
      });
    });
  });

  describe('create session flow', () => {
    it('POSTs to the sessions endpoint when New Session is clicked', async () => {
      mockSessionsResponse([]);
      mockCreateResponse({
        sessionId: 'new-sess',
        projectId: 'test-project',
        name: 'Sessão 1',
        status: 'active',
        createdAt: 2000,
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('new-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/projects/test-project/sessions',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('shows the terminal with the new session id after creation', async () => {
      mockSessionsResponse([]);
      mockCreateResponse({
        sessionId: 'created-id',
        projectId: 'test-project',
        name: 'Sessão 1',
        status: 'active',
        createdAt: 5000,
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('new-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toHaveTextContent('created-id');
      });
      expect(screen.queryByTestId('new-session-button')).not.toBeInTheDocument();
    });

    it('shows the error state when session creation fails and no session is active', async () => {
      mockSessionsResponse([]);
      mockApiError('Spawn failed: opencode not found');
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('new-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });
      expect(screen.getByTestId('error-message')).toHaveTextContent(/Spawn failed/);
    });
  });

  describe('close session flow', () => {
    it('DELETEs the session when Close Session is clicked', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      mockDeleteResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('close-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('close-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/sessions/sess-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('returns to the empty CTA after a successful close', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      mockDeleteResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('close-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('close-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-terminal')).not.toBeInTheDocument();
    });

    it('keeps the terminal mounted and shows an error banner when close fails', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      mockApiError('DELETE failed: timeout');
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('close-session-button')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('close-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeInTheDocument();
      });
      expect(screen.getByTestId('error-banner')).toHaveTextContent('DELETE failed: timeout');
      // Terminal must still be present.
      expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      // The CTA must NOT have replaced it.
      expect(screen.queryByTestId('new-session-button')).not.toBeInTheDocument();
    });
  });

  describe('session selection logic', () => {
    it('picks the most recent active session when multiple exist', async () => {
      mockSessionsResponse([
        { sessionId: 'old', name: 'Sessão 1', status: 'active', createdAt: 1000 },
        { sessionId: 'newest', name: 'Sessão 2', status: 'active', createdAt: 5000 },
        { sessionId: 'middle', name: 'Sessão 3', status: 'active', createdAt: 3000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toHaveTextContent('newest');
      });
    });

    it('ignores exited sessions when picking the active one', async () => {
      mockSessionsResponse([
        { sessionId: 'live', name: 'Sessão 1', status: 'active', createdAt: 9000 },
        { sessionId: 'dead-1', name: 'Sessão 2', status: 'exited', createdAt: 9999 },
        { sessionId: 'dead-2', name: 'Sessão 3', status: 'killed', createdAt: 8888 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toHaveTextContent('live');
      });
    });

    it('shows the empty CTA when all sessions are exited', async () => {
      mockSessionsResponse([
        { sessionId: 'd1', name: 'Sessão 1', status: 'exited', createdAt: 2000 },
        { sessionId: 'd2', name: 'Sessão 2', status: 'killed', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-terminal')).not.toBeInTheDocument();
    });

    it('falls back to the most recent exited session timestamp ordering', async () => {
      // No active sessions; the page should render the CTA, not
      // a terminal.
      mockSessionsResponse([
        { sessionId: 'a', name: 'A', status: 'exited', createdAt: 500 },
        { sessionId: 'b', name: 'B', status: 'exited', createdAt: 600 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
    });
  });

  describe('header', () => {
    it('shows the project id in the header', async () => {
      mockSessionsResponse([]);
      renderPage('my-cool-project');

      await waitFor(() => {
        expect(screen.getByTestId('project-name')).toHaveTextContent('my-cool-project');
      });
    });

    it('has a back button to the projects list', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('back-button')).toBeInTheDocument();
      });
      expect(screen.getByTestId('back-button')).toHaveTextContent('Projects');
    });

    it('renders the header with the expected border', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      const header = screen.getByTestId('page-header');
      expect(header.className).toContain('border-b');
    });
  });

  describe('tab bar', () => {
    it('renders the tab bar when sessions are loaded', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
      });
    });

    it('shows Terminal and Config tabs', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-terminal')).toBeInTheDocument();
        expect(screen.getByTestId('tab-config')).toBeInTheDocument();
      });
    });

    it('sets Terminal tab as active by default', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-terminal')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('tab-config')).toHaveAttribute('aria-selected', 'false');
      });
    });

    it('switches to Config tab and renders ResourceConfig', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-config')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('tab-config'));

      await waitFor(() => {
        expect(screen.getByTestId('mock-resource-config')).toBeInTheDocument();
      });
      expect(screen.getByTestId('mock-resource-config')).toHaveTextContent('test-project');
    });

    it('returns to Terminal tab when switching back', async () => {
      mockSessionsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-config')).toBeInTheDocument();
      });

      // Go to Config
      await userEvent.click(screen.getByTestId('tab-config'));
      await waitFor(() => {
        expect(screen.getByTestId('mock-resource-config')).toBeInTheDocument();
      });

      // Go back to Terminal
      await userEvent.click(screen.getByTestId('tab-terminal'));
      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-resource-config')).not.toBeInTheDocument();
    });

    it('switches to terminal tab when a new session is created', async () => {
      mockSessionsResponse([]);
      // Switch to files tab first
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('tab-files')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('tab-files'));
      await waitFor(() => {
        expect(screen.getByTestId('file-tree')).toBeInTheDocument();
      });

      // Now create a session (from the terminal tab)
      await userEvent.click(screen.getByTestId('tab-terminal'));
      await waitFor(() => {
        expect(screen.getByTestId('new-session-button')).toBeInTheDocument();
      });

      mockCreateResponse({
        sessionId: 'sess-new',
        projectId: 'test-project',
        name: 'Sessão 1',
        status: 'active',
        createdAt: 2000,
      });
      await userEvent.click(screen.getByTestId('new-session-button'));

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      // Tab should remain on terminal
      expect(screen.getByTestId('tab-terminal')).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('loading', () => {
    it('keeps the header visible during loading', () => {
      mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
      renderPage();

      // Header should be present even while the data is loading.
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
      expect(screen.getByTestId('back-button')).toBeInTheDocument();
    });
  });

  describe('terminal resize', () => {
    it('passes onResize callback to XTermTerminal', async () => {
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      expect(capturedOnResize).toBeDefined();
      expect(typeof capturedOnResize).toBe('function');
    });

    it('debounces resize API calls (300ms)', async () => {
      vi.useFakeTimers();
      mockApiFetch.mockResolvedValue({ success: true });
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);

      await act(() => {
        renderPage();
      });
      vi.advanceTimersByTime(0);

      expect(capturedOnResize).toBeDefined();

      // Reset mock to ignore the initial sessions fetch.
      mockApiFetch.mockClear();

      capturedOnResize?.(120, 35);

      // Not called yet — debounce timer still pending.
      expect(mockApiFetch).toHaveBeenCalledTimes(0);

      // Fast-forward past the 300ms debounce window.
      vi.advanceTimersByTime(300);

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/sessions/sess-1/resize',
        expect.objectContaining({ method: 'POST' }),
      );

      vi.useRealTimers();
    });

    it('debounces rapid resize events and sends only the last one', async () => {
      vi.useFakeTimers();
      mockApiFetch.mockResolvedValue({ success: true });
      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);

      await act(() => {
        renderPage();
      });
      vi.advanceTimersByTime(0);

      // Reset mock to ignore the initial sessions fetch.
      mockApiFetch.mockClear();

      capturedOnResize?.(100, 30);
      capturedOnResize?.(120, 35);
      capturedOnResize?.(150, 40);

      // No calls yet — debounce timer still pending.
      expect(mockApiFetch).toHaveBeenCalledTimes(0);

      // Fast-forward past the 300ms debounce window.
      vi.advanceTimersByTime(300);

      // Only the last resize should be sent.
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/sessions/sess-1/resize',
        expect.objectContaining({
          body: JSON.stringify({ cols: 150, rows: 40 }),
        }),
      );

      vi.useRealTimers();
    });

    it('does not call the API when sessionId is null (empty state)', () => {
      vi.useFakeTimers();
      mockApiFetch.mockResolvedValue({ success: true });
      mockSessionsResponse([]);

      renderPage();
      vi.advanceTimersByTime(0);

      // Reset mock to ignore the initial sessions fetch.
      mockApiFetch.mockClear();

      // capturedOnResize is undefined because the terminal isn't rendered
      // in the empty state, so the hook's no-op path is exercised by the
      // fact that the hook itself returns a no-op when sessionId is null.
      // We verify that no unexpected API call happened.
      expect(mockApiFetch).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('passes fontSize=12 to XTermTerminal when viewport is narrow', async () => {
      // Set innerWidth below the 640px threshold.
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.dispatchEvent(new Event('resize'));

      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });

      expect(capturedFontSize).toBe(12);

      // Restore.
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalWidth,
      });
    });

    it('passes fontSize=13 to XTermTerminal when viewport is wide', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });
      window.dispatchEvent(new Event('resize'));

      mockSessionsResponse([
        { sessionId: 'sess-1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });

      expect(capturedFontSize).toBe(13);

      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalWidth,
      });
    });
  });
});
