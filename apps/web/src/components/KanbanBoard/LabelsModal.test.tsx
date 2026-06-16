import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── API mocks ──
const fetchLabels = vi.fn();
const createLabel = vi.fn();
const deleteLabel = vi.fn();
const updateLabel = vi.fn();

vi.mock('../../lib/api', () => ({
  fetchLabels: (...a: unknown[]) => fetchLabels(...a),
  createLabel: (...a: unknown[]) => createLabel(...a),
  deleteLabel: (...a: unknown[]) => deleteLabel(...a),
  updateLabel: (...a: unknown[]) => updateLabel(...a),
}));

import { LabelsModal } from './LabelsModal';

describe('LabelsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLabels.mockResolvedValue([]);
  });

  it('does not render when open=false', () => {
    render(<LabelsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Manage Labels')).not.toBeInTheDocument();
  });

  it('renders the modal title when open=true', () => {
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Manage Labels')).toBeInTheDocument();
  });

  it('renders a Done button', () => {
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
  });

  it('calls onClose when Done button is clicked', () => {
    const onClose = vi.fn();
    render(<LabelsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the X close button is clicked', () => {
    const onClose = vi.fn();
    render(<LabelsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render a project selector (labels are global)', () => {
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
  });

  it('calls fetchLabels on mount (global, no project arg)', async () => {
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(fetchLabels).toHaveBeenCalledWith());
  });

  it('shows existing labels from fetchLabels', async () => {
    fetchLabels.mockResolvedValue([
      { id: 'label-1', name: 'Bug', color: '#f55', createdAt: '2026-01-01' },
    ]);
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Bug')).toBeInTheDocument());
  });

  it('shows New label button (create is allowed in standalone mode)', async () => {
    render(<LabelsModal open={true} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /New label/i })).toBeInTheDocument();
  });
});
