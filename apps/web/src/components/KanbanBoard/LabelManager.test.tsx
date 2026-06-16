import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Label } from '../../lib/api';

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

import { LabelManager } from './LabelManager';

const label = (over: Partial<Label> = {}): Label => ({
  id: 'l1',
  name: 'bug',
  color: '#f55',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('LabelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLabels.mockResolvedValue([label()]);
    createLabel.mockResolvedValue(label({ id: 'l2', name: 'feature', color: '#b3e502' }));
    deleteLabel.mockResolvedValue(undefined);
    updateLabel.mockResolvedValue(label({ color: '#0db' }));
  });

  it('loads and lists global labels', async () => {
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} />);
    expect(await screen.findByText('bug')).toBeInTheDocument();
    expect(fetchLabels).toHaveBeenCalledWith();
  });

  it('shows an empty state when there are no labels', async () => {
    fetchLabels.mockResolvedValue([]);
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} />);
    expect(await screen.findByText(/No labels yet/i)).toBeInTheDocument();
  });

  it('calls onToggle when a label row is clicked', async () => {
    const onToggle = vi.fn();
    render(<LabelManager appliedIds={[]} onToggle={onToggle} />);
    const row = await screen.findByRole('button', { name: /Apply label bug/i });
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith('l1');
  });

  it('reflects applied state via aria-pressed', async () => {
    render(<LabelManager appliedIds={['l1']} onToggle={vi.fn()} />);
    const row = await screen.findByRole('button', { name: /Remove label bug/i });
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  it('validates that a new label name is required', async () => {
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} allowCreate={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /New label/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add label/i }));
    expect(await screen.findByText(/Label name is required/i)).toBeInTheDocument();
    expect(createLabel).not.toHaveBeenCalled();
  });

  it('creates a new label with a valid name and color', async () => {
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} allowCreate={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /New label/i }));
    fireEvent.change(screen.getByPlaceholderText('Label name'), {
      target: { value: 'feature' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add label/i }));
    await waitFor(() =>
      expect(createLabel).toHaveBeenCalledWith({
        name: 'feature',
        color: expect.any(String),
      }),
    );
  });

  it('deletes a label optimistically', async () => {
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} allowCreate={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete label bug/i }));
    await waitFor(() => expect(deleteLabel).toHaveBeenCalledWith('l1'));
    expect(screen.queryByText('bug')).toBeNull();
  });

  it('hides create form when allowCreate=false', async () => {
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} allowCreate={false} />);
    await screen.findByText('bug');
    expect(screen.queryByRole('button', { name: /New label/i })).not.toBeInTheDocument();
  });

  it('surfaces an error when loading fails', async () => {
    fetchLabels.mockRejectedValue({ status: 500, message: 'boom' });
    render(<LabelManager appliedIds={[]} onToggle={vi.fn()} />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
