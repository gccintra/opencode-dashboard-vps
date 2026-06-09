/**
 * useSessions hook tests — validation of project id before API calls.
 *
 * Bug 01: Projects with falsy, non-string, or literal "undefined" ids
 * were causing 404 requests to `/api/projects/undefined/sessions`.
 * The fix skips such projects with a console.warn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessions, type SessionItem } from './useSessions';

const mockApiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) =>
    (mockApiFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockReset();
});

/** Successful projects response. */
function mockProjectsResponse(projects: unknown[]) {
  mockApiFetch.mockImplementationOnce(async (url: string) => {
    if (url === '/api/projects') {
      return projects;
    }
    if (typeof url === 'string' && url.includes('/sessions')) {
      return [] as SessionItem[];
    }
    return [];
  });
}

describe('useSessions', () => {
  describe('project id validation', () => {
    it('skips projects with null id and logs a warning', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const projects: Array<{ id: unknown; name: string; directory: string }> = [
        { id: null, name: 'Broken', directory: '/tmp' },
        { id: 'valid', name: 'Valid', directory: '/tmp/valid' },
      ];
      mockProjectsResponse(projects);

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(consoleWarn).toHaveBeenCalledWith(
        '[useSessions] skipping project with invalid id:',
        expect.objectContaining({ id: null }),
      );
      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0].project.id).toBe('valid');
      consoleWarn.mockRestore();
    });

    it('skips projects with undefined id', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockProjectsResponse([
        { id: undefined, name: 'Ghost', directory: '/tmp' },
        { id: 'real', name: 'Real', directory: '/tmp/real' },
      ]);

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0].project.id).toBe('real');
      consoleWarn.mockRestore();
    });

    it('skips projects with id = "undefined" (literal string)', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockProjectsResponse([
        { id: 'undefined', name: 'Buggy', directory: '/tmp' },
        { id: 'ok', name: 'Ok', directory: '/tmp/ok' },
      ]);

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0].project.id).toBe('ok');
      consoleWarn.mockRestore();
    });

    it('skips projects with empty string id', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockProjectsResponse([
        { id: '', name: 'NoId', directory: '/tmp' },
        { id: 'fine', name: 'Fine', directory: '/tmp/fine' },
      ]);

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0].project.id).toBe('fine');
      consoleWarn.mockRestore();
    });

    it('returns empty groups when all projects have invalid ids', async () => {
      mockProjectsResponse([
        { id: null, name: 'A', directory: '/a' },
        { id: undefined, name: 'B', directory: '/b' },
        { id: 'undefined', name: 'C', directory: '/c' },
      ]);

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(0);
      expect(result.current.error).toBeNull();
    });

    it('fetches sessions for projects with valid ids only', async () => {
      mockProjectsResponse([
        { id: 'p1', name: 'Project 1', directory: '/tmp/p1' },
        { id: 'p2', name: 'Project 2', directory: '/tmp/p2' },
        { id: null, name: 'Broken', directory: '/tmp/broken' },
      ]);
      // Sessions endpoint returns some sessions for valid projects.
      mockApiFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('p1/sessions')) {
          return [
            {
              sessionId: 's1',
              projectId: 'p1',
              name: 'Sessão 1',
              status: 'active',
              createdAt: 1000,
            },
          ];
        }
        if (typeof url === 'string' && url.includes('p2/sessions')) {
          return [];
        }
        return [];
      });

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(2);
      expect(result.current.groups[0].sessions).toHaveLength(1);
      expect(result.current.groups[1].sessions).toHaveLength(0);
    });

    it('handles API returning non-array for projects gracefully', async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === '/api/projects') return null; // non-array
        return [];
      });

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Array.isArray(null) → false → safeProjects = [], so groups = []
      expect(result.current.groups).toHaveLength(0);
    });
  });

  describe('standard behavior (all valid ids)', () => {
    it('groups sessions by project id', async () => {
      mockProjectsResponse([
        { id: 'p1', name: 'Project 1', directory: '/p1' },
        { id: 'p2', name: 'Project 2', directory: '/p2' },
      ]);
      mockApiFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('p1/sessions')) {
          return [
            {
              sessionId: 's1',
              projectId: 'p1',
              name: 'Sessão 1',
              status: 'active',
              createdAt: 200,
            },
          ];
        }
        if (typeof url === 'string' && url.includes('p2/sessions')) {
          return [
            {
              sessionId: 's2',
              projectId: 'p2',
              name: 'Sessão 2',
              status: 'waiting',
              createdAt: 100,
            },
            {
              sessionId: 's3',
              projectId: 'p2',
              name: 'Sessão 3',
              status: 'active',
              createdAt: 300,
            },
          ];
        }
        return [];
      });

      const { result } = renderHook(() => useSessions());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.groups).toHaveLength(2);
      expect(result.current.groups[0].project.name).toBe('Project 1');
      expect(result.current.groups[0].sessions).toHaveLength(1);
      expect(result.current.groups[1].project.name).toBe('Project 2');
      expect(result.current.groups[1].sessions).toHaveLength(2);
    });
  });
});
