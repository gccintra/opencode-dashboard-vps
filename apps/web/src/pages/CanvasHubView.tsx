import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { MobileKeyboard, TerminalStatusBar } from '../components/Terminal';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';
import { CanvasGrid } from '../components/Canvas/CanvasGrid';
import { CanvasMobile, type CanvasMobileHandle } from '../components/Canvas/CanvasMobile';

/* ── Types ── */

interface CanvasData {
  id: string;
  name: string;
  cols: number;
  rows: number;
  slots: Record<number, string | null>;
  createdAt: string;
  updatedAt: string;
}

interface SessionItem {
  sessionId: string;
  name: string;
  status: string;
  projectId: string;
  projectName?: string;
}

interface ProjectBrief {
  id: string;
  name: string;
}

/* ── Constants ── */

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);
const MAX_MOBILE_SLOTS = 8;

const CANVAS_LAYOUTS = [
  { cols: 1, rows: 1, label: '1×1' },
  { cols: 2, rows: 1, label: '2×1' },
  { cols: 3, rows: 1, label: '3×1' },
  { cols: 4, rows: 1, label: '4×1' },
  { cols: 2, rows: 2, label: '2×2' },
  { cols: 3, rows: 2, label: '3×2' },
  { cols: 4, rows: 2, label: '4×2' },
];

function colsRowsToTemplateId(cols: number, rows: number): string {
  if (cols === 1 && rows === 1) return 'single';
  if (cols === 1 && rows === 2) return '2row';
  if (cols === 2 && rows === 1) return '2col';
  if (cols === 2 && rows === 2) return '2x2';
  return '2x2'; // fallback for 2×3 and others
}

