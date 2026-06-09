import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProjectsPage from './Projects';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockProjects: Array<{
  id: string;
  name: string;
  directory: string;
  description: string | null;
  harnessId: string | null;
  githubRepo: string | null;
  createdAt: string;
  updatedAt: string;
}> = [
  {
    id: 'p1',
    name: 'api-service',
    directory: '/home/user/projects/api-service',
    description: 'Backend API',
    harnessId: null,
    githubRepo: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-03T14:00:00.000Z',
  },
  {
    id: 'p2',
    name: 'frontend-app',
    directory: '/home/user/projects/frontend-app',
    description: 'React frontend',
    harnessId: null,
    githubRepo: null,
    createdAt: '2026-05-28T08:00:00.000Z',
    updatedAt: '2026-06-04T09:00:00.000Z',
  },
  {
    id: 'p3',
    name: 'data-pipeline',
    directory: '/home/user/projects/data-pipeline',
    description: null,
    harnessId: null,
    githubRepo: null,
    createdAt: '2026-06-04T12:00:00.000Z',
    updatedAt: '2026-06-04T15:30:00.000Z',
  },
];

function mockProjectsResponse(projects = mockProjects) {
  // queue projects response (1st API call in fetchProjects)
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => projects,
  });
  // queue stats response (2nd API call in fetchProjects)
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
}

function mockHarnessesResponse(
  harnesses: Array<{ id: string; name: string; description: string }> = [],
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => harnesses,
  });
}

function mockProjectsError(status = 500, message = 'Server error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: message }),
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Need mockReset() because clearAllMocks() doesn't clear mockResolvedValueOnce queue
  mockFetch.mockReset();
});

