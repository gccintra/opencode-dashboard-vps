import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DirectoryBrowseModal from './DirectoryBrowseModal';

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getToken: vi.fn(() => 'test-token'),
}));

describe('DirectoryBrowseModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    initialPath: '/home/test',
  };

  const mockDirectories = {
    directories: [
      { name: 'projects', path: '/home/test/projects' },
      { name: 'documents', path: '/home/test/documents' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(mockDirectories);
  });

  it('renders modal when isOpen is true', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    expect(screen.getByText('Select Directory')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<DirectoryBrowseModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Select Directory')).not.toBeInTheDocument();
  });

  it('displays current path', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('/home/test')).toBeInTheDocument();
    });
  });

  it('fetches and displays directories', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('documents')).toBeInTheDocument();
    });
  });

  it('shows loading spinner while fetching', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    render(<DirectoryBrowseModal {...defaultProps} />);
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('navigates into a subdirectory on click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    mockApiFetch.mockClear();
    fireEvent.click(screen.getByText('projects'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('calls onSelect with current path on "Select this directory" click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Select this directory'));
    expect(defaultProps.onSelect).toHaveBeenCalledWith('/home/test');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose on Cancel click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose on backdrop click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('does not close on modal body click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Select Directory'));
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('renders breadcrumbs for current path', async () => {
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('home')).toBeInTheDocument();
    });
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('navigates to root on "/" breadcrumb click', async () => {
    render(<DirectoryBrowseModal {...defaultProps} initialPath="/home/test" />);
    await waitFor(() => {
      expect(screen.getByText('test')).toBeInTheDocument();
    });
    mockApiFetch.mockClear();
    const rootBtn = screen.getByRole('button', { name: '/' });
    fireEvent.click(rootBtn);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('shows "No directories found" when empty', async () => {
    mockApiFetch.mockResolvedValue({ directories: [] });
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No directories found')).toBeInTheDocument();
    });
  });

  it('shows error when API fails', async () => {
    mockApiFetch.mockRejectedValue({ message: 'Failed to load directories' });
    render(<DirectoryBrowseModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load directories')).toBeInTheDocument();
    });
  });
});
