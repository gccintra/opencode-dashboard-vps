import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Task } from './KanbanCard';
import type { ProjectSession } from '../../lib/api';

// ── API mocks ──
const apiFetch = vi.fn();
const applyTaskLabels = vi.fn();
const fetchLabels = vi.fn();
const fetchProjectSessions = vi.fn();
const fetchTaskAttachments = vi.fn();
const implementTask = vi.fn();
const setTaskSession = vi.fn();
const uploadTaskAttachment = vi.fn();
const deleteTaskAttachment = vi.fn();
const fetchAttachmentBlob = vi.fn((..._a: unknown[]) =>
  Promise.resolve(new Blob(['x'], { type: 'image/png' })),
);

// jsdom doesn't implement the object-URL API used by AttachmentList.
globalThis.URL.createObjectURL =
  globalThis.URL.createObjectURL || ((() => 'blob:mock') as typeof URL.createObjectURL);
globalThis.URL.revokeObjectURL =
  globalThis.URL.revokeObjectURL || ((() => undefined) as typeof URL.revokeObjectURL);

vi.mock('../../lib/api', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  applyTaskLabels: (...a: unknown[]) => applyTaskLabels(...a),
  fetchLabels: (...a: unknown[]) => fetchLabels(...a),
  fetchProjectSessions: (...a: unknown[]) => fetchProjectSessions(...a),
  fetchTaskAttachments: (...a: unknown[]) => fetchTaskAttachments(...a),
  implementTask: (...a: unknown[]) => implementTask(...a),
  setTaskSession: (...a: unknown[]) => setTaskSession(...a),
  uploadTaskAttachment: (...a: unknown[]) => uploadTaskAttachment(...a),
  deleteTaskAttachment: (...a: unknown[]) => deleteTaskAttachment(...a),
  fetchAttachmentBlob: (...a: unknown[]) => fetchAttachmentBlob(...a),
  // LabelManager pulls these in too:
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  updateLabel: vi.fn(),
}));

import { TaskDetail } from './TaskDetail';

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'proj-1',
  title: 'Implement feature X',
  description: '# Heading\n\nbody text',
  source: 'local',
  column: 'backlog',
  sortOrder: 0,
  githubIssueUrl: null,
  githubLabels: null,
  githubIssueNumber: null,
  sessionId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  projectName: 'Proj',
  labels: [],
  attachments: [],
  sessionStatus: null,
  ...over,
});

const session = (over: Partial<ProjectSession> = {}): ProjectSession => ({
  sessionId: 'sess-1',
  name: 'Session 1',
  status: 'active',
  createdAt: 1,
  ...over,
});

describe('TaskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
    applyTaskLabels.mockResolvedValue({});
    fetchLabels.mockResolvedValue([]);
    fetchProjectSessions.mockResolvedValue([]);
    fetchTaskAttachments.mockResolvedValue([]);
    implementTask.mockResolvedValue({ started: true });
    setTaskSession.mockResolvedValue({});
  });

  it('renders the task title', async () => {
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Implement feature X' })).toBeInTheDocument();
  });

  it('shows the markdown preview by default and toggles to edit', async () => {
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    // Preview rendered as a heading from markdown
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    // Switch to edit → textarea visible
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/Task description \(markdown\)/i)).toBeInTheDocument();
  });

  it('saves the description after editing', async () => {
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const ta = screen.getByLabelText(/Task description \(markdown\)/i);
    fireEvent.change(ta, { target: { value: 'updated body' } });
    fireEvent.click(screen.getByRole('button', { name: /Save description/i }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/tasks/task-1',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
  });

  it('renders applied labels as removable chips', async () => {
    const task = baseTask({
      labels: [{ id: 'l1', projectId: 'proj-1', name: 'bug', color: '#f55', createdAt: 'x' }],
    });
    render(<TaskDetail task={task} onClose={vi.fn()} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove label bug/i })).toBeInTheDocument();
  });

  it('removes a label via the chip and calls applyTaskLabels', async () => {
    const task = baseTask({
      labels: [{ id: 'l1', projectId: 'proj-1', name: 'bug', color: '#f55', createdAt: 'x' }],
    });
    render(<TaskDetail task={task} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove label bug/i }));
    await waitFor(() => expect(applyTaskLabels).toHaveBeenCalledWith('task-1', []));
  });

  it('fetches attachments on mount', async () => {
    fetchTaskAttachments.mockResolvedValue([
      { id: 'a1', taskId: 'task-1', filename: 'pic.png', mime: 'image/png', size: 10, createdAt: 'x' },
    ]);
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await waitFor(() => expect(fetchTaskAttachments).toHaveBeenCalledWith('task-1'));
    expect(await screen.findByText('pic.png')).toBeInTheDocument();
  });

  it('lists project sessions in the dropdown', async () => {
    fetchProjectSessions.mockResolvedValue([session()]);
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await waitFor(() => expect(fetchProjectSessions).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByRole('option', { name: /Session 1/i })).toBeInTheDocument();
  });

  it('associates a session via the dropdown', async () => {
    fetchProjectSessions.mockResolvedValue([session()]);
    render(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Session 1/i });
    fireEvent.change(screen.getByLabelText('Associated session'), {
      target: { value: 'sess-1' },
    });
    await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', 'sess-1'));
  });

  describe('implement button', () => {
    it('is disabled when no session is associated', async () => {
      render(<TaskDetail task={baseTask({ sessionId: null })} onClose={vi.fn()} />);
      const btn = screen.getByRole('button', { name: /Start implementation/i });
      expect(btn).toBeDisabled();
      expect(screen.getByText(/Associate a session to enable/i)).toBeInTheDocument();
    });

    it('is disabled when the session is expired', async () => {
      render(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'expired' })}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /Start implementation/i })).toBeDisabled();
      expect(screen.getAllByText(/expired/i).length).toBeGreaterThan(0);
    });

    it('is enabled and calls implementTask for an active session', async () => {
      render(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'active' })}
          onClose={vi.fn()}
        />,
      );
      const btn = screen.getByRole('button', { name: /Start implementation/i });
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      await waitFor(() => expect(implementTask).toHaveBeenCalledWith('task-1'));
      expect(await screen.findByText(/prompt sent to the session/i)).toBeInTheDocument();
    });

    it('marks the session expired when implement returns 409', async () => {
      implementTask.mockRejectedValue({ status: 409, message: 'session expired' });
      render(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'active' })}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Start implementation/i }));
      await waitFor(() => expect(implementTask).toHaveBeenCalled());
      expect(await screen.findByText('session expired')).toBeInTheDocument();
    });
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<TaskDetail task={baseTask()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a "re-associate" action when the session is expired', async () => {
    render(
      <TaskDetail
        task={baseTask({ sessionId: 'sess-1', sessionStatus: 'expired' })}
        onClose={vi.fn()}
      />,
    );
    const reassoc = screen.getByRole('button', { name: /Re-associate/i });
    fireEvent.click(reassoc);
    await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', null));
  });
});
