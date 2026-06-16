import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();

vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
  getToken: () => null,
  saveToken: () => {},
  clearToken: () => {},
  // Rich-task additions: the board now loads project labels for the filter bar.
  fetchLabels: () => Promise.resolve([]),
  fetchProjectSessions: () => Promise.resolve([]),
  fetchTaskAttachments: () => Promise.resolve([]),
  fetchKanbanColumns: () =>
    Promise.resolve([
      { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#6b7280', sortOrder: 0, createdAt: '' },
      { id: 'in_progress', name: 'In Progress', category: 'started', color: '#f59e0b', sortOrder: 0, createdAt: '' },
      { id: 'done', name: 'Done', category: 'completed', color: '#22c55e', sortOrder: 0, createdAt: '' },
    ]),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let KanbanBoard: any;

const mockTasks: Array<Record<string, unknown>> = [
  {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'My Local Task',
    description: 'A task description',
    source: 'local',
    column: 'backlog',
    sortOrder: 0,
    githubIssueUrl: null,
    githubLabels: null,
    githubIssueNumber: null,
    sessionId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    projectName: 'Test Project',
  },
  {
    id: 'task-2',
    projectId: 'proj-1',
    title: 'GitHub Issue',
    description: 'An issue from GitHub',
    source: 'github',
    column: 'in_progress',
    sortOrder: 0,
    githubIssueUrl: 'https://github.com/user/repo/issues/42',
    githubLabels: [{ name: 'bug', color: 'ff0000' }],
    githubIssueNumber: 42,
    sessionId: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    projectName: 'Test Project',
  },
  {
    id: 'task-3',
    projectId: 'proj-1',
    title: 'Done Task',
    description: null,
    source: 'local',
    column: 'done',
    sortOrder: 0,
    githubIssueUrl: null,
    githubLabels: null,
    githubIssueNumber: null,
    sessionId: 'session-1',
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    projectName: 'Test Project',
  },
];

const mockProjects = [
  { id: 'proj-1', name: 'Test Project' },
  { id: 'proj-2', name: 'Other Project' },
];

beforeEach(async () => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
  const kanbanMod = await import('./KanbanBoard');
  KanbanBoard = kanbanMod.default;
});

/** Setup mock to return data */
function mockData(tasks = mockTasks, projects = mockProjects) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/api/tasks') return Promise.resolve(tasks);
    if (path === '/api/projects') return Promise.resolve(projects);
    return Promise.resolve([]);
  });
}

function renderBoard() {
  render(
    <MemoryRouter initialEntries={['/tasks']}>
      <KanbanBoard />
    </MemoryRouter>,
  );
}

/** Wait for data to load and board to appear */
async function waitForBoard() {
  await waitFor(
    () => {
      const backlogs = screen.getAllByText('Backlog');
      expect(backlogs.length).toBeGreaterThan(0);
    },
    { timeout: 5000 },
  );
}

describe('KanbanBoard', () => {
  it('shows empty state when no tasks', async () => {
    mockData([], mockProjects);
    renderBoard();

    await waitFor(
      () => {
        expect(screen.getByText('No tasks yet')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('renders task cards after loading', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    // Tasks appear in both mobile and desktop layout (jsdom doesn't hide via CSS classes)
    expect(screen.getAllByText('My Local Task').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GitHub Issue').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done Task').length).toBeGreaterThan(0);
  });

  it('shows task and issue badges', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    // GitHub issue badge shows #42
    const issueBadges = screen.getAllByText('#42');
    expect(issueBadges.length).toBeGreaterThan(0);
  });

  it('shows project name in badges', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    // Project name appears both in filter chip and card badges
    const badges = screen.getAllByText('Test Project');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows Open in GitHub link on issue cards', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    const links = screen.getAllByText('Open');
    expect(links.length).toBeGreaterThan(0);
  });

  it('shows session badge on task with sessionId', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    const badges = screen.getAllByText('live');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows column headers', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    // Column headers appear in both mobile tabs and desktop view
    expect(screen.getAllByText('Backlog').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
  });

  it('filters tasks by search query', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    const searchInput = screen.getByPlaceholderText('Search tasks…');
    await searchInput.focus();
    // Use user-like typing
    for (const char of 'zzz_nonexistent') {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeInputValueSetter?.call(searchInput, (searchInput as HTMLInputElement).value + char);
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // After filtering, should show no results
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (screen.queryByText('No tasks match your filters')) break;
    }

    expect(screen.getByText('No tasks match your filters')).toBeInTheDocument();
  });

  it('shows filter type toggle', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('shows error banner on fetch failure', async () => {
    mockApiFetch.mockImplementation(() => {
      return Promise.reject({ status: 500, message: 'Network error' });
    });
    renderBoard();

    await waitFor(
      () => {
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('opens create modal when New Task is clicked', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    // Click the first "New Task" button (desktop header)
    const newTaskBtns = screen.getAllByText('New Task');
    newTaskBtns[0].click();

    await waitFor(
      () => {
        expect(screen.getByLabelText('Title')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('filters to local tasks only when the Tasks segment is selected', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    await waitFor(() => {
      expect(screen.queryByText('GitHub Issue')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('My Local Task').length).toBeGreaterThan(0);
  });

  it('filters to GitHub issues only when the Issues segment is selected', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));

    await waitFor(() => {
      expect(screen.queryByText('My Local Task')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('GitHub Issue').length).toBeGreaterThan(0);
  });

  it('restores all tasks after clearing filters', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));
    await waitFor(() => {
      expect(screen.queryByText('My Local Task')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => {
      expect(screen.getAllByText('My Local Task').length).toBeGreaterThan(0);
    });
  });

  it('opens the create modal pre-targeted to a column via its add button', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByLabelText('Add task to Backlog'));

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toBeInTheDocument();
    });
  });

  it('opens the columns manager modal', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByText('Columns'));

    await waitFor(() => {
      expect(screen.getByText('Kanban Columns')).toBeInTheDocument();
    });
  });

  it('opens the labels manager modal', async () => {
    mockData();
    renderBoard();
    await waitForBoard();

    fireEvent.click(screen.getByText('Labels'));

    await waitFor(() => {
      expect(screen.getByText('Manage Labels')).toBeInTheDocument();
    });
  });

  // Task deletion was intentionally removed from the UI (the DELETE route
  // still exists server-side, but no card/modal surfaces it).
});
