import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TaskFormData } from './TaskModal';

// ── API mocks ──
const fetchLabels = vi.fn();

vi.mock('../../lib/api', () => ({
  fetchLabels: (...a: unknown[]) => fetchLabels(...a),
}));

import { TaskModal } from './TaskModal';

const projects = [
  { id: 'proj-1', name: 'Project Alpha' },
  { id: 'proj-2', name: 'Project Beta' },
];

const baseInitial: TaskFormData = {
  title: '',
  description: '',
  projectId: 'proj-1',
  column: 'backlog',
  priority: 'medium',
  labelIds: [],
};

describe('TaskModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLabels.mockResolvedValue([]);
  });

  it('does not render when open=false', () => {
    render(
      <TaskModal
        open={false}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    expect(screen.queryByPlaceholderText('Task title')).not.toBeInTheDocument();
  });

  it('renders title input with placeholder when open=true', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument();
  });

  it('renders description textarea', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    expect(screen.getByPlaceholderText('Add description...')).toBeInTheDocument();
  });

  it('shows column pill defaulting to Backlog', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Backlog/i })).toBeInTheDocument();
  });

  it('shows Labels pill', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Labels/i })).toBeInTheDocument();
  });

  it('calls onSubmit with correct data when Create task is clicked', async () => {
    const onSubmit = vi.fn();
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        error={null}
        loading={false}
      />,
    );
    const titleInput = screen.getByPlaceholderText('Task title');
    fireEvent.change(titleInput, { target: { value: 'My new task' } });
    fireEvent.click(screen.getByRole('button', { name: /Create task/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My new task',
        column: 'backlog',
        labelIds: [],
      }),
    );
  });

  it('does not call onSubmit when title is empty', () => {
    const onSubmit = vi.fn();
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        error={null}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Create task/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });

  it('submits with Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        error={null}
        loading={false}
      />,
    );
    const titleInput = screen.getByPlaceholderText('Task title');
    fireEvent.change(titleInput, { target: { value: 'Keyboard submit' } });
    // Fire onKeyDown on the modal container
    fireEvent.keyDown(container.firstElementChild!.firstElementChild!, {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Keyboard submit' }),
    );
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={onClose}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows column picker when column pill is clicked', async () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    const columnBtn = screen.getByRole('button', { name: /Backlog/i });
    fireEvent.click(columnBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /In Progress/i })).toBeInTheDocument());
  });

  it('changes column selection when In Progress is picked', async () => {
    const onSubmit = vi.fn();
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        error={null}
        loading={false}
      />,
    );
    // Open column picker
    fireEvent.click(screen.getByRole('button', { name: /Backlog/i }));
    // Click In Progress
    const inProgressOption = await screen.findByRole('button', { name: 'In Progress' });
    fireEvent.click(inProgressOption);

    // Now submit
    const titleInput = screen.getByPlaceholderText('Task title');
    fireEvent.change(titleInput, { target: { value: 'Progress task' } });
    fireEvent.click(screen.getByRole('button', { name: /Create task/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'in_progress' }),
    );
  });

  it('shows error message when error prop is provided', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error="Something went wrong"
        loading={false}
      />,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows Creating… when loading=true', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={true}
      />,
    );
    expect(screen.getByRole('button', { name: /Creating…/i })).toBeInTheDocument();
  });

  it('includes project dropdown when multiple projects exist', () => {
    render(
      <TaskModal
        open={true}
        title="New Task"
        initial={baseInitial}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={null}
        loading={false}
      />,
    );
    // The project breadcrumb selector is a <select> with project names as options
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options.length).toBe(2);
  });
});
