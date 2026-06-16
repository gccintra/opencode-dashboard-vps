import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { TaskLink } from '../../lib/api';

const fetchTaskLinks = vi.fn();
const createTaskLink = vi.fn();
const deleteTaskLink = vi.fn();
const apiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  fetchTaskLinks: (...a: unknown[]) => fetchTaskLinks(...a),
  createTaskLink: (...a: unknown[]) => createTaskLink(...a),
  deleteTaskLink: (...a: unknown[]) => deleteTaskLink(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

import { LinkedTasks } from './LinkedTasks';

const link = (over: Partial<TaskLink> = {}): TaskLink => ({
  id: 'lnk1',
  type: 'blocks',
  createdAt: '2026-01-01T00:00:00Z',
  task: { id: 't2', title: 'Other task', column: 'backlog', columnName: 'Backlog', projectName: 'P' },
  ...over,
});

describe('LinkedTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTaskLinks.mockResolvedValue([]);
    apiFetch.mockResolvedValue([]);
  });

  it('renders existing links grouped by type', async () => {
    fetchTaskLinks.mockResolvedValue([link()]);
    render(<LinkedTasks taskId="t1" />);
    expect(await screen.findByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText('Other task')).toBeInTheDocument();
  });

  it('shows empty state when there are no links', async () => {
    render(<LinkedTasks taskId="t1" />);
    expect(await screen.findByText('No linked tasks.')).toBeInTheDocument();
  });

  it('opens the picker and creates a link', async () => {
    fetchTaskLinks.mockResolvedValue([]);
    apiFetch.mockResolvedValue([
      { id: 't2', title: 'Candidate', column: 'backlog', projectName: 'P' },
    ]);
    createTaskLink.mockResolvedValue(link({ id: 'new' }));

    render(<LinkedTasks taskId="t1" />);
    fireEvent.click(await screen.findByText('+ Add link'));
    fireEvent.click(await screen.findByText('Candidate'));

    await waitFor(() =>
      expect(createTaskLink).toHaveBeenCalledWith('t1', 't2', 'relates_to'),
    );
  });

  it('removes a link', async () => {
    fetchTaskLinks.mockResolvedValue([link()]);
    deleteTaskLink.mockResolvedValue(undefined);

    render(<LinkedTasks taskId="t1" />);
    fireEvent.click(await screen.findByLabelText('Remove link'));

    await waitFor(() => expect(deleteTaskLink).toHaveBeenCalledWith('t1', 'lnk1'));
  });
});
