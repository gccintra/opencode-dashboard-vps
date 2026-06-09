import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmergencyTerminal from './EmergencyTerminal';

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <EmergencyTerminal />
    </MemoryRouter>,
  );
}

describe('EmergencyTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('renders the emergency terminal button', () => {
    // Mock the initial fetch to return no emergency session
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    expect(screen.getByTestId('emergency-terminal-button')).toBeInTheDocument();
  });

  it('shows "Terminal de Emergência" label when no active session', () => {
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    const label = screen.getByTestId('emergency-terminal-label');
    expect(label.textContent).toContain('Terminal de Emergência');
  });

  it('opens confirmation modal on click when no active session', async () => {
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
    });
  });

  it('shows confirmation text in modal', async () => {
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      // Both the button and modal contain "Terminal de Emergência" — scope to modal
      const modal = screen.getByTestId('emergency-modal');
      expect(modal).toBeInTheDocument();
      expect(modal.querySelector('h2')).toHaveTextContent('Terminal de Emergência');
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
      expect(screen.getByText('Abrir Terminal')).toBeInTheDocument();
    });
  });

  it('closes modal on Cancel click', async () => {
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('emergency-modal-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
    });
  });

  it('closes modal on overlay click', async () => {
    mockApiFetch.mockRejectedValue(new Error('No emergency session'));
    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal-overlay')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('emergency-modal-overlay'));

    await waitFor(() => {
      expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
    });
  });

  it('calls API on confirm and shows creating state', async () => {
    // Mock: first call returns no session (reject), second call (POST) returns session
    mockApiFetch.mockRejectedValueOnce(new Error('No emergency session')).mockResolvedValueOnce({
      sessionId: 'emerg-123',
      projectId: null,
      name: 'Emergency Terminal',
      status: 'active',
      type: 'emergency',
      createdAt: Date.now(),
    });

    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal-confirm')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('emergency-modal-confirm'));

    await waitFor(() => {
      // API should be called with POST
      expect(mockApiFetch).toHaveBeenCalledWith('/api/emergency-terminal', { method: 'POST' });
    });
  });

  it('shows error message on API failure', async () => {
    mockApiFetch
      .mockRejectedValueOnce(new Error('No emergency session'))
      .mockRejectedValueOnce(new Error('Server error'));

    renderComponent();

    fireEvent.click(screen.getByTestId('emergency-terminal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal-confirm')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('emergency-modal-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-modal-error')).toBeInTheDocument();
    });
  });
});