// Returns the smallest layout that fits at least `minSlots` slots
function getAutoGrowLayout(minSlots: number): { cols: number; rows: number } {
  if (minSlots <= 2) return { cols: 2, rows: 1 };
  if (minSlots <= 4) return { cols: 2, rows: 2 };
  if (minSlots <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}

const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_DEFAULT_MOBILE = 12;

/* ── Hooks ── */

function useIsMobile() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const check = () => setV(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return v;
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setH(vv.height);
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return h;
}

function isValidProjectId(id: unknown): id is string {
  return (
    !!id && typeof id === 'string' && id !== 'undefined' && id !== 'null' && id.trim().length > 0
  );
}

/* ── Project picker modal (same as Canvas.tsx) ── */

function ProjectPickerModal({
  projects,
  onSelect,
  onDismiss,
}: {
  projects: ProjectBrief[];
  onSelect: (projectId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center bg-[rgba(0,0,0,0.7)]"
      onClick={onDismiss}
    >
      <div
        className="flex flex-col w-full sm:w-[340px] max-h-[70vh] sm:max-h-[460px] rounded-t-[16px] sm:rounded-[12px] border border-[rgba(255,255,255,0.1)] bg-[#111118] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex sm:hidden justify-center pt-[10px] pb-[4px] shrink-0">
          <span className="w-[36px] h-[4px] rounded-full bg-[rgba(255,255,255,0.15)]" />
        </div>
        <div className="flex items-center justify-between px-[16px] pt-[12px] pb-[12px] border-b border-[rgba(255,255,255,0.06)] shrink-0">
          <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">
            Criar sessão em qual projeto?
          </span>
          <button
            onClick={onDismiss}
            className="flex items-center justify-center size-[26px] rounded-[5px] text-[#5a626c] hover:text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 2l6 6M8 2l-6 6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex flex-col overflow-y-auto py-[6px]">
          {projects.length === 0 && (
            <p className="px-[16px] py-[14px] font-['Inter'] text-[13px] text-[#5a626c]">
              Nenhum projeto encontrado.
            </p>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="flex items-center gap-[12px] px-[16px] py-[14px] text-left active:bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              <span className="shrink-0 size-[8px] rounded-full bg-[rgba(179,229,2,0.5)]" />
              <span className="flex-1 min-w-0 truncate font-['Inter'] text-[14px] text-[#ccd]">
                {p.name}
              </span>
              <svg
                className="shrink-0 text-[#5a626c]"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path
                  d="M5 3l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
          <div className="h-[env(safe-area-inset-bottom,0px)] sm:hidden" />
        </div>
      </div>
    </div>
  );
}

/* ── Inline rename input for canvas name in header ── */

function CanvasNameEdit({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  useEffect(() => {
    setValue(name);
  }, [name]);

  const save = useCallback(() => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    else setValue(name);
  }, [value, name, onSave]);

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setEditing(false);
            setValue(name);
          }
        }}
        onBlur={save}
        className="bg-[rgba(255,255,255,0.06)] border border-[rgba(179,229,2,0.3)] rounded-[5px] px-[8px] py-[3px] font-['Inter'] text-[14px] font-semibold text-[#f0f0f0] focus:outline-none max-w-[200px]"
        data-testid="canvas-hub-view-name-input"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-['Inter'] text-[14px] font-semibold text-[#f0f0f0] hover:text-[#b3e502] transition-colors truncate max-w-[200px]"
      title="Clique para renomear"
      data-testid="canvas-hub-view-name"
    >
      {name}
    </button>
  );
}

/* ── Page ── */

export default function CanvasHubViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const viewportHeight = useViewportHeight();
  const canvasMobileRef = useRef<CanvasMobileHandle | null>(null);

  const [canvas, setCanvas] = useState<CanvasData | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /* ── Fetch canvas ── */
  const fetchCanvas = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<CanvasData>(`/api/canvases/${id}`);
      setCanvas(data);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        (err as { status: number }).status === 404
      ) {
        setNotFound(true);
      }
    }
  }, [id]);

  /* ── Fetch sessions from all projects ── */
  const fetchSessions = useCallback(async () => {
    try {
      const fetched = await apiFetch<ProjectBrief[]>('/api/projects');
      const safeProjects: ProjectBrief[] = Array.isArray(fetched) ? fetched : [];
      setProjects(safeProjects);

      const results = await Promise.allSettled(
        safeProjects.flatMap((project) => {
          if (!isValidProjectId(project.id)) return [];
          return [
            (async () => {
              const list = await apiFetch<SessionItem[]>(`/api/projects/${project.id}/sessions`);
              return (Array.isArray(list) ? list : []).map((s) => ({
                ...s,
                projectId: project.id,
                projectName: project.name,
              }));
            })(),
          ];
        }),
      );

      const all: SessionItem[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') all.push(...r.value);
      }
      setSessions(all.filter((s) => !DEAD_STATUSES.has(s.status)));
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchCanvas(), fetchSessions()]).finally(() => setLoading(false));
    const id = setInterval(fetchSessions, 15_000);
    const handler = () => fetchSessions();
    window.addEventListener('sessions-changed', handler);
    return () => {
      clearInterval(id);
      window.removeEventListener('sessions-changed', handler);
    };
  }, [fetchCanvas, fetchSessions]);

  /* ── Layout change ── */
  const handleLayoutChange = useCallback(
    async (cols: number, rows: number) => {
      if (!id) return;
      try {
        const updated = await apiFetch<CanvasData>(`/api/canvases/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ cols, rows }),
        });
        setCanvas(updated);
      } catch {
        // silent
      }
    },
    [id],
  );

  /* ── Slot management — synced with API ── */

  const handleAssignSlot = useCallback(
    async (slotIndex: number, sessionId: string) => {
      if (!id) return;
      try {
        await apiFetch(`/api/canvases/${id}/slots/${slotIndex}`, {
          method: 'PUT',
          body: JSON.stringify({ sessionId }),
        });
        setCanvas((prev) =>
          prev ? { ...prev, slots: { ...prev.slots, [slotIndex]: sessionId } } : prev,
        );
      } catch {
        // silent
      }
    },
    [id],
  );

  const handleClearSlot = useCallback(
    async (slotIndex: number) => {
      if (!id) return;
      try {
        await apiFetch(`/api/canvases/${id}/slots/${slotIndex}`, { method: 'DELETE' });
        setCanvas((prev) =>
          prev ? { ...prev, slots: { ...prev.slots, [slotIndex]: null } } : prev,
        );
      } catch {
        // silent
      }
    },
    [id],
  );

  // Mobile: assign with auto-grow — if slot exceeds current capacity, expand layout first
  const handleAssignSlotMobile = useCallback(
    async (slotIndex: number, sessionId: string) => {
      if (!canvas) return;
      const currentCapacity = canvas.cols * canvas.rows;
      if (slotIndex >= currentCapacity) {
        const newLayout = getAutoGrowLayout(slotIndex + 1);
        await handleLayoutChange(newLayout.cols, newLayout.rows);
      }
      await handleAssignSlot(slotIndex, sessionId);
    },
    [canvas, handleLayoutChange, handleAssignSlot],
  );

  // Mobile slots: always MAX_MOBILE_SLOTS entries, dead sessions treated as null
  const mobileSlots: (string | null)[] = useMemo(() => {
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    return Array.from({ length: MAX_MOBILE_SLOTS }, (_, i) => {
      const sid = canvas?.slots[i] ?? null;
      return sid && liveIds.has(sid) ? sid : null;
    });
  }, [canvas, sessions]);

  // Desktop slots: string-keyed for CanvasGrid (a=0, b=1, ...)
  const desktopSlotsRecord: Record<string, string | null> = useMemo(() => {
    if (!canvas) return {};
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    const capacity = canvas.cols * canvas.rows;
    const rec: Record<string, string | null> = {};
    for (let i = 0; i < capacity; i++) {
      const sid = canvas.slots[i] ?? null;
      rec[String.fromCharCode(97 + i)] = sid && liveIds.has(sid) ? sid : null;
    }
    return rec;
  }, [canvas, sessions]);

  /* ── Name rename ── */
  const handleRename = useCallback(
    async (name: string) => {
      if (!id) return;
      try {
        await apiFetch(`/api/canvases/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        setCanvas((prev) => (prev ? { ...prev, name } : prev));
      } catch {
        // silent
      }
    },
    [id],
  );

  /* ── Kill session ── */
  const handleKillSession = useCallback(async (sessionId: string) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      window.dispatchEvent(new CustomEvent('sessions-changed'));
    } catch {
      // silent
    }
  }, []);

  /* ── Rename session ── */
  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName }),
      });
      setSessions((prev) =>
        prev.map((s) => (s.sessionId === sessionId ? { ...s, name: newName } : s)),
      );
    } catch {
      // silent
    }
  }, []);

  /* ── Create session — project picker ── */
  type PickerResolver = (projectId: string | null) => void;
  const [pickerResolver, setPickerResolver] = useState<PickerResolver | null>(null);

  const handleCreateSession = useCallback((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPickerResolver(() => resolve);
    }).then(async (projectId) => {
      if (!projectId) return null;
      try {
        const created = await apiFetch<SessionItem>(`/api/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const project = projects.find((p) => p.id === projectId);
        const newSession: SessionItem = { ...created, projectId, projectName: project?.name };
        setSessions((prev) => [...prev, newSession]);
        window.dispatchEvent(new CustomEvent('sessions-changed'));
        return created.sessionId;
      } catch {
        return null;
      }
    });
  }, [projects]);

  /* ── Font size ── */
  const defaultFontSize = isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem('terminalFontSize');
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) return n;
    }
    return defaultFontSize;
  });
  useEffect(() => {
    localStorage.setItem('terminalFontSize', String(fontSize));
  }, [fontSize]);

  const handleZoomIn = useCallback(() => setFontSize((p) => Math.min(p + 1, FONT_SIZE_MAX)), []);
  const handleZoomOut = useCallback(() => setFontSize((p) => Math.max(p - 1, FONT_SIZE_MIN)), []);
  const handleZoomReset = useCallback(() => setFontSize(defaultFontSize), [defaultFontSize]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleZoomReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  /* ── Theme ── */
  const [themeId, setThemeId] = useState<string>(() => getThemeId());
  const handleThemeChange = useCallback((tid: string) => {
    setThemeId(tid);
    saveThemeId(tid);
  }, []);

  /* ── Render ── */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
        <svg className="animate-spin size-[28px] text-[#5a626c]" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity="0.25"
          />
          <path
            d="M21 12a9 9 0 00-9-9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  if (notFound || !canvas) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-[16px] bg-[#0a0a0f]">
        <p className="font-['Inter'] text-[16px] text-[#9aa3ad]">Canvas não encontrado</p>
        <button
          onClick={() => navigate('/canvas')}
          className="font-['Inter'] text-[13px] text-[#b3e502] hover:underline"
        >
          Voltar para Canvas Hub
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-[#0a0a0f]"
      style={{ height: `${viewportHeight}px` }}
    >
      {/* Header — hidden on mobile (CanvasMobile TopBar takes over) */}
      <header
        className={`${isMobile ? 'hidden' : 'flex'} shrink-0 items-center justify-between gap-[12px] border-b border-white/[0.07] bg-[#111118] px-[20px] py-[10px]`}
      >
        {/* Left: back + name */}
        <div className="flex items-center gap-[8px] min-w-0">
          <button
            onClick={() => navigate('/canvas')}
            className="flex items-center gap-[4px] shrink-0 font-['Inter'] text-[12px] text-[#5a626c] hover:text-[#9aa3ad] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M7.5 2L4 6l3.5 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Canvas
          </button>
          <span className="text-[#334]">/</span>
          <CanvasNameEdit name={canvas.name} onSave={handleRename} />
        </div>

        {/* Right: layout controls */}
        <div className="flex items-center gap-[8px] shrink-0">
          <span className="font-['Inter'] text-[11px] text-[#5a626c]">Layout:</span>
          <div className="flex items-center gap-[4px]" role="group" aria-label="Layout">
            {CANVAS_LAYOUTS.map((opt) => {
              const isActive = canvas.cols === opt.cols && canvas.rows === opt.rows;
              return (
                <button
                  key={opt.label}
                  onClick={() => handleLayoutChange(opt.cols, opt.rows)}
                  aria-pressed={isActive}
                  className={`rounded-[5px] px-[8px] py-[4px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                      : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main canvas */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {isMobile ? (
          <CanvasMobile
            ref={canvasMobileRef}
            projectId={canvas.id}
            sessions={sessions}
            fontSize={fontSize}
            theme={getThemeById(themeId).xterm}
            onCreateSession={handleCreateSession}
            onKill={handleKillSession}
            onRename={handleRenameSession}
            projectName={canvas.name}
            onToggleSidebar={() => navigate('/canvas')}
            externalSlots={mobileSlots}
            onAssignSlot={handleAssignSlotMobile}
            onClearSlot={handleClearSlot}
          />
        ) : (
          <CanvasGrid
            templateId={colsRowsToTemplateId(canvas.cols, canvas.rows)}
            slots={desktopSlotsRecord}
            storageKey={canvas.id}
            sessions={sessions}
            fontSize={fontSize}
            theme={getThemeById(themeId).xterm}
            onAssign={(slotId, sid) => handleAssignSlot(slotId.charCodeAt(0) - 97, sid)}
            onRemove={(slotId) => handleClearSlot(slotId.charCodeAt(0) - 97)}
            onKill={handleKillSession}
            onCreateSession={handleCreateSession}
            onRename={handleRenameSession}
          />
        )}
      </div>

      {/* Project picker */}
      {pickerResolver && (
        <ProjectPickerModal
          projects={projects}
          onSelect={(projectId) => {
            const resolver = pickerResolver;
            setPickerResolver(null);
            resolver(projectId);
          }}
          onDismiss={() => {
            const resolver = pickerResolver;
            setPickerResolver(null);
            resolver(null);
          }}
        />
      )}

      {/* Footer: standard terminal bar (CPU/RAM + theme + zoom + keyboard) */}
      <TerminalStatusBar
        fontSize={fontSize}
        defaultFontSize={defaultFontSize}
        themeId={themeId}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onThemeChange={handleThemeChange}
        mobileKeyboard={
          isMobile ? (
            <MobileKeyboard
              inline
              onKey={(seq) => canvasMobileRef.current?.sendKey(seq)}
              onSelectAll={() => canvasMobileRef.current?.selectAll()}
              onCopy={() => {
                const sel = canvasMobileRef.current?.getSelection() ?? '';
                if (sel) navigator.clipboard.writeText(sel).catch(() => {});
              }}
              onPaste={() => {
                navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (text) canvasMobileRef.current?.sendKey(text);
                  })
                  .catch(() => {});
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}
