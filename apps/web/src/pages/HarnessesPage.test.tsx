/**
 * HarnessesPage tests
 *
 * Tests for the harness management page: loading, empty, error states,
 * create/edit/delete interactions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockApiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  fetchHarnesses: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
  createHarness: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
  updateHarness: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
  deleteHarness: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
});

async function importPage() {
  const mod = await import('../pages/HarnessesPage');
  return mod.default;
}

describe('HarnessesPage', () => {
  it('shows loading state initially', async () => {
    // Never resolve the API call to keep loading state
    mockApiFetch.mockImplementation(() => new Promise(() => {}));

    const HarnessesPage = await importPage();
    const { container } = render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    // Should show skeleton cards (animate-pulse class elements)
    await waitFor(() => {
      expect(container.querySelector('.animate-pulse')).toBeTruthy();
    });
  });

  it('shows empty state when no harnesses exist', async () => {
    mockApiFetch.mockImplementation(async () => []);

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No templates yet')).toBeInTheDocument();
    });

    expect(screen.getByText('Create your first template')).toBeInTheDocument();
  });

  it('renders harness cards from API data', async () => {
    mockApiFetch.mockImplementation(async () => [
      { id: 't1', name: 'Template One', description: 'First template' },
      { id: 't2', name: 'Template Two', description: '' },
    ]);

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Template One')).toBeInTheDocument();
    });

    expect(screen.getByText('Template Two')).toBeInTheDocument();
    expect(screen.getByText('First template')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockApiFetch.mockImplementation(async () => {
      throw new Error('Network error');
    });

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });

    // Retry button should be present
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('opens create modal when clicking New Template button', async () => {
    mockApiFetch.mockImplementation(async () => []);

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No templates yet')).toBeInTheDocument();
    });

    const createBtn = screen.getByText('Create your first template');
    await userEvent.click(createBtn);

    // Modal should show — "New Template" text now appears in both the header button and modal title
    await waitFor(() => {
      const newTemplateElements = screen.getAllByText('New Template');
      expect(newTemplateElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows delete confirmation dialog', async () => {
    mockApiFetch.mockImplementation(async () => [
      { id: 't1', name: 'Delete Me', description: 'Will be deleted' },
    ]);

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Delete Me')).toBeInTheDocument();
    });

    // Find and click the Delete button
    const deleteBtn = screen.getByLabelText('Delete Delete Me');
    await userEvent.click(deleteBtn);

    // Dialog should show
    await waitFor(() => {
      expect(screen.getByText(/Delete Delete Me/)).toBeInTheDocument();
    });
  });

  it('opens edit modal when clicking gear icon', async () => {
    mockApiFetch.mockImplementation(async (url?: string) => {
      // Return harnesses list for the initial fetch
      if (url === undefined || url === '/api/harnesses') {
        return [
          { id: 't1', name: 'Edit Me', description: 'Editable' },
        ];
      }
      return { id: 't1', name: 'Edit Me', description: 'Editable' };
    });

    const HarnessesPage = await importPage();
    render(
      <MemoryRouter>
        <HarnessesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Edit Me')).toBeInTheDocument();
    });

    // Find and click the edit (gear) button
    const editBtn = screen.getByLabelText('Edit Edit Me');
    await userEvent.click(editBtn);

    // Modal should show "Edit Template" title
    await waitFor(() => {
      expect(screen.getByText('Edit Template')).toBeInTheDocument();
    });
  });
});
