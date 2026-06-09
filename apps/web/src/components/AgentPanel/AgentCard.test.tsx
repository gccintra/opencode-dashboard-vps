import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AgentCard, { type AgentCardProps } from './AgentCard';
import type { AgentInfo } from './useAgentList';

const baseAgent: AgentInfo = {
  id: 'session-1',
  name: 'Test Agent',
  projectId: 'proj-1',
  projectName: 'My Project',
  status: 'active',
  type: 'project',
  createdAt: Date.now() - 100_000,
  lastActiveAt: Date.now(),
  outputPreview: 'Last output line preview...',
};

function renderCard(props: Partial<AgentCardProps> = {}, agentOverrides: Partial<AgentInfo> = {}) {
  const agent = { ...baseAgent, ...agentOverrides };
  return render(
    <MemoryRouter>
      <AgentCard agent={agent} onClose={vi.fn()} onRename={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('AgentCard', () => {
  it('renders the agent name', () => {
    renderCard();
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
  });

  it('renders the project name', () => {
    renderCard();
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('renders the output preview', () => {
    renderCard();
    expect(screen.getByText('Last output line preview...')).toBeInTheDocument();
  });

  it('renders the status badge', () => {
    renderCard();
    expect(screen.getByTestId('status-badge')).toBeInTheDocument();
  });

  it('shows emergency badge for emergency sessions', () => {
    renderCard({}, { type: 'emergency', projectId: null, projectName: null });
    expect(screen.getByText('⚠️ Root')).toBeInTheDocument();
  });

  it('shows finished indicator', () => {
    renderCard({}, { status: 'finished' });
    expect(screen.getByText('ended')).toBeInTheDocument();
  });

  it('shows linked task if present', () => {
    renderCard(
      {},
      {
        linkedTaskId: 'task-1',
        linkedTaskTitle: 'Fix login bug',
      },
    );
    expect(screen.getByText(/Fix login bug/)).toBeInTheDocument();
  });

  it('triggers rename mode on pencil click', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText('Rename Test Agent'));
    expect(screen.getByTestId('rename-input-session-1')).toBeInTheDocument();
  });

  it('calls onRename when rename is submitted', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderCard({ onRename });
    await user.click(screen.getByLabelText('Rename Test Agent'));
    const input = screen.getByTestId('rename-input-session-1');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledWith('session-1', 'New Name');
  });

  it('shows close confirmation on X click', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText('Close Test Agent'));
    expect(screen.getByTestId('confirm-close-session-1')).toBeInTheDocument();
  });

  it('calls onClose when confirmation Yes is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderCard({ onClose });
    await user.click(screen.getByLabelText('Close Test Agent'));
    await user.click(screen.getByTestId('confirm-close-yes-session-1'));
    expect(onClose).toHaveBeenCalledWith('session-1');
  });

  it('cancels close on No click', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText('Close Test Agent'));
    await user.click(screen.getByTestId('confirm-close-no-session-1'));
    expect(screen.queryByTestId('confirm-close-session-1')).not.toBeInTheDocument();
  });

  it('shows create task button when enabled', () => {
    renderCard({ showCreateTask: true });
    expect(screen.getByTestId('create-task-session-1')).toBeInTheDocument();
  });

  it('hides create task button by default', () => {
    renderCard();
    expect(screen.queryByTestId('create-task-session-1')).not.toBeInTheDocument();
  });

  it('shows uptime', () => {
    renderCard();
    // Uptime should be around ~1m 40s for 100s
    const uptimeEl = screen.getByText(/s$/);
    expect(uptimeEl).toBeInTheDocument();
  });

  it('applies pulse animation for waiting status', () => {
    const { container } = renderCard({ pulse: true }, { status: 'waiting' });
    const card = container.querySelector('[data-testid="agent-card-session-1"]');
    expect(card?.className).toContain('animate-pulse');
  });

  it('renders as finished with reduced opacity', () => {
    const { container } = renderCard({}, { status: 'finished' });
    const card = container.querySelector('[data-testid="agent-card-session-1"]');
    expect(card?.className).toContain('opacity-50');
  });
});
