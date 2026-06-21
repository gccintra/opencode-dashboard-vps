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
    expect(layout).toEqual({ templateId: '2col', slots: {} });
  });

  it('returns stored layout when key is valid', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual(stored);
  });

  it('returns default layout when JSON is invalid', () => {
    localStorage.setItem(STORAGE_KEY, '{invalid json}');
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, slots: {} });
  });

  it('returns default layout when templateId is missing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: {} }));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, slots: {} });
  });

  it('accepts layout with null slot values', () => {
    const stored = { templateId: '2x2', slots: { a: null, b: 'sess-a', c: null, d: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const layout = loadCanvasLayout(PROJECT_ID);
    expect(layout).toEqual(stored);
  });
});

/* ── useCanvasState ── */

describe('useCanvasState', () => {
  it('loads layout from localStorage on init', () => {
    const stored = { templateId: 'single', slots: { a: 'sess-a' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));
    expect(result.current.layout).toEqual(stored);
  });

  it('falls back to default layout when localStorage is empty', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, []));
    expect(result.current.layout.templateId).toBe('2col');
  });

  it('setTemplate updates templateId and carries over matching slots', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.setTemplate('single');
    });

    expect(result.current.layout.templateId).toBe('single');
    // 'a' slot carries over
    expect(result.current.layout.slots['a']).toBe('sess-a');
    // only slots for 'single' template remain
    expect(Object.keys(result.current.layout.slots)).toHaveLength(1);
  });

  it('setTemplate persists to localStorage', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, []));

    act(() => {
      result.current.setTemplate('2x2');
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.templateId).toBe('2x2');
  });

  it('assignSlot sets a sessionId in a slot', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.assignSlot('a', 'sess-a');
    });

    expect(result.current.layout.slots['a']).toBe('sess-a');
  });

  it('assignSlot persists to localStorage', () => {
    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.assignSlot('b', 'sess-b');
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.slots['b']).toBe('sess-b');
  });

  it('clearSlot sets slot to null', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.clearSlot('a');
    });

    expect(result.current.layout.slots['a']).toBeNull();
  });

  it('clearSlot persists to localStorage', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useCanvasState(PROJECT_ID, SESSIONS));

    act(() => {
      result.current.clearSlot('a');
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.slots['a']).toBeNull();
  });

  it('auto-cleans orphaned sessions when sessions list changes', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: 'dead-sess' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(
      ({ sessions }) => useCanvasState(PROJECT_ID, sessions),
      { initialProps: { sessions: SESSIONS } },
    );

    expect(result.current.layout.slots['a']).toBe('sess-a');
    expect(result.current.layout.slots['b']).toBeNull();
  });

  it('auto-cleans orphaned slot when session is removed from sessions list', () => {
    const stored = { templateId: '2col', slots: { a: 'sess-a', b: 'sess-b' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result, rerender } = renderHook(
      ({ sessions }) => useCanvasState(PROJECT_ID, sessions),
      { initialProps: { sessions: SESSIONS } },
    );

    expect(result.current.layout.slots['b']).toBe('sess-b');

    rerender({ sessions: [SESSIONS[0]] });

    expect(result.current.layout.slots['b']).toBeNull();
  });

  it('reloads layout from localStorage when projectId changes', () => {
    localStorage.setItem('canvas-grid-proj-1', JSON.stringify({ templateId: 'single', slots: { a: 'sess-a' } }));
    localStorage.setItem('canvas-grid-proj-2', JSON.stringify({ templateId: '2x2', slots: {} }));

    const { result, rerender } = renderHook(
      ({ projectId }) => useCanvasState(projectId, SESSIONS),
      { initialProps: { projectId: 'proj-1' } },
    );

    expect(result.current.layout.templateId).toBe('single');

    rerender({ projectId: 'proj-2' });

    expect(result.current.layout.templateId).toBe('2x2');
  });
});
