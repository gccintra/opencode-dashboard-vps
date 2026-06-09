import { useState, useCallback, useEffect } from 'react';

export interface CanvasLayout {
  cols: number;
  rows: number;
  slots: Record<number, string | null>;
}

interface Session {
  sessionId: string;
}

export interface UseCanvasStateResult {
  layout: CanvasLayout;
  setCanvasLayout: (dims: { cols: number; rows: number }) => void;
  assignSlot: (slotIndex: number, sessionId: string) => void;
  clearSlot: (slotIndex: number) => void;
}

const STORAGE_KEY_PREFIX = 'canvas-grid-';

export const DEFAULT_LAYOUT: CanvasLayout = { cols: 2, rows: 2, slots: {} };

const VALID_CONFIGS = [
  { cols: 1, rows: 1 },
  { cols: 1, rows: 2 },
  { cols: 2, rows: 1 },
  { cols: 2, rows: 2 },
  { cols: 2, rows: 3 },
];

function isValidLayout(layout: unknown): layout is CanvasLayout {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
  const l = layout as Record<string, unknown>;
  const { cols, rows, slots } = l;
  if (typeof cols !== 'number' || typeof rows !== 'number') return false;
  if (!VALID_CONFIGS.some((c) => c.cols === cols && c.rows === rows)) return false;
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) return false;
  for (const [k, v] of Object.entries(slots as Record<string, unknown>)) {
    if (Number.isNaN(Number(k))) return false;
    if (v !== null && typeof v !== 'string') return false;
  }
  return true;
}

export function loadCanvasLayout(projectId: string): CanvasLayout {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return { ...DEFAULT_LAYOUT, slots: {} };
    const parsed: unknown = JSON.parse(raw);
    if (isValidLayout(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_LAYOUT, slots: {} };
}

function saveCanvasLayout(projectId: string, layout: CanvasLayout): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(layout));
}

export function useCanvasState(
  projectId: string,
  sessions: Session[],
): UseCanvasStateResult {
  const [layout, setLayout] = useState<CanvasLayout>(() => loadCanvasLayout(projectId));

  // Reload when projectId changes
  useEffect(() => {
    setLayout(loadCanvasLayout(projectId));
  }, [projectId]);

  // Auto-clean orphaned slots when session list changes
  useEffect(() => {
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    setLayout((prev) => {
      const capacity = prev.cols * prev.rows;
      let changed = false;
      const newSlots = { ...prev.slots };
      for (let i = 0; i < capacity; i++) {
        const sid = newSlots[i];
        if (sid && !liveIds.has(sid)) {
          newSlots[i] = null;
          changed = true;
        }
      }
      if (!changed) return prev;
      const next = { ...prev, slots: newSlots };
      saveCanvasLayout(projectId, next);
      return next;
    });
  }, [sessions, projectId]);

  const setCanvasLayout = useCallback(
    (dims: { cols: number; rows: number }) => {
      setLayout((prev) => {
        const liveIds = new Set(sessions.map((s) => s.sessionId));
        const capacity = dims.cols * dims.rows;
        const newSlots: Record<number, string | null> = {};
        for (let i = 0; i < capacity; i++) {
          const sid = prev.slots[i];
          newSlots[i] = sid && liveIds.has(sid) ? sid : null;
        }
        const next = { cols: dims.cols, rows: dims.rows, slots: newSlots };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    // sessions intentionally captured via closure to avoid stale closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, sessions],
  );

  const assignSlot = useCallback(
    (slotIndex: number, sessionId: string) => {
      setLayout((prev) => {
        const next = { ...prev, slots: { ...prev.slots, [slotIndex]: sessionId } };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const clearSlot = useCallback(
    (slotIndex: number) => {
      setLayout((prev) => {
        const next = { ...prev, slots: { ...prev.slots, [slotIndex]: null } };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  return { layout, setCanvasLayout, assignSlot, clearSlot };
}
