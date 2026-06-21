import { useState, useCallback, useEffect } from 'react';
import { DEFAULT_TEMPLATE_ID, getTemplate } from '../components/Canvas/canvasTemplates';

export interface CanvasPanelLayout {
  templateId: string;
  slots: Record<string, string | null>;
}

interface Session {
  sessionId: string;
}

export interface UseCanvasStateResult {
  layout: CanvasPanelLayout;
  setTemplate: (templateId: string) => void;
  assignSlot: (slotId: string, sessionId: string) => void;
  clearSlot: (slotId: string) => void;
}

const STORAGE_KEY_PREFIX = 'canvas-grid-';

export const DEFAULT_LAYOUT: CanvasPanelLayout = {
  templateId: DEFAULT_TEMPLATE_ID,
  slots: {},
};

function isValidLayout(layout: unknown): layout is CanvasPanelLayout {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
  const l = layout as Record<string, unknown>;
  if (typeof l.templateId !== 'string') return false;
  if (typeof l.slots !== 'object' || l.slots === null || Array.isArray(l.slots)) return false;
  for (const [k, v] of Object.entries(l.slots as Record<string, unknown>)) {
    if (typeof k !== 'string') return false;
    if (v !== null && typeof v !== 'string') return false;
  }
  return true;
}

export function loadCanvasLayout(projectId: string): CanvasPanelLayout {
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

function saveCanvasLayout(projectId: string, layout: CanvasPanelLayout): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(layout));
}

export function useCanvasState(
  projectId: string,
  sessions: Session[],
): UseCanvasStateResult {
  const [layout, setLayout] = useState<CanvasPanelLayout>(() => loadCanvasLayout(projectId));

  useEffect(() => {
    setLayout(loadCanvasLayout(projectId));
  }, [projectId]);

  useEffect(() => {
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    setLayout((prev) => {
      let changed = false;
      const newSlots = { ...prev.slots };
      for (const [slotId, sid] of Object.entries(newSlots)) {
        if (sid && !liveIds.has(sid)) {
          newSlots[slotId] = null;
          changed = true;
        }
      }
      if (!changed) return prev;
      const next = { ...prev, slots: newSlots };
      saveCanvasLayout(projectId, next);
      return next;
    });
  }, [sessions, projectId]);

  const setTemplate = useCallback(
    (templateId: string) => {
      setLayout((prev) => {
        const template = getTemplate(templateId);
        const newSlots: Record<string, string | null> = {};
        for (const slotId of template.slots) {
          newSlots[slotId] = prev.slots[slotId] ?? null;
        }
        const next = { templateId, slots: newSlots };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const assignSlot = useCallback(
    (slotId: string, sessionId: string) => {
      setLayout((prev) => {
        const next = { ...prev, slots: { ...prev.slots, [slotId]: sessionId } };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      setLayout((prev) => {
        const next = { ...prev, slots: { ...prev.slots, [slotId]: null } };
        saveCanvasLayout(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  return { layout, setTemplate, assignSlot, clearSlot };
}
