import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasState, loadCanvasLayout, DEFAULT_LAYOUT } from './useCanvasState';

const SESSIONS = [
  { sessionId: 'sess-a', name: 'Session A', status: 'active' },
  { sessionId: 'sess-b', name: 'Session B', status: 'waiting' },
];

const PROJECT_ID = 'proj-test';
const STORAGE_KEY = `canvas-grid-${PROJECT_ID}`;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/* ── loadCanvasLayout ── */

describe('loadCanvasLayout', () => {
  it('returns default layout when no key in localStorage', () => {
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ cols: 2, rows: 2, slots: {} });
  });

  it('returns stored layout when key is valid', () => {
    const stored = { cols: 1, rows: 2, slots: { 0: 'sess-a', 1: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual(stored);
  });

  it('returns default layout when JSON is invalid', () => {
    localStorage.setItem(STORAGE_KEY, '{invalid json}');
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, slots: {} });
  });

  it('returns default layout when cols/rows is invalid config', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cols: 3, rows: 3, slots: {} }));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, slots: {} });
  });

  it('returns default layout when slots has non-numeric key', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cols: 2, rows: 2, slots: { foo: 'bar' } }));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, slots: {} });
  });

  it('accepts layout with null slot values', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: null, 1: 'sess-a', 2: null, 3: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual(stored);
  });
});

/* ── useCanvasState ── */

describe('useCanvasState', () => {
  it('loads layout from localStorage on init', () => {
    const stored = { cols: 1, rows: 1, slots: { 0: 'sess-a' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));
    expect(result.current.layout).toEqual(stored);
  });

  it('falls back to default layout when localStorage is empty', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, []));
    expect(result.current.layout.cols).toBe(2);
    expect(result.current.layout.rows).toBe(2);
  });

  it('setCanvasLayout updates cols/rows and drops excess slots', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: 'sess-a', 1: null, 2: null, 3: 'sess-b' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.setCanvasLayout({ cols: 1, rows: 1 });
    });

    expect(result.current.layout.cols).toBe(1);
    expect(result.current.layout.rows).toBe(1);
    // Only slot 0 fits; slot 0 had sess-a which is live
    expect(result.current.layout.slots[0]).toBe('sess-a');
    expect(Object.keys(result.current.layout.slots)).toHaveLength(1);
  });

  it('setCanvasLayout persists to localStorage', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, []));

    act(() => {
      result.current.setCanvasLayout({ cols: 1, rows: 2 });
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.cols).toBe(1);
    expect(saved.rows).toBe(2);
  });

  it('assignSlot sets a sessionId in a slot', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.assignSlot(0, 'sess-a');
    });

    expect(result.current.layout.slots[0]).toBe('sess-a');
  });

  it('assignSlot persists to localStorage', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.assignSlot(1, 'sess-b');
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.slots['1']).toBe('sess-b');
  });

  it('clearSlot sets slot to null', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: 'sess-a' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.clearSlot(0);
    });

    expect(result.current.layout.slots[0]).toBeNull();
  });

  it('clearSlot persists to localStorage', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: 'sess-a' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.clearSlot(0);
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.slots['0']).toBeNull();
  });

  it('auto-cleans orphaned sessions when sessions list changes', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: 'sess-a', 1: 'dead-sess' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result, rerender } = renderHook(
      ({ sessions }) => useCanvasState(PROJECT_ID, sessions),
      { initialProps: { sessions: SESSIONS } },
    );

    // Initially slot 1 has dead-sess, but SESSIONS doesn't include it
    // so it should be cleaned on mount
    expect(result.current.layout.slots[0]).toBe('sess-a');
    expect(result.current.layout.slots[1]).toBeNull();
  });

  it('auto-cleans orphaned slot when session is removed from sessions list', () => {
    const stored = { cols: 2, rows: 2, slots: { 0: 'sess-a', 1: 'sess-b' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result, rerender } = renderHook(
      ({ sessions }) => useCanvasState(PROJECT_ID, sessions),
      { initialProps: { sessions: SESSIONS } },
    );

    expect(result.current.layout.slots[1]).toBe('sess-b');

    // Remove sess-b from sessions
    rerender({ sessions: [SESSIONS[0]] });

    expect(result.current.layout.slots[1]).toBeNull();
  });

  it('reloads layout from localStorage when projectId changes', () => {
    localStorage.setItem('canvas-grid-proj-1', JSON.stringify({ cols: 1, rows: 1, slots: { 0: 'sess-a' } }));
    localStorage.setItem('canvas-grid-proj-2', JSON.stringify({ cols: 2, rows: 3, slots: {} }));

    const { result, rerender } = renderHook(
      ({ projectId }) => useCanvasState(projectId, SESSIONS),
      { initialProps: { projectId: 'proj-1' } },
    );

    expect(result.current.layout.cols).toBe(1);

    rerender({ projectId: 'proj-2' });

    expect(result.current.layout.cols).toBe(2);
    expect(result.current.layout.rows).toBe(3);
  });
});
