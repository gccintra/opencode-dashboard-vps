import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileTree from './FileTree';
import { FileClipboardProvider } from '../../context/FileClipboardContext';

// FileTree calls useGlobalClipboard, which requires FileClipboardProvider.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: FileClipboardProvider });

/* ── Mocks ── */

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getToken: () => 'test-token',
  saveToken: vi.fn(),
  clearToken: vi.fn(),
}));

describe('FileTree', () => {
  const mockFileOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);
    expect(screen.getByTestId('filetree-loading')).toBeInTheDocument();
  });

  it('renders file list after loading', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'src', type: 'directory', size: 0, modifiedAt: '2024-01-01T00:00:00Z' },
      { name: 'README.md', type: 'file', size: 100, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });
  });

  it('shows empty state for empty project', async () => {
    mockApiFetch.mockResolvedValueOnce([]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByTestId('filetree-empty')).toBeInTheDocument();
    });
  });

  it('shows error state with retry button', async () => {
    mockApiFetch.mockRejectedValueOnce({ status: 500, message: 'Server error' });

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByTestId('filetree-error')).toBeInTheDocument();
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });

    // Retry
    mockApiFetch.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByTestId('filetree-empty')).toBeInTheDocument();
    });
  });

  it('renders breadcrumb with root', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
      expect(screen.getByText('root')).toBeInTheDocument();
    });
  });

  it('opens file on click', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'app.ts', type: 'file', size: 50, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('app.ts')).toBeInTheDocument();
    });

    // FileTree's handleFileOpen checks file size by listing parent dir
    mockApiFetch.mockResolvedValueOnce([
      { name: 'app.ts', type: 'file', size: 50, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    fireEvent.click(screen.getByText('app.ts'));

    await waitFor(() => {
      expect(mockFileOpen).toHaveBeenCalledWith('proj-1', 'app.ts');
    });
  });

  it('renders tree with data attributes', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'src', type: 'directory', size: 0, modifiedAt: '2024-01-01T00:00:00Z' },
      { name: 'index.ts', type: 'file', size: 42, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByTestId('file-tree')).toBeInTheDocument();
      const treeNode = screen.getByTestId('tree-node-src');
      expect(treeNode).toHaveAttribute('data-type', 'directory');
    });
  });

  it('shows an always-visible inline search input', async () => {
    mockApiFetch.mockResolvedValueOnce([]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    // Search is now an inline filter in the toolbar — no toggle button.
    await waitFor(() => {
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
  });

  it('shows context menu on right click', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'app.ts', type: 'file', size: 50, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('app.ts')).toBeInTheDocument();
    });

    const node = screen.getByText('app.ts').closest('[role="treeitem"]')!;
    fireEvent.contextMenu(node);

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });
  });

  it('shows create modal from context menu', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'src', type: 'directory', size: 0, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    const node = screen.getByText('src').closest('[role="treeitem"]')!;
    fireEvent.contextMenu(node);

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New File'));

    await waitFor(() => {
      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
      expect(screen.getByTestId('create-input')).toBeInTheDocument();
    });
  });

  it('hides context menu on outside click', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { name: 'app.ts', type: 'file', size: 50, modifiedAt: '2024-01-01T00:00:00Z' },
    ]);

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('app.ts')).toBeInTheDocument();
    });

    const node = screen.getByText('app.ts').closest('[role="treeitem"]')!;
    fireEvent.contextMenu(node);

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });

    fireEvent.click(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument();
    });
  });

  it('creates file via modal', async () => {
    // Use mockImplementation (not mockResolvedValueOnce) to handle potential
    // extra API calls from React StrictMode double-rendering or re-renders.
    // Each call checks the URL to return the right data.
    let createCalled = false;
    mockApiFetch.mockImplementation((path: string, options?: Record<string, unknown>) => {
      const url = typeof path === 'string' ? path : '';
      // POST to create a file
      if (options?.method === 'POST') {
        createCalled = true;
        return Promise.resolve({});
      }
      // File listing request — after create, return the new file too
      if (url.includes('/files?path=')) {
        if (createCalled) {
          return Promise.resolve([
            { name: 'src', type: 'directory', size: 0, modifiedAt: '' },
            { name: 'newfile.ts', type: 'file', size: 0, modifiedAt: '' },
          ]);
        }
        return Promise.resolve([
          { name: 'src', type: 'directory', size: 0, modifiedAt: '2024-01-01T00:00:00Z' },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<FileTree projectId="proj-1" onFileOpen={mockFileOpen} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    // Right-click on the directory node
    const node = screen.getByText('src').closest('[role="treeitem"]')!;
    fireEvent.contextMenu(node);

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });

    // Click 'New File'
    fireEvent.click(screen.getByText('New File'));

    await waitFor(() => {
      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    const input = screen.getByTestId('create-input') as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(input, 'newfile.ts');

    expect(input.value).toBe('newfile.ts');

    fireEvent.click(screen.getByText('Create'));

    // Verify POST was called
    await waitFor(() => {
      const calls = mockApiFetch.mock.calls;
      const postCall = calls.find(
        (call: unknown[]) =>
          typeof call[1] === 'object' &&
          call[1] !== null &&
          (call[1] as Record<string, unknown>).method === 'POST',
      );
      expect(postCall).toBeDefined();
    });
  }, 10000);
});
