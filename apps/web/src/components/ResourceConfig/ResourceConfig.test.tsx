import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResourceConfig from './ResourceConfig';

/* ── Mocks ── */

const mockApiFetch = vi.fn();
vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

/* ── Helpers ── */

interface MockResource {
  resourceId: string;
  name: string;
  description: string;
  type: 'skill' | 'agent' | 'mcp';
  active: boolean;
  available: boolean;
}

function mockResourcesResponse(resources: MockResource[]) {
  mockApiFetch.mockResolvedValueOnce({ resources });
}

function mockToggleResponse(active: boolean) {
  mockApiFetch.mockResolvedValueOnce({ resourceId: 'skill:my-skill', active });
}

function mockDeleteUnavailableResponse(removed = 1) {
  mockApiFetch.mockResolvedValueOnce({ removed });
}

function mockApiError(message = 'Network error') {
  mockApiFetch.mockRejectedValueOnce({ status: 500, message });
}

function renderComponent(projectId = 'test-project') {
  return render(<ResourceConfig projectId={projectId} />);
}

const DEFAULT_RESOURCES: MockResource[] = [
  {
    resourceId: 'skill:my-skill',
    name: 'my-skill',
    description: 'A custom skill',
    type: 'skill',
    active: false,
    available: true,
  },
  {
    resourceId: 'skill:other-skill',
    name: 'other-skill',
    description: 'Another skill',
    type: 'skill',
    active: true,
    available: true,
  },
  {
    resourceId: 'agent:my-agent',
    name: 'my-agent',
    description: 'Handles tasks',
    type: 'agent',
    active: false,
    available: true,
  },
  {
    resourceId: 'mcp:test-mcp',
    name: 'test-mcp',
    description: 'A test MCP',
    type: 'mcp',
    active: true,
    available: true,
  },
];

/* ── Setup ── */

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
});

/* ── Tests ── */

