import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
    it('renders the ALF code logo mark', () => {
      renderSidebar();
      expect(screen.getByRole('img', { name: /ALF code/i })).toBeInTheDocument();
    });

    it('renders "ALF code" title', () => {
      renderSidebar();
      expect(screen.getByText('ALF')).toBeInTheDocument();
      expect(screen.getByText('code')).toBeInTheDocument();
    });

    it('renders the "Agent Dashboard" subtitle', () => {
      renderSidebar();
      expect(screen.getByText('Agent Dashboard')).toBeInTheDocument();
    });
  });

  // ── Navigation ──

  describe('Navigation', () => {
    it('renders the primary navigation links', () => {
      renderSidebar();
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Sessions')).toBeInTheDocument();
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('Files')).toBeInTheDocument();
      expect(screen.getByText('Templates')).toBeInTheDocument();
      // Canvas opens a picker modal — rendered as a button, not a link.
      expect(screen.getByText('Canvas')).toBeInTheDocument();
    });

    it('nav links point to correct routes', () => {
      renderSidebar();
      expect(screen.getByText('Projects').closest('a')).toHaveAttribute('href', '/projects');
      expect(screen.getByText('Sessions').closest('a')).toHaveAttribute('href', '/sessions');
      expect(screen.getByText('Tasks').closest('a')).toHaveAttribute('href', '/tasks');
      expect(screen.getByText('Files').closest('a')).toHaveAttribute('href', '/files');
      expect(screen.getByText('Templates').closest('a')).toHaveAttribute('href', '/templates');
      expect(screen.getByText('Canvas').closest('button')).toBeInTheDocument();
    });

    it('highlights Projects link as active when on /projects', () => {
      renderSidebar('/projects');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('bg-[rgba(179,229,2,0.12)]');
    });

    it('Projects link shows inactive styling when not on /projects', () => {
      renderSidebar('/tasks');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#9aa3ad]');
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

  // ── Session list (currently disabled in the sidebar) ──
  //
  // The per-project session list, create/rename/close affordances were moved
  // out of the sidebar (the markup is commented out in Sidebar.tsx). These
  // tests pin the current behaviour: that UI is not rendered.

  describe('Session list (disabled)', () => {
    it('does not render the per-project session list', () => {
      renderSidebar();
      expect(screen.queryByTestId('project-section-p1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-section-p2')).not.toBeInTheDocument();
      expect(screen.queryByText('My Project')).not.toBeInTheDocument();
    });

    it('does not render create-session buttons', () => {
      renderSidebar();
      expect(screen.queryByTestId('create-session-p1')).not.toBeInTheDocument();
    });
  });

  // ── Mobile drawer ──
  //
  // The hamburger button now lives in the page headers; the sidebar opens in
  // response to the `sidebar:open` window event and closes via its overlay.

  describe('Mobile drawer', () => {
    it('is hidden by default and opens on the sidebar:open event', () => {
      renderSidebar();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toHaveClass('-translate-x-full');

      act(() => {
        window.dispatchEvent(new Event('sidebar:open'));
      });
      expect(sidebar).toHaveClass('translate-x-0');
    });

    it('closes the drawer on overlay click', () => {
      renderSidebar();
      act(() => {
        window.dispatchEvent(new Event('sidebar:open'));
      });
      expect(screen.getByTestId('sidebar')).toHaveClass('translate-x-0');

      fireEvent.click(screen.getByTestId('sidebar-overlay'));
      expect(screen.getByTestId('sidebar')).toHaveClass('-translate-x-full');
    });
  });

  // ── Edge Cases ──

  describe('Edge Cases', () => {
    it('handles root path — Projects not active', () => {
      renderSidebar('/');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#9aa3ad]');
    });

    it('handles nested project route — Projects not active (end prop)', () => {
      renderSidebar('/projects/123');
      const projectsLink = screen.getByText('Projects').closest('a');
      expect(projectsLink).toHaveClass('text-[#9aa3ad]');
    });
  });
});
