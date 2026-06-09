import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CodeEditor from './CodeEditor';

/* ── Mocks ── */

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getToken: () => 'test-token',
  saveToken: vi.fn(),
  clearToken: vi.fn(),
}));

describe('CodeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('shows empty state when no files are open', () => {
    render(<CodeEditor projectId="proj-1" />);
    expect(screen.getByTestId('editor-empty')).toBeInTheDocument();
    expect(screen.getByText('Select a file to edit')).toBeInTheDocument();
  });

  it('loads and displays initial file', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'const x = 1;',
      size: 14,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('code-editor')).toBeInTheDocument();
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('const x = 1;');
  });

  it('displays tab with file name', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'test',
      size: 4,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
      expect(screen.getByTestId('tab-0')).toBeInTheDocument();
      expect(screen.getByText('app.ts')).toBeInTheDocument();
    });
  });

  it('shows line numbers', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'line1\nline2\nline3',
      size: 17,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('line-numbers')).toBeInTheDocument();
    });
  });

  it('marks tab as modified on edit', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'original',
      size: 8,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'modified content' } });

    await waitFor(() => {
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });
  });

  it('shows language badge for known extensions', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: '{"key": "value"}',
      size: 16,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="config.json" />);

    await waitFor(() => {
      expect(screen.getByTestId('code-editor')).toBeInTheDocument();
      expect(screen.getByText('json')).toBeInTheDocument();
    });
  });

  it('shows save error on API failure', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'test',
      size: 4,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    // Modify
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'modified' } });

    // Mock save failure
    mockApiFetch.mockRejectedValueOnce({ status: 500, message: 'Save failed' });

    // Trigger Ctrl+S
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('editor-error')).toBeInTheDocument();
    });
  });

  it('shows close button on tabs', async () => {
    mockApiFetch.mockResolvedValueOnce({
      content: 'test',
      size: 4,
      encoding: 'utf-8',
      modifiedAt: '2024-01-01T00:00:00Z',
    });

    render(<CodeEditor projectId="proj-1" initialFilePath="src/app.ts" />);

    await waitFor(() => {
      expect(screen.getByTestId('close-tab-0')).toBeInTheDocument();
    });
  });
});
