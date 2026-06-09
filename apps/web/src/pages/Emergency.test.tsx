import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EmergencyPage from './Emergency';

/* ── Mocks ── */

const mockApiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

let capturedOnResize: ((cols: number, rows: number) => void) | undefined;
let capturedFontSize: number | undefined;

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

/* ── Helpers ── */

function mockFetchResponse(data: unknown) {
  mockApiFetch.mockResolvedValueOnce(data);
}

function mockFetchError(message = 'Network error', status = 500) {
  mockApiFetch.mockRejectedValueOnce({ status, message });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/emergency']}>
      <Routes>
        <Route path="/emergency" element={<EmergencyPage />} />
        <Route path="/projects" element={<div data-testid="projects-page">Projects</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/* ── Setup / teardown ── */

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
  capturedOnResize = undefined;
  capturedFontSize = undefined;
});

/* ── Tests ── */

describe('EmergencyPage', () => {
  describe('loading state', () => {
    it('shows a spinner while fetching the emergency session', () => {
      mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
      renderPage();
      // The spinner is rendered as an animate-spin div
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows the error message when the fetch fails', async () => {
      mockFetchError('Emergency terminal is unavailable');
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Emergency terminal is unavailable')).toBeInTheDocument();
      });
    });

    it('shows a Back to Projects button in the error state', async () => {
      mockFetchError('Boom');
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Back to Projects')).toBeInTheDocument();
      });
    });

    it('navigates to Projects when Back to Projects is clicked', async () => {
      mockFetchError('Boom');
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Back to Projects')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Back to Projects'));

      await waitFor(() => {
        expect(screen.getByTestId('projects-page')).toBeInTheDocument();
      });
    });
  });

  describe('active session', () => {
    it('renders the XTermTerminal when the session is active', async () => {
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      expect(screen.getByTestId('mock-terminal')).toHaveTextContent('emergency-1');
    });

    it('shows the emergency header with warning styling', async () => {
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Emergency Terminal')).toBeInTheDocument();
      });
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });

  describe('close session', () => {
    it('DELETEs the session and navigates to projects', async () => {
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      // The DELETE call resolves successfully.
      mockApiFetch.mockResolvedValueOnce({ success: true });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Close Session')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Close Session'));

      await waitFor(() => {
        expect(screen.getByTestId('projects-page')).toBeInTheDocument();
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/sessions/emergency-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('shows error and replaces terminal when close fails', async () => {
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      mockFetchError('Delete failed');
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Close Session')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Close Session'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
      // Error state replaces terminal view — shows Back to Projects
      expect(screen.getByText('Back to Projects')).toBeInTheDocument();
    });
  });

  describe('terminal resize', () => {
    it('passes onResize callback to XTermTerminal', async () => {
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });
      expect(capturedOnResize).toBeDefined();
      expect(typeof capturedOnResize).toBe('function');
    });

    it('calls the resize API endpoint immediately (no debounce)', async () => {
      vi.useFakeTimers();
      mockApiFetch.mockResolvedValue({ success: true });
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });

      await act(() => {
        renderPage();
      });
      vi.advanceTimersByTime(0);

      expect(capturedOnResize).toBeDefined();

      // Reset mock to ignore the initial emergency-terminal fetch.
      mockApiFetch.mockClear();

      capturedOnResize?.(130, 40);

      // Resize is now sent immediately (no debounce).
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/sessions/emergency-1/resize',
        expect.objectContaining({ method: 'POST' }),
      );

      vi.useRealTimers();
    });

    it('sends every resize immediately (no debounce)', async () => {
      vi.useFakeTimers();
      mockApiFetch.mockResolvedValue({ success: true });
      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });

      await act(() => {
        renderPage();
      });
      vi.advanceTimersByTime(0);

      // Reset mock to ignore the initial emergency-terminal fetch.
      mockApiFetch.mockClear();

      capturedOnResize?.(100, 30);
      capturedOnResize?.(130, 40);
      capturedOnResize?.(160, 50);

      // Without debounce, every call goes through immediately.
      expect(mockApiFetch).toHaveBeenCalledTimes(3);
      expect(mockApiFetch).toHaveBeenNthCalledWith(
        1,
        '/api/sessions/emergency-1/resize',
        expect.objectContaining({
          body: JSON.stringify({ cols: 100, rows: 30 }),
        }),
      );
      expect(mockApiFetch).toHaveBeenNthCalledWith(
        3,
        '/api/sessions/emergency-1/resize',
        expect.objectContaining({
          body: JSON.stringify({ cols: 160, rows: 50 }),
        }),
      );

      vi.useRealTimers();
    });

    it('passes fontSize=12 to XTermTerminal on narrow viewport', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.dispatchEvent(new Event('resize'));

      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });

      expect(capturedFontSize).toBe(12);

      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalWidth,
      });
    });

    it('passes fontSize=14 to XTermTerminal on wide viewport', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });
      window.dispatchEvent(new Event('resize'));

      mockFetchResponse({
        sessionId: 'emergency-1',
        projectId: null,
        name: 'Emergency Terminal',
        status: 'active',
        type: 'emergency',
        createdAt: Date.now(),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
      });

      expect(capturedFontSize).toBe(14);

      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalWidth,
      });
    });
  });
});
