import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── API mocks (cover both the page and the TaskDetail component) ──
const apiFetch = vi.fn();
const fetchKanbanColumns = vi.fn();

vi.mock('../lib/api', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  fetchKanbanColumns: (...a: unknown[]) => fetchKanbanColumns(...a),
  applyTaskLabels: vi.fn().mockResolvedValue({}),
  fetchLabels: vi.fn().mockResolvedValue([]),
  fetchProjectSessions: vi.fn().mockResolvedValue([]),
  fetchTaskAttachments: vi.fn().mockResolvedValue([]),
  implementTask: vi.fn().mockResolvedValue({ started: true }),
  setTaskSession: vi.fn().mockResolvedValue({}),
  uploadTaskAttachment: vi.fn(),
  deleteTaskAttachment: vi.fn(),
  fetchAttachmentBlob: vi.fn().mockResolvedValue(new Blob(['x'])),
  fetchAgentHint: vi.fn().mockResolvedValue({ hint: null, hasOpencode: false, hasClaude: false }),
  updateTaskAgentConfig: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({ sessionId: 's', name: 'S', status: 'active', createdAt: 1 }),
  fetchAgentCatalog: vi.fn().mockResolvedValue({ opencode: { agents: [] }, claude: { agents: [], commands: [] } }),
  fetchAgentModels: vi.fn().mockResolvedValue([]),
  fetchSpawnHistory: vi.fn().mockResolvedValue([]),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  updateLabel: vi.fn(),
  // Priority + activity/links (embedded ActivityTimeline / LinkedTasks):
  updateTaskPriority: vi.fn().mockResolvedValue(undefined),
  fetchTaskActivity: vi.fn().mockResolvedValue([]),
  postComment: vi.fn().mockResolvedValue({}),
  editComment: vi.fn().mockResolvedValue({}),
  deleteComment: vi.fn().mockResolvedValue(undefined),
  fetchTaskLinks: vi.fn().mockResolvedValue([]),
  createTaskLink: vi.fn().mockResolvedValue({}),
  deleteTaskLink: vi.fn().mockResolvedValue(undefined),
}));

import TaskDetailPage from './TaskDetail';

const task = {
  id: 'task-1',
  projectId: 'proj-1',
  title: 'Routed task title',
  description: 'body',
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
};

function renderAt(taskId: string) {
  return render(
    <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
      <Routes>
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="/tasks" element={<div>Board view</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TaskDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([task]);
    fetchKanbanColumns.mockResolvedValue([
      { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#6b7280', sortOrder: 0, createdAt: '' },
    ]);
  });

  it('loads the task list and renders the matching task as a full page', async () => {
    renderAt('task-1');
    expect(await screen.findByRole('heading', { name: 'Routed task title' })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/tasks');
  });

  it('renders a back-to-board affordance (not a modal dialog)', async () => {
    renderAt('task-1');
    await screen.findByRole('heading', { name: 'Routed task title' });
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument();
    // It is a route page, not a modal overlay.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a not-found state when the task id is unknown', async () => {
    renderAt('missing-id');
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
  });
});
