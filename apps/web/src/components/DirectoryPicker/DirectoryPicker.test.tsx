import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DirectoryPicker from './DirectoryPicker';

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getToken: vi.fn(() => 'test-token'),
}));

describe('DirectoryPicker', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  };

  const mockDirectories = {
    directories: [
      { name: 'projects', path: '/home/test/projects' },
      { name: 'documents', path: '/home/test/documents' },
      { name: 'photos', path: '/home/test/photos' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(mockDirectories);
  });

  it('renders input and browse button', () => {
    render(<DirectoryPicker {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText('Browse')).toBeInTheDocument();
  });

  it('shows value in input', () => {
    render(<DirectoryPicker {...defaultProps} value="/home/user" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('/home/user');
  });

  it('calls onChange when typing', () => {
    render(<DirectoryPicker {...defaultProps} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/home/test' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('/home/test');
  });

  it('disables input when disabled prop is true', () => {
    render(<DirectoryPicker {...defaultProps} disabled={true} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    expect(screen.getByText('Browse')).toBeDisabled();
  });

  it('shows error text when error prop is set', () => {
    render(<DirectoryPicker {...defaultProps} error="Directory is required" />);
    expect(screen.getByText('Directory is required')).toBeInTheDocument();
  });

  it('uses custom placeholder', () => {
    render(<DirectoryPicker {...defaultProps} placeholder="/custom/path" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.placeholder).toBe('/custom/path');
  });

  it('fetches suggestions after debounced typing', async () => {
    vi.useFakeTimers();
    render(<DirectoryPicker {...defaultProps} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/home/test' } });

    vi.advanceTimersByTime(300);

    expect(mockApiFetch).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows dropdown with suggestions', async () => {
    render(<DirectoryPicker {...defaultProps} />);

    mockApiFetch.mockResolvedValue(mockDirectories);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/home/test' } });

    await waitFor(
      () => {
        expect(mockApiFetch).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );
  });

  it('shows error styling when error prop is provided', () => {
    render(<DirectoryPicker {...defaultProps} error="Invalid path" />);
    const errorElement = screen.getByText('Invalid path');
    expect(errorElement).toBeInTheDocument();
    expect(errorElement.className).toContain('text-danger');
  });

  it('shows error styling when error prop is provided', () => {
    render(<DirectoryPicker {...defaultProps} error="Invalid path" />);
    const errorElement = screen.getByText('Invalid path');
    expect(errorElement).toBeInTheDocument();
    expect(errorElement.className).toContain('text-danger');
  });

  it('opens browse modal on Browse click', async () => {
    render(<DirectoryPicker {...defaultProps} />);
    fireEvent.click(screen.getByText('Browse'));

    await waitFor(() => {
      expect(screen.getByText('Select Directory')).toBeInTheDocument();
    });
  });

  it('passes current value as initialPath to modal', async () => {
    render(<DirectoryPicker {...defaultProps} value="/home/user" />);
    fireEvent.click(screen.getByText('Browse'));

    await waitFor(() => {
      expect(screen.getByText('/home/user')).toBeInTheDocument();
    });
  });
});