describe('ProjectsPage', () => {
  describe('loading state', () => {
    it('shows skeleton cards while loading', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {})); // never resolves
      renderPage();

      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('empty state', () => {
    it('shows empty message when no projects exist', async () => {
      mockProjectsResponse([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('No projects yet')).toBeInTheDocument();
      });
      expect(screen.getByText('Create your first project')).toBeInTheDocument();
    });

    it('clicking empty state CTA opens create modal', async () => {
      mockProjectsResponse([]);
      mockHarnessesResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Create your first project')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Create your first project'));

      expect(screen.getByRole('heading', { name: 'New Project' })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when API fails', async () => {
      mockProjectsError();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });

    it('shows retry button in error state', async () => {
      mockProjectsError();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('retry button refetches projects', async () => {
      mockProjectsError();
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });
    });
  });

  describe('project cards', () => {
    it('renders project name and directory for each project', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });
      expect(screen.getByText('frontend-app')).toBeInTheDocument();
      expect(screen.getByText('data-pipeline')).toBeInTheDocument();
      expect(screen.getByText('/home/user/projects/api-service')).toBeInTheDocument();
    });

    it('renders session status labels on each card', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        const activeLabels = screen.getAllByText('Active');
        expect(activeLabels.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('has gear/edit buttons on each card', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByLabelText('Edit api-service')).toBeInTheDocument();
      });
    });
  });

  describe('search', () => {
    it('filters projects by name', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search projects…');
      await userEvent.type(searchInput, 'api');

      await waitFor(() => {
        expect(screen.queryByText('frontend-app')).not.toBeInTheDocument();
        expect(screen.queryByText('data-pipeline')).not.toBeInTheDocument();
      });
      expect(screen.getByText('api-service')).toBeInTheDocument();
    });

    it('search is case-insensitive', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search projects…');
      await userEvent.type(searchInput, 'API');

      expect(screen.getByText('api-service')).toBeInTheDocument();
      expect(screen.queryByText('frontend-app')).not.toBeInTheDocument();
    });

    it('shows no results message when search has no matches', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => expect(screen.getByText('api-service')).toBeInTheDocument());

      const searchInput = screen.getByPlaceholderText('Search projects…');
      await userEvent.type(searchInput, 'zzzzz');

      await waitFor(() => {
        expect(screen.getByText(/No projects match/)).toBeInTheDocument();
      });
    });

    it('clear search link resets the filter', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => expect(screen.getByText('api-service')).toBeInTheDocument());

      const searchInput = screen.getByPlaceholderText('Search projects…');
      await userEvent.type(searchInput, 'zzzzz');

      await waitFor(() => {
        expect(screen.getByText('Clear search')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Clear search'));

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
        expect(screen.getByText('frontend-app')).toBeInTheDocument();
      });
    });
  });

  describe('sort', () => {
    it('shows sort toggle button', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Newest')).toBeInTheDocument();
      });
    });

    it('toggles between newest and alphabetical', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Newest')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Newest'));

      await waitFor(() => {
        expect(screen.getByText('A–Z')).toBeInTheDocument();
      });
    });
  });

  describe('create project', () => {
    it('opens create modal when New Project button is clicked', async () => {
      mockProjectsResponse();
      mockHarnessesResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Click the New Project button in the header
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      expect(screen.getByRole('heading', { name: 'New Project' })).toBeInTheDocument();
    });

    it('validates required fields on submit', async () => {
      mockProjectsResponse();
      mockHarnessesResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
        expect(screen.getByText('Directory is required')).toBeInTheDocument();
      });
    });

    it('submits create form and refreshes list', async () => {
      mockProjectsResponse(); // initial load
      mockHarnessesResponse(); // harnesses load
      // Create response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'p4', name: 'new-proj', directory: '/tmp/test' }),
      });
      // Refreshed list
      mockProjectsResponse([
        ...mockProjects,
        {
          id: 'p4',
          name: 'new-proj',
          directory: '/tmp/test',
          description: null,
          harnessId: null,
          githubRepo: null,
          createdAt: '2026-06-04T16:00:00.000Z',
          updatedAt: '2026-06-04T16:00:00.000Z',
        },
      ]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));
      await userEvent.type(screen.getByLabelText('Name'), 'new-proj');
      await userEvent.type(screen.getByLabelText('Directory'), '/tmp/test');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('new-proj')).toBeInTheDocument();
      });
    });

    it('shows server error on create failure', async () => {
      mockProjectsResponse(); // initial load
      mockHarnessesResponse(); // harnesses load
      // Create fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Project with this name already exists' }),
      });
      // DirectoryPicker autocomplete (debounced, fires after create completes)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ directories: [] }),
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));
      await userEvent.type(screen.getByLabelText('Name'), 'api-service');
      await userEvent.type(screen.getByLabelText('Directory'), '/tmp/test');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Project with this name already exists')).toBeInTheDocument();
      });
    });

    it('closes modal on cancel', async () => {
      mockProjectsResponse();
      mockHarnessesResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      });
    });
  });

  describe('edit project', () => {
    it('opens edit modal with pre-filled values when gear icon is clicked', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Edit api-service'));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Project' })).toBeInTheDocument();
        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        expect(nameInput.value).toBe('api-service');
      });
    });

    it('submits edit form and refreshes list', async () => {
      mockProjectsResponse(); // initial load
      // Edit response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...mockProjects[0], name: 'api-service-v2' }),
      });
      // Refreshed list
      mockProjectsResponse([
        { ...mockProjects[0], name: 'api-service-v2' },
        mockProjects[1],
        mockProjects[2],
      ]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Edit api-service'));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Project' })).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText('Name');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'api-service-v2');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('api-service-v2')).toBeInTheDocument();
      });
    });
  });

  describe('delete project', () => {
    it('shows delete confirmation dialog', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete api-service'));

      await waitFor(() => {
        expect(screen.getByText(/Delete api-service/)).toBeInTheDocument();
        expect(screen.getByText(/Active sessions will be terminated/)).toBeInTheDocument();
      });
    });

    it('cancel closes delete dialog without deleting', async () => {
      mockProjectsResponse();
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete api-service'));

      await waitFor(() => {
        expect(screen.getByText(/Active sessions will be terminated/)).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByText(/Active sessions will be terminated/)).not.toBeInTheDocument();
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });
    });

    it('confirm deletes project and refreshes list', async () => {
      mockProjectsResponse(); // initial load
      // Delete response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      // Refreshed list without api-service
      mockProjectsResponse([mockProjects[1], mockProjects[2]]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete api-service'));

      await waitFor(() => {
        expect(screen.getByText(/Active sessions will be terminated/)).toBeInTheDocument();
      });

      // Click the Delete confirm button in the modal (the red one)
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
      // The modal delete button is the last one
      await userEvent.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText('api-service')).not.toBeInTheDocument();
      });
    });
  });

  describe('harness selector', () => {
    const mockHarnesses = [
      { id: 'react-starter', name: 'React Starter', description: 'React + Vite template' },
      { id: 'node-cli', name: 'Node CLI', description: 'CLI tool template' },
    ];

    it('fetches harnesses when create modal opens', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHarnesses,
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      // Verify harnesses API was called
      await waitFor(() => {
        const calls = mockFetch.mock.calls;
        const harnessCall = calls.find((call: string[]) => call[0].includes('/api/harnesses'));
        expect(harnessCall).toBeDefined();
      });
    });

    it('shows harness options in create modal', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHarnesses,
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      // Wait for harnesses to load
      await waitFor(() => {
        expect(screen.getByText('React Starter — React + Vite template')).toBeInTheDocument();
      });

      // Verify all harnesses are listed
      expect(screen.getByText('Node CLI — CLI tool template')).toBeInTheDocument();

      // Verify default "None" option
      expect(screen.getByText('None — empty project')).toBeInTheDocument();
    });

    it('shows loading state for harnesses', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load - never resolves
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      await waitFor(() => {
        expect(screen.getByText('Loading templates…')).toBeInTheDocument();
      });
    });

    it('submits create form with harnessId selected', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHarnesses,
      });
      // Create response with harness
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'p4',
          name: 'new-proj',
          directory: '/tmp/test',
          harnessId: 'react-starter',
        }),
      });
      // Refreshed list
      mockProjectsResponse([
        ...mockProjects,
        {
          id: 'p4',
          name: 'new-proj',
          directory: '/tmp/test',
          description: null,
          harnessId: 'react-starter',
          githubRepo: null,
          createdAt: '2026-06-04T16:00:00.000Z',
          updatedAt: '2026-06-04T16:00:00.000Z',
        },
      ]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      // Wait for harnesses to load
      await waitFor(() => {
        expect(screen.getByText('React Starter — React + Vite template')).toBeInTheDocument();
      });

      // Fill form
      await userEvent.type(screen.getByLabelText('Name'), 'new-proj');
      await userEvent.type(screen.getByLabelText('Directory'), '/tmp/test');

      // Select harness
      const select = screen.getByLabelText('Template (optional)') as HTMLSelectElement;
      await userEvent.selectOptions(select, 'react-starter');

      // Submit
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('new-proj')).toBeInTheDocument();
      });
    });

    it('submits without harnessId when None is selected', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHarnesses,
      });
      // Create response without harness
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'p4', name: 'no-harness-proj', directory: '/tmp/test' }),
      });
      // Refreshed list
      mockProjectsResponse([
        ...mockProjects,
        {
          id: 'p4',
          name: 'no-harness-proj',
          directory: '/tmp/test',
          description: null,
          harnessId: null,
          githubRepo: null,
          createdAt: '2026-06-04T16:00:00.000Z',
          updatedAt: '2026-06-04T16:00:00.000Z',
        },
      ]);
      // DirectoryPicker autocomplete (debounced, fires after create completes)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ directories: [] }),
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      // Wait for harnesses to load
      await waitFor(() => {
        expect(screen.getByText('React Starter — React + Vite template')).toBeInTheDocument();
      });

      // Fill form
      await userEvent.type(screen.getByLabelText('Name'), 'no-harness-proj');
      await userEvent.type(screen.getByLabelText('Directory'), '/tmp/test');

      // Submit without selecting harness (default None)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('no-harness-proj')).toBeInTheDocument();
      });
    });

    it('shows error when harness copy fails and project is NOT created', async () => {
      // Initial projects load
      mockProjectsResponse();
      // Harnesses load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHarnesses,
      });
      // Create fails with harness error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Directory not empty. Set overwrite=true to proceed.' }),
      });
      // DirectoryPicker autocomplete (debounced, fires after create completes)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ directories: [] }),
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });

      // Open create modal
      await userEvent.click(screen.getByRole('button', { name: /New Project/i }));

      // Wait for harnesses to load
      await waitFor(() => {
        expect(screen.getByText('React Starter — React + Vite template')).toBeInTheDocument();
      });

      // Fill form
      await userEvent.type(screen.getByLabelText('Name'), 'fail-proj');
      await userEvent.type(screen.getByLabelText('Directory'), '/tmp/test');

      // Select harness
      const select = screen.getByLabelText('Template (optional)') as HTMLSelectElement;
      await userEvent.selectOptions(select, 'react-starter');

      // Submit
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      // Error should be shown in the modal
      await waitFor(() => {
        expect(
          screen.getByText('Directory not empty. Set overwrite=true to proceed.'),
        ).toBeInTheDocument();
      });

      // Modal should still be open (Save button visible)
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
  });
});
