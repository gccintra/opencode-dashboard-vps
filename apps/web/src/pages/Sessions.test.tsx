/**
 * Sessions page tests — validates project ID guard against 404s.
 *
 * Bug 01: The SessionsPage calls /api/projects/<id>/sessions for each
 * project without validating the id. The fix skips projects with
 * invalid ids and emits console.warn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockApiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

// react-router-dom needs the Navigate component to be available.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
  // Default: empty projects, so the page shows "No sessions yet".
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/projects') return [];
    return [];
  });
});

// Dynamic import so that mocks apply.
async function importSessionsPage() {
  const mod = await import('../pages/Sessions');
  return mod.default;
}

describe('SessionsPage — project id validation', () => {
  it('skips projects with null id and logs a warning', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/projects')
        return [
          { id: null, name: 'Broken' },
          { id: 'valid-id', name: 'Valid Project' },
        ];
      if (typeof url === 'string' && url.includes('valid-id/sessions'))
        return [
          {
            sessionId: 's1',
            projectId: 'valid-id',
            name: 'Sessão 1',
            status: 'active',
            createdAt: 1000,
          },
        ];
      return [];
    });

    const SessionsPage = await importSessionsPage();
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      '[SessionsPage] skipping project with invalid id:',
      expect.objectContaining({ id: null }),
    );
    // The valid project should appear in the list.
    expect(screen.getByText('Valid Project')).toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('skips project with id = "undefined" string', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/projects')
        return [
          { id: 'undefined', name: 'Buggy Project' },
          { id: 'real', name: 'Real Project' },
        ];
      if (typeof url === 'string' && url.includes('real/sessions'))
        return [
          { sessionId: 's1', projectId: 'real', name: 'Sessão', status: 'waiting', createdAt: 500 },
        ];
      return [];
    });

    const SessionsPage = await importSessionsPage();
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Real Project')).toBeInTheDocument();
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      '[SessionsPage] skipping project with invalid id:',
      expect.objectContaining({ id: 'undefined' }),
    );
    consoleWarn.mockRestore();
  });

  it('shows empty state when all project ids are invalid', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/projects') return [{ id: 'null' as unknown as string, name: 'Bad' }];
      return [];
    });

    const SessionsPage = await importSessionsPage();
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    });
  });

  it('shows all sessions when all ids are valid', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/projects') return [{ id: 'p1', name: 'Project One' }];
      if (typeof url === 'string' && url.includes('p1/sessions'))
        return [
          { sessionId: 's1', projectId: 'p1', name: 'Sessão 1', status: 'active', createdAt: 2000 },
          {
            sessionId: 's2',
            projectId: 'p1',
            name: 'Sessão 2',
            status: 'waiting',
            createdAt: 1000,
          },
        ];
      return [];
    });

    const SessionsPage = await importSessionsPage();
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Project One')).toBeInTheDocument();
    });

    expect(screen.getByText('Sessão 1')).toBeInTheDocument();
    expect(screen.getByText('Sessão 2')).toBeInTheDocument();
  });
});
