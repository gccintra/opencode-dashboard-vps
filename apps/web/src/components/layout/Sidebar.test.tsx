import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

// ── Mock useSessions ──

const mockUseSessions = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => mockUseSessions(),
}));

// ── Default mock return values ──

const defaultUseSessions = {
  groups: [
    {
      project: { id: 'p1', name: 'My Project', directory: '/tmp/myproj' },
      sessions: [
        { sessionId: 's1', projectId: 'p1', name: 'Sessão 1', status: 'active', createdAt: 1000 },
        { sessionId: 's2', projectId: 'p1', name: 'Sessão 2', status: 'exited', createdAt: 2000 },
      ],
    },
    {
      project: { id: 'p2', name: 'Other Project', directory: '/tmp/other' },
      sessions: [],
    },
  ],
  loading: false,
  error: null,
  refresh: vi.fn(),
  renameSession: vi.fn().mockResolvedValue({}),
  closeSession: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({
    sessionId: 'new',
    projectId: 'p1',
    name: 'Sessão 3',
    status: 'active',
    createdAt: 3000,
  }),
};

function renderSidebar(
  initialRoute = '/projects',
  mockOverrides: Partial<typeof defaultUseSessions> = {},
) {
  mockUseSessions.mockReturnValue({ ...defaultUseSessions, ...mockOverrides });
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessions.mockReturnValue(defaultUseSessions);
  });

  // ── Banner ──

  describe('Banner', () => {
    it('renders the logo "> _" with correct styling', () => {
      renderSidebar();
      const logo = screen.getByText('> _');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveClass('text-[#af0]');
    });

    it('renders "OpenCode" title', () => {
      renderSidebar();
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
    });

    it('renders "Dashboard" subtitle in uppercase', () => {
      renderSidebar();
      // There are two "Dashboard" text elements: the banner subtitle and the nav link.
      const dashboardEls = screen.getAllByText('Dashboard');
      expect(dashboardEls.length).toBe(2);
    });
  });

  // ── Navigation ──

  describe('Navigation', () => {
    it('renders all four navigation links', () => {
      renderSidebar();
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Sessions')).toBeInTheDocument();
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('nav links point to correct routes', () => {
      renderSidebar();
      expect(screen.getByText('Projects').closest('a')).toHaveAttribute('href', '/projects');
      expect(screen.getByText('Sessions').closest('a')).toHaveAttribute('href', '/sessions');
      expect(screen.getByText('Tasks').closest('a')).toHaveAttribute('href', '/tasks');
      expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
    });

    it('highlights Projects link as active when on /projects', () => {
      renderSidebar('/projects');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('bg-[rgba(170,255,0,0.12)]');
    });

    it('Projects link shows inactive styling when not on /projects', () => {
      renderSidebar('/tasks');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#889]');
    });
  });

  // ── Sessions badge ──

  describe('Sessions badge', () => {
    it('shows count of active sessions', () => {
      renderSidebar();
      // active sessions: s1 (active) + s2 (exited) = 1 active
      const badge = screen.getByText('1');
      expect(badge).toBeInTheDocument();
    });

    it('hides badge when no active sessions', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp/p1' },
            sessions: [
              { sessionId: 's1', projectId: 'p1', name: 'Dead', status: 'exited', createdAt: 1000 },
            ],
          },
        ],
      });
      // Badge should not be rendered when totalActive is 0
      const badges = screen.queryAllByText(/^\d+$/);
      // The badge only renders when totalActive > 0
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });
  });

  // ── User Profile ──

  describe('User Profile', () => {
    it('renders username "user@vps"', () => {
      renderSidebar();
      expect(screen.getByText('user@vps')).toBeInTheDocument();
    });

    it('renders avatar with "U"', () => {
      renderSidebar();
      expect(screen.getByText('U')).toBeInTheDocument();
    });
  });

  // ── System Status ──

  describe('System Status', () => {
    it('renders "daemon online" text', () => {
      renderSidebar();
      expect(screen.getByText('daemon online')).toBeInTheDocument();
    });
  });

  // ── Dynamic session list ──

  describe('Dynamic session list', () => {
    it('shows project names in the session list', () => {
      renderSidebar();
      expect(screen.getByText('My Project')).toBeInTheDocument();
      expect(screen.getByText('Other Project')).toBeInTheDocument();
    });

    it('shows "No sessions" for projects with no sessions', () => {
      renderSidebar();
      // Click to expand Other Project (p2)
      fireEvent.click(screen.getByTestId('project-section-p2'));
      expect(screen.getByText('No sessions')).toBeInTheDocument();
    });

    it('shows session names when project is expanded', () => {
      renderSidebar();
      // My Project (p1) sessions should be visible (no toggle needed if default open)
      fireEvent.click(screen.getByTestId('project-section-p1'));
      expect(screen.getByText('Sessão 1')).toBeInTheDocument();
      expect(screen.getByText('Sessão 2')).toBeInTheDocument();
    });

    it('shows loading state', () => {
      renderSidebar('/projects', { loading: true, groups: [] });
      expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
    });

    it('shows empty state when no projects', () => {
      renderSidebar('/projects', { groups: [] });
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });
  });

  // ── Create session button ──

  describe('Create session', () => {
    it('renders + button next to each project', () => {
      renderSidebar();
      expect(screen.getByTestId('create-session-p1')).toBeInTheDocument();
      expect(screen.getByTestId('create-session-p2')).toBeInTheDocument();
    });

    it('calls createSession on click', () => {
      renderSidebar();
      fireEvent.click(screen.getByTestId('create-session-p1'));
      expect(defaultUseSessions.createSession).toHaveBeenCalledWith('p1');
    });
  });

  // ── Inline rename ──

  describe('Inline rename', () => {
    it('shows input on double-click of session name', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      const nameEl = screen.getByTestId('session-name-s1');
      fireEvent.doubleClick(nameEl);

      const input = screen.getByTestId('rename-input-s1');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('Sessão 1');
    });

    it('submits rename on Enter', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      fireEvent.doubleClick(screen.getByTestId('session-name-s1'));
      const input = screen.getByTestId('rename-input-s1');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(defaultUseSessions.renameSession).toHaveBeenCalledWith('s1', 'Renamed');
    });

    it('cancels rename on Escape', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      fireEvent.doubleClick(screen.getByTestId('session-name-s1'));
      const input = screen.getByTestId('rename-input-s1');
      fireEvent.keyDown(input, { key: 'Escape' });

      // After Escape, the input should be gone and name shown again
      expect(screen.queryByTestId('rename-input-s1')).not.toBeInTheDocument();
      expect(screen.getByTestId('session-name-s1')).toBeInTheDocument();
    });
  });

  // ── Close session ──

  describe('Close session', () => {
    it('shows confirmation on close button click', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      fireEvent.click(screen.getByTestId('close-session-s1'));
      expect(screen.getByTestId('confirm-close-s1')).toBeInTheDocument();
    });

    it('closes session on confirm', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      fireEvent.click(screen.getByTestId('close-session-s1'));
      fireEvent.click(screen.getByTestId('confirm-close-yes-s1'));
      expect(defaultUseSessions.closeSession).toHaveBeenCalledWith('s1');
    });

    it('cancels close on No', () => {
      renderSidebar('/projects', {
        groups: [
          {
            project: { id: 'p1', name: 'P1', directory: '/tmp' },
            sessions: [
              {
                sessionId: 's1',
                projectId: 'p1',
                name: 'Sessão 1',
                status: 'active',
                createdAt: 1000,
              },
            ],
          },
        ],
      });
      fireEvent.click(screen.getByTestId('project-section-p1'));

      fireEvent.click(screen.getByTestId('close-session-s1'));
      fireEvent.click(screen.getByTestId('confirm-close-no-s1'));
      expect(defaultUseSessions.closeSession).not.toHaveBeenCalled();
    });
  });

  // ── Mobile drawer ──

  describe('Mobile drawer', () => {
    it('renders hamburger button', () => {
      renderSidebar();
      expect(screen.getByTestId('hamburger-button')).toBeInTheDocument();
    });

    it('toggles sidebar on hamburger click', () => {
      renderSidebar();
      const hamburger = screen.getByTestId('hamburger-button');

      // Sidebar should start hidden on mobile (test env < lg)
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toHaveClass('-translate-x-full');

      // Click to open
      fireEvent.click(hamburger);
      expect(sidebar).toHaveClass('translate-x-0');

      // Click to close
      fireEvent.click(hamburger);
      expect(sidebar).toHaveClass('-translate-x-full');
    });

    it('closes mobile drawer on overlay click', () => {
      renderSidebar();
      const hamburger = screen.getByTestId('hamburger-button');

      // Open the sidebar
      fireEvent.click(hamburger);
      expect(screen.getByTestId('sidebar')).toHaveClass('translate-x-0');

      // Click overlay
      const overlay = screen.getByTestId('sidebar-overlay');
      fireEvent.click(overlay);
      expect(screen.getByTestId('sidebar')).toHaveClass('-translate-x-full');
    });
  });

  // ── Edge Cases ──

  describe('Edge Cases', () => {
    it('handles root path — Projects not active', () => {
      renderSidebar('/');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#889]');
    });

    it('handles nested project route — Projects not active (end prop)', () => {
      renderSidebar('/projects/123');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#889]');
    });
  });
});
