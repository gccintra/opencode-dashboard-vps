import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { TaskActivity } from '../../lib/api';

const fetchTaskActivity = vi.fn();
const postComment = vi.fn();
const editComment = vi.fn();
const deleteComment = vi.fn();

vi.mock('../../lib/api', () => ({
  fetchTaskActivity: (...a: unknown[]) => fetchTaskActivity(...a),
  postComment: (...a: unknown[]) => postComment(...a),
  editComment: (...a: unknown[]) => editComment(...a),
  deleteComment: (...a: unknown[]) => deleteComment(...a),
}));

// Markdown renders its children as plain text in tests.
vi.mock('../Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ActivityTimeline } from './ActivityTimeline';

const ev = (over: Partial<TaskActivity> = {}): TaskActivity => ({
  id: 'e1',
  taskId: 't1',
  type: 'created',
  body: null,
  field: null,
  oldValue: null,
  newValue: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('ActivityTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTaskActivity.mockResolvedValue([]);
  });

  it('renders system events as readable sentences', async () => {
    fetchTaskActivity.mockResolvedValue([
      ev({ type: 'created' }),
      ev({ id: 'e2', type: 'moved', oldValue: 'backlog', newValue: 'done' }),
    ]);
    render(
      <ActivityTimeline
        taskId="t1"
        kanbanColumns={[
          { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#000', sortOrder: 0, createdAt: '' },
          { id: 'done', name: 'Done', category: 'completed', color: '#000', sortOrder: 0, createdAt: '' },
        ]}
      />,
    );
    expect(await screen.findByText(/created this task/)).toBeInTheDocument();
    expect(screen.getByText(/moved from Backlog to Done/)).toBeInTheDocument();
  });

  it('renders a comment and posts a new one', async () => {
    fetchTaskActivity.mockResolvedValue([ev({ type: 'comment', body: 'hello world' })]);
    postComment.mockResolvedValue(ev({ id: 'c2', type: 'comment', body: 'new one' }));

    render(<ActivityTimeline taskId="t1" />);
    expect(await screen.findByText('hello world')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: 'new one' } });
    fireEvent.click(screen.getByText('Comment'));

    await waitFor(() => expect(postComment).toHaveBeenCalledWith('t1', 'new one'));
  });

  it('shows empty state when there is no activity', async () => {
    render(<ActivityTimeline taskId="t1" />);
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
  });
});