describe('ResourceConfig', () => {
  describe('loading state', () => {
    it('shows skeleton while fetching', () => {
      mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
      renderComponent();
      expect(screen.getByTestId('resource-config-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message and retry button', async () => {
      mockApiError('Failed to load');
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-config-error')).toBeInTheDocument();
      });
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
      expect(screen.getByTestId('resource-retry-button')).toBeInTheDocument();
    });

    it('retries on button click', async () => {
      mockApiError('Oops');
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-retry-button')).toBeInTheDocument();
      });

      mockResourcesResponse(DEFAULT_RESOURCES);
      await userEvent.click(screen.getByTestId('resource-retry-button'));

      await waitFor(() => {
        expect(screen.getByTestId('resource-config')).toBeInTheDocument();
      });
    });
  });

  describe('data state', () => {
    it('renders sub-tabs with counts', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-tab-skill')).toBeInTheDocument();
      });
      expect(screen.getByTestId('resource-tab-skill')).toHaveTextContent('Skills (1 of 2 active)');
      expect(screen.getByTestId('resource-tab-agent')).toHaveTextContent('Agents (0 of 1 active)');
      expect(screen.getByTestId('resource-tab-mcp')).toHaveTextContent('MCPs (1 of 1 active)');
    });

    it('shows skills tab by default', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-tab-skill')).toHaveAttribute('aria-selected', 'true');
      });
      // Skills should be visible
      expect(screen.getByText('my-skill')).toBeInTheDocument();
      expect(screen.getByText('other-skill')).toBeInTheDocument();
    });

    it('switches to agents tab on click', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-tab-agent')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('resource-tab-agent'));
      expect(screen.getByTestId('resource-tab-agent')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('my-agent')).toBeInTheDocument();
    });

    it('switches to mcps tab on click', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-tab-mcp')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('resource-tab-mcp'));
      expect(screen.getByTestId('resource-tab-mcp')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('test-mcp')).toBeInTheDocument();
    });

    it('toggles a resource on', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-toggle-skill:my-skill')).toBeInTheDocument();
      });

      // my-skill starts inactive
      const toggle = screen.getByTestId('resource-toggle-skill:my-skill');
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      // Mock the toggle response
      mockToggleResponse(true);

      await userEvent.click(toggle);

      // The toggle should now be checked (optimistic)
      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('toggles a resource off', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-toggle-skill:other-skill')).toBeInTheDocument();
      });

      // other-skill starts active
      const toggle = screen.getByTestId('resource-toggle-skill:other-skill');
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      mockToggleResponse(false);
      await userEvent.click(toggle);

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'false');
      });
    });

    it('reverts toggle on API error', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-toggle-skill:my-skill')).toBeInTheDocument();
      });

      const toggle = screen.getByTestId('resource-toggle-skill:my-skill');
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      // Mock an API error
      mockApiFetch.mockRejectedValueOnce({ status: 500, message: 'Server error' });

      await userEvent.click(toggle);

      // It should revert back to false
      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'false');
      });
    });

    it('filters resources by search', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-search')).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId('resource-search');
      await userEvent.type(searchInput, 'other');

      // Only other-skill should be visible
      await waitFor(() => {
        expect(screen.getByText('other-skill')).toBeInTheDocument();
        expect(screen.queryByText('my-skill')).not.toBeInTheDocument();
      });
    });

    it('shows empty message when no resources match search', async () => {
      mockResourcesResponse(DEFAULT_RESOURCES);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-search')).toBeInTheDocument();
      });

      await userEvent.type(screen.getByTestId('resource-search'), 'nonexistent');

      await waitFor(() => {
        expect(screen.getByTestId('resource-no-results')).toBeInTheDocument();
      });
    });

    it('disables toggle for unavailable resources', async () => {
      const withUnavailable = [
        ...DEFAULT_RESOURCES,
        {
          resourceId: 'skill:deleted',
          name: 'deleted',
          description: 'Gone',
          type: 'skill' as const,
          active: true,
          available: false,
        },
      ];
      mockResourcesResponse(withUnavailable);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-toggle-skill:deleted')).toBeInTheDocument();
      });

      const toggle = screen.getByTestId('resource-toggle-skill:deleted');
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByTestId('resource-unavailable-icon')).toBeInTheDocument();
    });

    it('shows cleanup button when unavailable resources exist', async () => {
      const withUnavailable = [
        ...DEFAULT_RESOURCES,
        {
          resourceId: 'skill:deleted',
          name: 'deleted',
          description: 'Gone',
          type: 'skill' as const,
          active: true,
          available: false,
        },
      ];
      mockResourcesResponse(withUnavailable);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('cleanup-unavailable-button')).toBeInTheDocument();
      });
      expect(screen.getByTestId('cleanup-unavailable-button')).toHaveTextContent(
        'Limpar indisponíveis',
      );
    });

    it('cleans up unavailable resources on button click', async () => {
      const withUnavailable = [
        ...DEFAULT_RESOURCES,
        {
          resourceId: 'skill:deleted',
          name: 'deleted',
          description: 'Gone',
          type: 'skill' as const,
          active: true,
          available: false,
        },
      ];
      mockResourcesResponse(withUnavailable);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('cleanup-unavailable-button')).toBeInTheDocument();
      });

      // Mock delete + refresh
      mockDeleteUnavailableResponse(1);
      mockResourcesResponse(DEFAULT_RESOURCES);

      await userEvent.click(screen.getByTestId('cleanup-unavailable-button'));

      // After cleanup, the unavailable resource should be gone
      await waitFor(() => {
        expect(screen.queryByTestId('resource-row-skill:deleted')).not.toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message for a tab with no resources', async () => {
      // Only skills
      const skillsOnly = [
        {
          resourceId: 'skill:my-skill',
          name: 'my-skill',
          description: 'A skill',
          type: 'skill' as const,
          active: false,
          available: true,
        },
      ];
      mockResourcesResponse(skillsOnly);
      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('resource-tab-agent')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('resource-tab-agent'));

      await waitFor(() => {
        expect(screen.getByTestId('resource-empty')).toBeInTheDocument();
      });
      expect(screen.getByTestId('resource-empty')).toHaveTextContent(/no agents found/i);
    });
  });
});
