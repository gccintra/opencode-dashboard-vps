import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './Dashboard';

// Mock useAuth
const mockLogout = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: mockLogout,
  }),
}));

// Mock useAgentList
vi.mock('../components/AgentPanel/useAgentList', () => ({
  useAgentList: () => ({
    agents: [],
    metrics: { total: 0, active: 0, waiting: 0, finished: 0, emergency: 0 },
    loading: false,
    error: null,
    refresh: vi.fn(),
    closeAgent: vi.fn(),
    renameAgent: vi.fn(),
  }),
}));

// Mock MetricsBar
vi.mock('../components/AgentPanel/MetricsBar', () => ({
  default: ({
    metrics,
    activeFilter,
    onFilterClick,
  }: {
    metrics: {
      total: number;
      active: number;
      waiting: number;
      finished: number;
      emergency: number;
    };
    activeFilter: string | null;
    onFilterClick: (status: string | null) => void;
  }) => (
    <div data-testid="metrics-bar">
      <button data-testid="metric-total" onClick={() => onFilterClick(null)}>
        Total {metrics.total}
      </button>
    </div>
  ),
}));

// Mock AgentPanel
vi.mock('../components/AgentPanel/AgentPanel', () => ({
  default: ({
    compact,
    showCreateTask,
    statusFilter,
    onStatusFilterChange,
  }: {
    compact?: boolean;
    showCreateTask?: boolean;
    statusFilter?: string | null;
    onStatusFilterChange?: (s: string | null) => void;
  }) => <div data-testid="agent-panel">AgentPanel (compact={String(compact)})</div>,
}));

// Mock KanbanBoard
vi.mock('../components/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board">KanbanBoard</div>,
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  it('renders the banner prompt', () => {
    renderDashboard();
    expect(screen.getByText('> _')).toBeInTheDocument();
  });

  it('renders a logout button with Portuguese label', () => {
    renderDashboard();
    const logoutButton = screen.getByRole('button', { name: 'Sair' });
    expect(logoutButton).toBeInTheDocument();
  });

  it('calls logout when logout button is clicked', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('renders the metrics bar', () => {
    renderDashboard();
    expect(screen.getByTestId('metrics-bar')).toBeInTheDocument();
  });

  it('renders the Kanban board on desktop', () => {
    renderDashboard();
    expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
  });

  it('renders the agent panel on desktop', () => {
    renderDashboard();
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
  });

  it('renders mobile bottom tabs', () => {
    // Mock innerWidth for mobile
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
    window.dispatchEvent(new Event('resize'));
    renderDashboard();

    // On mobile viewport, bottom tab nav should be visible
    expect(screen.getByTestId('mobile-tab-kanban')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-agents')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-projects')).toBeInTheDocument();
  });
});
