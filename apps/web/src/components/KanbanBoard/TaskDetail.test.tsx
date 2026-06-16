import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Task } from './KanbanCard';
import type { ProjectSession } from '../../lib/api';

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

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
const fetchAgentHint = vi.fn();
const updateTaskAgentConfig = vi.fn();
const createSession = vi.fn();
const fetchAgentCatalog = vi.fn();
const fetchAgentModels = vi.fn();
const fetchSpawnHistory = vi.fn();

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
  fetchAgentHint: (...a: unknown[]) => fetchAgentHint(...a),
  updateTaskAgentConfig: (...a: unknown[]) => updateTaskAgentConfig(...a),
  createSession: (...a: unknown[]) => createSession(...a),
  fetchAgentCatalog: (...a: unknown[]) => fetchAgentCatalog(...a),
  fetchAgentModels: (...a: unknown[]) => fetchAgentModels(...a),
  fetchSpawnHistory: (...a: unknown[]) => fetchSpawnHistory(...a),
  // LabelManager pulls these in too:
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  updateLabel: vi.fn(),
  // Priority + activity/links (used by the embedded ActivityTimeline / LinkedTasks):
  updateTaskPriority: vi.fn().mockResolvedValue(undefined),
  fetchTaskActivity: vi.fn().mockResolvedValue([]),
  postComment: vi.fn().mockResolvedValue({}),
  editComment: vi.fn().mockResolvedValue({}),
  deleteComment: vi.fn().mockResolvedValue(undefined),
  fetchTaskLinks: vi.fn().mockResolvedValue([]),
  createTaskLink: vi.fn().mockResolvedValue({}),
  deleteTaskLink: vi.fn().mockResolvedValue(undefined),
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
    fetchAgentHint.mockResolvedValue({ hint: null, hasOpencode: false, hasClaude: false });
    updateTaskAgentConfig.mockResolvedValue(undefined);
    createSession.mockResolvedValue({ sessionId: 'new-sess', name: 'New', status: 'active', createdAt: 1 });
    fetchAgentCatalog.mockResolvedValue({
      opencode: { agents: [] },
      claude: { agents: [], commands: [] },
    });
    fetchAgentModels.mockResolvedValue([]);
    fetchSpawnHistory.mockResolvedValue([]);
  });

  it('renders the task title', async () => {
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Implement feature X' })).toBeInTheDocument();
  });

  it('shows the markdown preview by default and toggles to edit', async () => {
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    // Preview rendered as a heading from markdown
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    // Switch to edit → textarea visible
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/Task description \(markdown\)/i)).toBeInTheDocument();
  });

  it('saves the description after editing', async () => {
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} onChanged={vi.fn()} />);
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
      labels: [{ id: 'l1', name: 'bug', color: '#f55', createdAt: 'x' }],
    });
    renderInRouter(<TaskDetail task={task} onClose={vi.fn()} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove label bug/i })).toBeInTheDocument();
  });

  it('removes a label via the chip and calls applyTaskLabels', async () => {
    const task = baseTask({
      labels: [{ id: 'l1', name: 'bug', color: '#f55', createdAt: 'x' }],
    });
    renderInRouter(<TaskDetail task={task} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove label bug/i }));
    await waitFor(() => expect(applyTaskLabels).toHaveBeenCalledWith('task-1', []));
  });

  it('fetches attachments on mount', async () => {
    fetchTaskAttachments.mockResolvedValue([
      { id: 'a1', taskId: 'task-1', filename: 'pic.png', mime: 'image/png', size: 10, createdAt: 'x' },
    ]);
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await waitFor(() => expect(fetchTaskAttachments).toHaveBeenCalledWith('task-1'));
    expect(await screen.findByText('pic.png')).toBeInTheDocument();
  });

  it('lists project sessions in the dropdown', async () => {
    fetchProjectSessions.mockResolvedValue([session()]);
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await waitFor(() => expect(fetchProjectSessions).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByRole('option', { name: /Session 1/i })).toBeInTheDocument();
  });

  it('associates a session via the dropdown', async () => {
    fetchProjectSessions.mockResolvedValue([session()]);
    renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Session 1/i });
    fireEvent.change(screen.getByLabelText('Associated session'), {
      target: { value: 'sess-1' },
    });
    await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', 'sess-1'));
  });

  describe('implement button', () => {
    it('shows "Spawn & implement" when no session is associated', async () => {
      renderInRouter(<TaskDetail task={baseTask({ sessionId: null })} onClose={vi.fn()} />);
      const btn = screen.getByRole('button', { name: /Spawn & implement/i });
      expect(btn).not.toBeDisabled();
    });

    it('spawns a configured session then implements with a boot delay (no session)', async () => {
      renderInRouter(<TaskDetail task={baseTask({ sessionId: null })} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Spawn & implement/i }));
      await waitFor(() => expect(createSession).toHaveBeenCalled());
      await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', 'new-sess'));
      // delayMs > 0 so the prompt lands after the CLI boots
      await waitFor(() => {
        const call = implementTask.mock.calls.at(-1);
        expect(call?.[0]).toBe('task-1');
        expect(call?.[1]).toBeGreaterThan(0);
      });
    });

    it('respawns when the session is expired', async () => {
      renderInRouter(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'expired' })}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /Spawn & implement/i })).not.toBeDisabled();
      expect(screen.getAllByText(/expired/i).length).toBeGreaterThan(0);
    });

    it('implements immediately (no delay) for an active session', async () => {
      renderInRouter(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'active' })}
          onClose={vi.fn()}
        />,
      );
      const btn = screen.getByRole('button', { name: /^Implement$/i });
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      await waitFor(() => expect(implementTask).toHaveBeenCalledWith('task-1', 0));
      expect(await screen.findByText(/prompt sent to the session/i)).toBeInTheDocument();
    });

    it('marks the session expired when implement returns 409', async () => {
      implementTask.mockRejectedValue({ status: 409, message: 'session expired' });
      renderInRouter(
        <TaskDetail
          task={baseTask({ sessionId: 'sess-1', sessionStatus: 'active' })}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^Implement$/i }));
      await waitFor(() => expect(implementTask).toHaveBeenCalled());
      expect(await screen.findByText('session expired')).toBeInTheDocument();
    });
  });

  it('calls onClose when the back button is clicked', async () => {
    const onClose = vi.fn();
    renderInRouter(<TaskDetail task={baseTask()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a "re-associate" action when the session is expired', async () => {
    renderInRouter(
      <TaskDetail
        task={baseTask({ sessionId: 'sess-1', sessionStatus: 'expired' })}
        onClose={vi.fn()}
      />,
    );
    const reassoc = screen.getByRole('button', { name: /Re-associate|Clear/i });
    fireEvent.click(reassoc);
    await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', null));
  });

  // ── Agent selector ──
  describe('Agent section', () => {
    it('renders agent selector with Opencode and Claude buttons', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Opencode/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument();
    });

    it('calls fetchAgentHint with the task projectId on mount', async () => {
      renderInRouter(<TaskDetail task={baseTask({ projectId: 'proj-42' })} onClose={vi.fn()} />);
      await waitFor(() => expect(fetchAgentHint).toHaveBeenCalledWith('proj-42'));
    });

    it('persists the runtime via updateTaskAgentConfig when a runtime button is clicked', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Opencode/i }));
      await waitFor(() =>
        expect(updateTaskAgentConfig).toHaveBeenCalledWith(
          'task-1',
          expect.objectContaining({ agentType: 'opencode' }),
        ),
      );
    });

    it('highlights the selected agent button matching task.agentType', async () => {
      renderInRouter(<TaskDetail task={baseTask({ agentType: 'claude' })} onClose={vi.fn()} />);
      const claudeBtn = screen.getByRole('button', { name: /Claude/i });
      // The selected button has a different background class
      expect(claudeBtn.className).toMatch(/bg-\[rgba/);
    });

    it('shows detected hint badge when fetchAgentHint returns opencode', async () => {
      fetchAgentHint.mockResolvedValue({ hint: 'opencode', hasOpencode: true, hasClaude: false });
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText(/Detected/i)).toBeInTheDocument());
      // The badge renders the dir name with a leading dot — match it exactly to
      // avoid colliding with other "opencode" copy (e.g. the footer hint).
      expect(screen.getByText('.opencode')).toBeInTheDocument();
    });

    it('shows detected hint badge when fetchAgentHint returns both', async () => {
      fetchAgentHint.mockResolvedValue({ hint: 'both', hasOpencode: true, hasClaude: true });
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText(/Detected/i)).toBeInTheDocument());
    });
  });

  // ── Spawn session ──
  describe('Spawn session', () => {
    it('shows spawn session button when no session is associated', async () => {
      renderInRouter(<TaskDetail task={baseTask({ sessionId: null })} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Spawn session/i })).toBeInTheDocument();
    });

    it('does not show spawn session button when a session is already associated', async () => {
      renderInRouter(
        <TaskDetail task={baseTask({ sessionId: 'sess-1', sessionStatus: 'active' })} onClose={vi.fn()} />,
      );
      expect(screen.queryByRole('button', { name: /Spawn session/i })).not.toBeInTheDocument();
    });

    it('calls createSession and setTaskSession when spawn button is clicked', async () => {
      renderInRouter(<TaskDetail task={baseTask({ sessionId: null })} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Spawn session/i }));
      await waitFor(() => expect(createSession).toHaveBeenCalled());
      await waitFor(() => expect(setTaskSession).toHaveBeenCalledWith('task-1', 'new-sess'));
    });

    it('passes agentType from task to createSession when spawning', async () => {
      renderInRouter(
        <TaskDetail task={baseTask({ sessionId: null, agentType: 'opencode' })} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Spawn session/i }));
      await waitFor(() =>
        expect(createSession).toHaveBeenCalledWith(
          'proj-1',
          expect.objectContaining({ agentType: 'opencode' }),
        ),
      );
    });
  });

  // ── Prompt preview ──
  describe('Prompt preview', () => {
    it('renders a prompt preview toggle button', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Prompt preview/i })).toBeInTheDocument();
    });

    it('shows prompt content when prompt preview is expanded', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Prompt preview/i }));
      await waitFor(() => expect(screen.getAllByText(/Implement feature X/i).length).toBeGreaterThan(0));
    });

    it('shows copy prompt button', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Copy prompt/i })).toBeInTheDocument();
    });

    it('calls navigator.clipboard.writeText when copy prompt is clicked', async () => {
      const writeMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeMock },
        configurable: true,
      });
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Copy prompt/i }));
      await waitFor(() => expect(writeMock).toHaveBeenCalled());
      const written = writeMock.mock.calls[0]?.[0] as string;
      expect(written).toContain('Implement feature X');
    });
  });

  // ── Title inline editing ──
  describe('Title inline editing', () => {
    it('shows editable input when title is clicked', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      const titleEl = screen.getByText('Implement feature X');
      fireEvent.click(titleEl);
      expect(screen.getByDisplayValue('Implement feature X')).toBeInTheDocument();
    });

    it('saves title on Enter key', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Implement feature X'));
      const input = screen.getByDisplayValue('Implement feature X');
      fireEvent.change(input, { target: { value: 'Updated Title' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/tasks/'),
          expect.objectContaining({ method: 'PUT', body: expect.stringContaining('Updated Title') }),
        ),
      );
    });
  });

  // ── Status change in sidebar ──
  describe('Status section in sidebar', () => {
    it('renders status options (Backlog, In Progress, Done)', async () => {
      renderInRouter(<TaskDetail task={baseTask()} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Backlog/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /In Progress/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
    });

    it('calls move API when status is changed', async () => {
      renderInRouter(<TaskDetail task={baseTask({ column: 'backlog' })} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /In Progress/i }));
      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/move'),
          expect.objectContaining({ method: 'PUT' }),
        ),
      );
    });
  });
});
