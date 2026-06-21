import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  XTermTerminal,
  MobileKeyboard,
  TerminalStatusBar,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_DEFAULT_MOBILE,
  type XTermTerminalHandle,
  type ConnectionStatus,
} from '../components/Terminal';
import { CanvasGrid } from '../components/Canvas/CanvasGrid';
import { CanvasMobile, type CanvasMobileHandle } from '../components/Canvas/CanvasMobile';
import { getTemplate } from '../components/Canvas/canvasTemplates';
import { apiFetch } from '../lib/api';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';

/* ── Types ── */

interface SessionItem {
  sessionId: string;
  projectId: string;
  projectName: string;
  name: string;
  status: string;
  createdAt: number;
}

interface ProjectBrief {
  id: string;
  name: string;
}

interface CanvasItem {
  id: string;
  name: string;
  cols: number;
  rows: number;
  slotCount: number;
  totalSlots: number;
  createdAt: string;
  updatedAt: string;
}

interface CanvasData {
  id: string;
  name: string;
  cols: number;
  rows: number;
  slots: Record<number, string | null>;
  createdAt: string;
  updatedAt: string;
}

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);

/* ── Helpers ── */

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return m;
}

function useViewportHeight() {
  const [height, setHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return height;
}

function useDebouncedResize(sessionId: string | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ cols: number; rows: number } | null>(null);

  return useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      latestRef.current = { cols, rows };
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const dims = latestRef.current;
        if (!dims) return;
        apiFetch(`/api/sessions/${sessionId}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols: dims.cols, rows: dims.rows }),
        }).catch(() => {});
      }, 300);
    },
    [sessionId],
  );
}

function colsRowsToTemplateId(cols: number, rows: number): string {
  if (cols === 1 && rows === 1) return 'single';
  if (cols === 1 && rows === 2) return '2row';
  if (cols === 2 && rows === 1) return '2col';
  if (cols === 3 && rows === 1) return '3col';
  if (cols === 2 && rows === 2) return '2x2';
  return '2x2';
}

function templateIdToColsRows(templateId: string): { cols: number; rows: number } {
  switch (templateId) {
    case 'single':      return { cols: 1, rows: 1 };
    case '2col':        return { cols: 2, rows: 1 };
    case '2row':        return { cols: 1, rows: 2 };
    case 'left-stack':  return { cols: 2, rows: 2 };
    case 'right-stack': return { cols: 2, rows: 2 };
    case '2x2':         return { cols: 2, rows: 2 };
    case '3col':        return { cols: 3, rows: 1 };
    default:            return { cols: 2, rows: 1 };
  }
}


function isValidProjectId(id: unknown): id is string {
  return (
    !!id && typeof id === 'string' && id !== 'undefined' && id !== 'null' && id.trim().length > 0
  );
}

function estimateDims() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  const charW = 13 * 0.6;
  const reserved = w >= 1024 ? 240 + 220 + 48 : 36;
  return {
    cols: Math.max(40, Math.floor((w - reserved) / charW)),
    rows: Math.max(10, Math.floor((h - 120) / 13)),
  };
}

/* ── Status dot for the rail ── */

function statusDot(status: string): { color: string; pulse: boolean } {
  if (status === 'active') return { color: '#22dd88', pulse: true };
  if (status === 'waiting') return { color: '#ffaa00', pulse: false };
  return { color: '#445566', pulse: false };
}

/* ── Session rail (master list) ── */

function SessionRail({
  groups,
  activeSessionId,
  onSelect,
  onClose,
  onCreateSession,
  creating,
  onRename,
  isMobile,
  showCanvas,
  onSelectCanvas,
  canvasLabel,
}: {
  groups: { project: ProjectBrief; sessions: SessionItem[] }[];
  activeSessionId: string | undefined;
  onSelect: (s: SessionItem) => void;
  onClose: () => void;
  onCreateSession: (projectId: string) => void;
  creating: string | null;
  onRename: (sessionId: string, name: string) => void;
  isMobile: boolean;
  showCanvas: boolean;
  onSelectCanvas: () => void;
  canvasLabel?: string;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameOriginal, setRenameOriginal] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = useCallback((s: SessionItem) => {
    setRenamingId(s.sessionId);
    setRenameValue(s.name);
    setRenameOriginal(s.name);
  }, []);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (renamingId && trimmed && trimmed !== renameOriginal) {
      onRename(renamingId, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameOriginal, onRename]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#0a0a0f]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-[14px] py-[12px]">
        <span className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
          Sessions
        </span>
        <button
          onClick={onClose}
          className="flex size-[24px] items-center justify-center rounded-[6px] text-[#5a626c] transition-colors hover:bg-white/[0.06] hover:text-[#9aa3ad]"
          title={isMobile ? 'Fechar' : 'Recolher'}
          aria-label="Recolher lista de sessões"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M4 2L8 6L4 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-[6px]">
        {groups.length === 0 && (
          <p className="px-[14px] py-[10px] font-['Inter'] text-[12px] text-[#5a626c]">
            Nenhuma sessão ativa.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.project.id} className="mb-[6px]">
            <div className="flex items-center justify-between px-[14px] py-[5px]">
              <span className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.7px] text-[#5a626c]">
                {g.project.name}
              </span>
              <button
                onClick={() => onCreateSession(g.project.id)}
                disabled={creating === g.project.id}
                className="flex size-[20px] items-center justify-center rounded-[4px] text-[#5a626c] hover:bg-[rgba(179,229,2,0.08)] hover:text-[#b3e502] transition-all disabled:opacity-40"
                title={`New session in ${g.project.name}`}
              >
                {creating === g.project.id ? (
                  <div className="size-[8px] animate-spin rounded-full border border-[#b3e502] border-t-transparent" />
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
            {g.sessions.map((s) => {
              const d = statusDot(s.status);
              const isActive = s.sessionId === activeSessionId && !showCanvas;
              const isRenaming = renamingId === s.sessionId;
              return isRenaming ? (
                <div
                  key={s.sessionId}
                  className={`flex w-full items-center gap-[8px] px-[14px] py-[6px] border-l-2 ${
                    isActive ? 'border-[#b3e502] bg-[rgba(179,229,2,0.07)]' : 'border-transparent'
                  }`}
                >
                  <span
                    className={`size-[6px] shrink-0 rounded-full ${d.pulse ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: d.color }}
                  />
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      else if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={commitRename}
                    className="min-w-0 flex-1 rounded-[4px] border border-[rgba(179,229,2,0.3)] bg-[#0a0a0f] px-[6px] py-[2px] font-['Inter'] text-[13px] text-[#f0f0f0] outline-none"
                  />
                </div>
              ) : (
                <div
                  key={s.sessionId}
                  className={`group flex w-full items-center gap-[8px] pl-[14px] pr-[6px] py-[8px] font-['Inter'] text-[13px] transition-colors ${
                    isActive
                      ? 'border-l-2 border-[#b3e502] bg-[rgba(179,229,2,0.07)] text-[#f0f0f0]'
                      : 'border-l-2 border-transparent text-[#9aa3ad] hover:bg-white/[0.03] hover:text-[#e6e8eb]'
                  }`}
                >
                  <button
                    onClick={() => onSelect(s)}
                    className="flex min-w-0 flex-1 items-center gap-[8px] text-left"
                  >
                    <span
                      className={`size-[6px] shrink-0 rounded-full ${d.pulse ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(s); }}
                    className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] text-[#5a626c] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.06)] hover:text-[#9aa3ad] transition-all"
                    title="Renomear sessão"
                  >
                    <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                      <path d="M7.5 1.5l2 2L3.5 9.5H1.5V7.5L7.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Canvas nav item — like ProjectDetail */}
      <div className="shrink-0 border-t border-white/[0.06] py-[6px]">
        <button
          onClick={onSelectCanvas}
          className={`flex w-full items-center gap-[8px] border-l-2 px-[14px] py-[9px] font-['Inter'] text-[13px] font-medium transition-colors ${
            showCanvas
              ? 'border-[#b3e502] bg-[rgba(179,229,2,0.07)] text-[#f0f0f0]'
              : 'border-transparent text-[#9aa3ad] hover:bg-white/[0.03] hover:text-[#e6e8eb]'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span className="flex-1 min-w-0 truncate text-left">
            {canvasLabel ? canvasLabel : 'Canvas'}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ── Page: Sessions Workspace (master-detail, no global sidebar) ── */

export default function SessionTerminalPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const isMobile = useIsMobile();
  const viewportHeight = useViewportHeight();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectBrief[]>([]);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem('sessions-rail-open') !== 'false';
    } catch {
      return true;
    }
  });

  const termRef = useRef<XTermTerminalHandle>(null);
  const handleResize = useDebouncedResize(sessionId);

  /* ── Fetch all active sessions for the rail ── */
  const fetchAll = useCallback(async () => {
    try {
      const projects = await apiFetch<ProjectBrief[]>('/api/projects');
      const safe = Array.isArray(projects) ? projects : [];
      setAllProjects(safe.filter((p) => isValidProjectId(p.id)));
      const results = await Promise.allSettled(
        safe.flatMap((p) => {
          if (!isValidProjectId(p.id)) return [];
          return [
            (async () => {
              const list = await apiFetch<SessionItem[]>(`/api/projects/${p.id}/sessions`);
              return (Array.isArray(list) ? list : []).map((s) => ({
                ...s,
                projectId: p.id,
                projectName: p.name,
              }));
            })(),
          ];
        }),
      );
      const all: SessionItem[] = [];
      for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
      setSessions(all.filter((s) => !DEAD_STATUSES.has(s.status)));
    } catch {
      // keep last known
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    const handler = () => fetchAll();
    window.addEventListener('sessions-changed', handler);
    return () => {
      clearInterval(id);
      window.removeEventListener('sessions-changed', handler);
    };
  }, [fetchAll]);

  const persistRail = useCallback((open: boolean) => {
    setRailOpen(open);
    try {
      localStorage.setItem('sessions-rail-open', String(open));
    } catch {
      /* ignore */
    }
  }, []);

  /* ── Derived ── */
  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === sessionId),
    [sessions, sessionId],
  );

  const groups = useMemo(() => {
    const byProject = new Map<string, { project: ProjectBrief; sessions: SessionItem[] }>();
    for (const s of sessions) {
      let g = byProject.get(s.projectId);
      if (!g) {
        g = { project: { id: s.projectId, name: s.projectName }, sessions: [] };
        byProject.set(s.projectId, g);
      }
      g.sessions.push(s);
    }
    return Array.from(byProject.values());
  }, [sessions]);

  const sessionName = activeSession?.name ?? '';
  const projectName = activeSession?.projectName ?? '';

  /* ── Font size (shared via localStorage) ── */
  const defaultFontSize = isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem('terminalFontSize');
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) return n;
    }
    return isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem('terminalFontSize', String(fontSize));
  }, [fontSize]);

  /* ── Theme ── */
  const [themeId, setThemeId] = useState<string>(() => getThemeId());
  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  // Re-fit after font change
  useEffect(() => {
    const t = setTimeout(() => termRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [fontSize]);

  const handleZoomIn = useCallback(() => setFontSize((p) => Math.min(p + 1, FONT_SIZE_MAX)), []);
  const handleZoomOut = useCallback(() => setFontSize((p) => Math.max(p - 1, FONT_SIZE_MIN)), []);
  const handleZoomReset = useCallback(() => setFontSize(defaultFontSize), [defaultFontSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  /* ── Switch active session ── */
  const handleSelect = useCallback(
    (s: SessionItem) => {
      navigate(`/sessions/${s.projectId}/${s.sessionId}`);
      setShowCanvas(false);
      setSelectedCanvasId(null);
      if (isMobile) persistRail(false);
    },
    [navigate, isMobile, persistRail],
  );

  /* ── Rename handler ── */
  const handleRename = useCallback(async (renameSessionId: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.sessionId === renameSessionId ? { ...s, name } : s)));
    try {
      await apiFetch(`/api/sessions/${renameSessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
    } catch {
      // next poll reverts
    }
  }, []);

  /* ── Action handlers: kill / fit / create ── */
  const [killing, setKilling] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  /* ── Canvas / project-picker state ── */
  const [showCanvas, setShowCanvas] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [canvases, setCanvases] = useState<CanvasItem[]>([]);
  const [canvasesLoading, setCanvasesLoading] = useState(false);
  const [canvasCreating, setCanvasCreating] = useState(false);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('2col');
  const [, setCanvasDataLoading] = useState(false);
  type PickerResolver = (projectId: string | null) => void;
  const [pickerResolver, setPickerResolver] = useState<PickerResolver | null>(null);
  const canvasMobileRef = useRef<CanvasMobileHandle | null>(null);

  const handleKill = useCallback(async () => {
    if (!sessionId || killing) return;
    setKilling(true);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      const remaining = sessions.filter((s) => s.sessionId !== sessionId);
      window.dispatchEvent(new Event('sessions-changed'));
      if (remaining.length === 0) {
        navigate('/sessions');
      } else {
        const next =
          remaining.find((s) => s.projectId === activeSession?.projectId) ?? remaining[0];
        navigate(`/sessions/${next.projectId}/${next.sessionId}`);
      }
    } catch {
      // keep
    } finally {
      setKilling(false);
    }
  }, [sessionId, killing, navigate, sessions, activeSession]);

  const handleFit = useCallback(() => {
    termRef.current?.resize();
  }, []);

  const handleCreateSession = useCallback(
    async (projectId: string) => {
      if (creating) return;
      setCreating(projectId);
      try {
        const dims = estimateDims();
        const session = await apiFetch<{ sessionId: string }>(
          `/api/projects/${projectId}/sessions`,
          { method: 'POST', body: JSON.stringify({ cols: dims.cols, rows: dims.rows }) },
        );
        window.dispatchEvent(new Event('sessions-changed'));
        navigate(`/sessions/${projectId}/${session.sessionId}`);
      } catch {
        // silently fail
      } finally {
        setCreating(null);
      }
    },
    [creating, navigate],
  );

  /* ── Canvas callbacks ── */
  const fetchCanvases = useCallback(async () => {
    setCanvasesLoading(true);
    try {
      const data = await apiFetch<CanvasItem[]>('/api/canvases');
      setCanvases(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    } finally {
      setCanvasesLoading(false);
    }
  }, []);

  const handleCreateCanvas = useCallback(async () => {
    if (canvasCreating) return;
    setCanvasCreating(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/canvases', { method: 'POST' });
      await fetchCanvases();
      setSelectedCanvasId(created.id);
    } catch {
      /* silent */
    } finally {
      setCanvasCreating(false);
    }
  }, [canvasCreating, fetchCanvases]);

  useEffect(() => {
    if (showCanvas) fetchCanvases();
  }, [showCanvas, fetchCanvases]);

  /* ── Canvas: fetch specific canvas data ── */
  const fetchCanvasData = useCallback(async (id: string) => {
    setCanvasDataLoading(true);
    try {
      const data = await apiFetch<CanvasData>(`/api/canvases/${id}`);
      setCanvasData(data);
    } catch {
      /* silent */
    } finally {
      setCanvasDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCanvasId) fetchCanvasData(selectedCanvasId);
    else setCanvasData(null);
  }, [selectedCanvasId, fetchCanvasData]);

  // Sync templateId when canvas loads or cols/rows change
  useEffect(() => {
    if (canvasData) {
      setSelectedTemplateId(colsRowsToTemplateId(canvasData.cols, canvasData.rows));
    }
  }, [canvasData?.id, canvasData?.cols, canvasData?.rows]);

  /* ── Canvas: slot management ── */
  const handleAssignSlot = useCallback(
    async (slotIndex: number, assignSessionId: string) => {
      if (!selectedCanvasId) return;
      try {
        await apiFetch(`/api/canvases/${selectedCanvasId}/slots/${slotIndex}`, {
          method: 'PUT',
          body: JSON.stringify({ sessionId: assignSessionId }),
        });
        setCanvasData((prev) =>
          prev ? { ...prev, slots: { ...prev.slots, [slotIndex]: assignSessionId } } : prev,
        );
      } catch {
        /* silent */
      }
    },
    [selectedCanvasId],
  );

  const handleClearSlot = useCallback(
    async (slotIndex: number) => {
      if (!selectedCanvasId) return;
      try {
        await apiFetch(`/api/canvases/${selectedCanvasId}/slots/${slotIndex}`, { method: 'DELETE' });
        setCanvasData((prev) =>
          prev ? { ...prev, slots: { ...prev.slots, [slotIndex]: null } } : prev,
        );
      } catch {
        /* silent */
      }
    },
    [selectedCanvasId],
  );

  const handleCanvasLayoutChange = useCallback(
    async (cols: number, rows: number) => {
      if (!selectedCanvasId) return;
      try {
        const updated = await apiFetch<CanvasData>(`/api/canvases/${selectedCanvasId}`, {
          method: 'PUT',
          body: JSON.stringify({ cols, rows }),
        });
        setCanvasData(updated);
      } catch {
        /* silent */
      }
    },
    [selectedCanvasId],
  );

  /* ── Canvas: layout preset selection ── */
  const handleLayoutPreset = useCallback(
    async (cols: number, rows: number) => {
      const templateId = colsRowsToTemplateId(cols, rows);
      setSelectedTemplateId(templateId);
      await handleCanvasLayoutChange(cols, rows);
    },
    [handleCanvasLayoutChange],
  );

  /* ── Canvas: session creation (used by CanvasGrid/CanvasMobile) ── */
  const handleCanvasCreateSession = useCallback((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPickerResolver(() => resolve);
    }).then(async (projectId) => {
      if (!projectId) return null;
      try {
        const dims = estimateDims();
        const created = await apiFetch<{ sessionId: string }>(
          `/api/projects/${projectId}/sessions`,
          { method: 'POST', body: JSON.stringify({ cols: dims.cols, rows: dims.rows }) },
        );
        window.dispatchEvent(new Event('sessions-changed'));
        return created.sessionId;
      } catch {
        return null;
      }
    });
  }, []);

  /* ── Header rename state ── */
  const [headerRenaming, setHeaderRenaming] = useState(false);
  const [headerRenameValue, setHeaderRenameValue] = useState('');
  const [headerRenameOriginal, setHeaderRenameOriginal] = useState('');
  const headerRenameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerRenaming && headerRenameRef.current) {
      headerRenameRef.current.focus();
      headerRenameRef.current.select();
    }
  }, [headerRenaming]);

  const startHeaderRename = useCallback(() => {
    if (!sessionName) return;
    setHeaderRenameValue(sessionName);
    setHeaderRenameOriginal(sessionName);
    setHeaderRenaming(true);
  }, [sessionName]);

  const commitHeaderRename = useCallback(() => {
    const trimmed = headerRenameValue.trim();
    if (sessionId && trimmed && trimmed !== headerRenameOriginal) {
      handleRename(sessionId, trimmed);
    }
    setHeaderRenaming(false);
  }, [headerRenameValue, headerRenameOriginal, sessionId, handleRename]);

  const isConnected = connStatus === 'connected';
  const isConnecting = connStatus === 'connecting' || connStatus === 'reconnecting';

  return (
    <div
      className="flex flex-col overflow-hidden bg-[#0a0a0f]"
      style={{ height: `${viewportHeight}px` }}
    >
      {/* ══ Header — adapts to mode: terminal / canvas-hub / canvas-embed ══ */}
      <header className="flex shrink-0 items-center justify-between gap-[8px] border-b border-white/[0.06] bg-[#0a0a0f]/80 px-[12px] py-[10px] backdrop-blur-md sm:px-[18px]">
        {/* Left: back + rail toggle + mode-specific breadcrumb */}
        <div className="flex min-w-0 items-center gap-[8px]">
          <button
            onClick={() => navigate('/sessions')}
            className="flex shrink-0 items-center gap-[5px] rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#9aa3ad] backdrop-blur-md transition-colors hover:border-white/[0.14] hover:text-[#f0f0f0]"
            title="Voltar para Sessions"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Sessions</span>
          </button>

          {!railOpen && (
            <button
              onClick={() => persistRail(true)}
              className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.03] text-[#9aa3ad] backdrop-blur-md transition-colors hover:border-white/[0.14] hover:text-[#f0f0f0]"
              title="Mostrar sessões"
              aria-label="Mostrar lista de sessões"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {showCanvas && selectedCanvasId && canvasData ? (
            /* Canvas embed: ← Canvas / name */
            <>
              <button
                onClick={() => setSelectedCanvasId(null)}
                className="flex shrink-0 items-center gap-[4px] font-['Inter'] text-[12px] text-[#5a626c] hover:text-[#9aa3ad] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Canvas
              </button>
              <span className="shrink-0 font-['Inter'] text-[13px] text-[#334]">/</span>
              <span className="min-w-0 max-w-[180px] truncate font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">
                {canvasData.name}
              </span>
            </>
          ) : showCanvas ? (
            /* Canvas hub */
            <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">Canvas</span>
          ) : (
            /* Terminal: project / session + rename + status dot */
            <>
              {projectName && (
                <>
                  <span className="hidden max-w-[140px] truncate font-['Inter'] text-[13px] text-[#5a626c] sm:inline">
                    {projectName}
                  </span>
                  <span className="hidden shrink-0 font-['Inter'] text-[13px] text-[#334] sm:inline">/</span>
                </>
              )}
              {headerRenaming ? (
                <input
                  ref={headerRenameRef}
                  value={headerRenameValue}
                  onChange={(e) => setHeaderRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitHeaderRename(); }
                    else if (e.key === 'Escape') setHeaderRenaming(false);
                  }}
                  onBlur={commitHeaderRename}
                  className="min-w-0 max-w-[160px] rounded-[5px] border border-[rgba(179,229,2,0.3)] bg-[#0a0a0f] px-[8px] py-[3px] font-['Inter'] text-[13px] font-semibold text-[#f0f0f0] outline-none"
                />
              ) : (
                <div className="group flex min-w-0 items-center gap-[4px]">
                  <span className="min-w-0 max-w-[140px] truncate font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">
                    {sessionName || 'Session'}
                  </span>
                  {sessionName && (
                    <button
                      onClick={startHeaderRename}
                      className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] text-[#5a626c] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.06)] hover:text-[#9aa3ad] transition-all"
                      title="Renomear sessão"
                    >
                      <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                        <path d="M7.5 1.5l2 2L3.5 9.5H1.5V7.5L7.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              <span
                className={`size-[6px] shrink-0 rounded-full transition-colors ${
                  isConnected ? 'bg-[#22dd88]' : isConnecting ? 'bg-[#ffaa00] animate-pulse' : 'bg-[#445]'
                }`}
                style={isConnected ? { boxShadow: '0 0 6px rgba(34,221,136,0.5)' } : undefined}
              />
            </>
          )}
        </div>

        {/* Right: mode-specific actions */}
        <div className="flex items-center gap-[6px] shrink-0 ml-[8px]">
          {showCanvas && selectedCanvasId && canvasData ? (
            /* Canvas embed: layout presets (desktop) + New Session */
            <>
              {!isMobile && (
                <>
                  {[
                    { cols: 1, rows: 1, label: '1×1' },
                    { cols: 2, rows: 1, label: '2×1' },
                    { cols: 3, rows: 1, label: '3×1' },
                    { cols: 4, rows: 1, label: '4×1' },
                  ].map((opt) => {
                    const active = canvasData.cols === opt.cols && canvasData.rows === opt.rows;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => handleLayoutPreset(opt.cols, opt.rows)}
                        className={`rounded-[5px] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                            : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <div className="h-[14px] w-px bg-white/[0.08]" />
                  {[
                    { cols: 2, rows: 2, label: '2×2' },
                    { cols: 3, rows: 2, label: '3×2' },
                    { cols: 4, rows: 2, label: '4×2' },
                  ].map((opt) => {
                    const active = canvasData.cols === opt.cols && canvasData.rows === opt.rows;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => handleLayoutPreset(opt.cols, opt.rows)}
                        className={`rounded-[5px] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                            : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <div className="mx-[2px] h-[16px] w-px bg-white/[0.08]" />
                </>
              )}
              <button
                onClick={() => setShowProjectPicker(true)}
                title="Nova sessão"
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(179,229,2,0.2)] bg-[rgba(179,229,2,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#b3e502] hover:bg-[rgba(179,229,2,0.14)] transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
            </>
          ) : showCanvas ? (
            /* Canvas hub: create canvas + new session */
            <>
              <button
                onClick={handleCreateCanvas}
                disabled={canvasCreating}
                className="kb-sheen relative flex items-center gap-[5px] overflow-hidden rounded-[8px] bg-[#b3e502] px-[10px] py-[4px] font-['Inter'] text-[12px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] disabled:opacity-50"
              >
                {canvasCreating ? (
                  <div className="size-[10px] animate-spin rounded-full border-[1.5px] border-[#0a0a0f] border-t-transparent" />
                ) : (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                )}
                <span className="hidden sm:inline">Novo Canvas</span>
              </button>
              <button
                onClick={() => setShowProjectPicker(true)}
                title="Nova sessão"
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(179,229,2,0.2)] bg-[rgba(179,229,2,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#b3e502] hover:bg-[rgba(179,229,2,0.14)] transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
            </>
          ) : (
            /* Terminal: new session + reconnect + fit + kill */
            <>
              <button
                onClick={() => setShowProjectPicker(true)}
                title="Nova sessão"
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(179,229,2,0.2)] bg-[rgba(179,229,2,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#b3e502] hover:bg-[rgba(179,229,2,0.14)] transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
              <button
                onClick={() => termRef.current?.reconnect()}
                title="Reconnect"
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(34,221,136,0.2)] bg-[rgba(34,221,136,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#2d8] hover:bg-[rgba(34,221,136,0.14)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M10.5 6A4.5 4.5 0 1 1 7.5 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M7.5 1.5l1.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Reconnect</span>
              </button>
              <button
                onClick={handleFit}
                title="Fit terminal layout"
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(100,160,255,0.2)] bg-[rgba(100,160,255,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#6af] hover:bg-[rgba(100,160,255,0.14)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">Fit</span>
              </button>
              <button
                onClick={handleKill}
                disabled={killing}
                title={killing ? 'Killing…' : 'Kill'}
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(255,85,102,0.2)] bg-[rgba(255,85,102,0.15)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#f56] hover:bg-[rgba(255,85,102,0.22)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">{killing ? 'Killing…' : 'Kill'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ══ Body: rail + terminal ══ */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop rail */}
        {railOpen && !isMobile && (
          <aside className="w-[240px] shrink-0 border-r border-white/[0.06]">
            <SessionRail
              groups={groups}
              activeSessionId={sessionId}
              onSelect={handleSelect}
              onClose={() => persistRail(false)}
              onCreateSession={handleCreateSession}
              creating={creating}
              onRename={handleRename}
              isMobile={false}
              showCanvas={showCanvas}
              onSelectCanvas={() => {
                setShowCanvas(true);
                setSelectedCanvasId(null);
                if (isMobile) persistRail(false);
              }}
              canvasLabel={canvasData?.name}
            />
          </aside>
        )}

        {/* Mobile rail drawer */}
        {railOpen && isMobile && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm"
              onClick={() => persistRail(false)}
            />
            <aside className="absolute inset-y-0 left-0 z-30 w-[260px] border-r border-white/[0.06] shadow-2xl">
              <SessionRail
                groups={groups}
                activeSessionId={sessionId}
                onSelect={handleSelect}
                onClose={() => persistRail(false)}
                onCreateSession={handleCreateSession}
                creating={creating}
                onRename={handleRename}
                isMobile
                showCanvas={showCanvas}
                onSelectCanvas={() => {
                  setShowCanvas(true);
                  setSelectedCanvasId(null);
                  if (isMobile) persistRail(false);
                }}
                canvasLabel={canvasData?.name}
              />
            </aside>
          </>
        )}

        {/* Terminal OR Canvas */}
        {showCanvas && selectedCanvasId && canvasData ? (
          /* ══ Embedded canvas view ══ */
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 overflow-hidden">
              {isMobile ? (
                <CanvasMobile
                  ref={canvasMobileRef}
                  projectId={canvasData.id}
                  sessions={sessions}
                  fontSize={fontSize}
                  theme={getThemeById(themeId).xterm}
                  onCreateSession={handleCanvasCreateSession}
                  onKill={async (sid) => {
                    try {
                      await apiFetch(`/api/sessions/${sid}`, { method: 'DELETE' });
                      window.dispatchEvent(new Event('sessions-changed'));
                    } catch {
                      /* silent */
                    }
                  }}
                  onRename={async (sid, name) => handleRename(sid, name)}
                  projectName={canvasData.name}
                  onToggleSidebar={() => persistRail(true)}
                  externalSlots={Array.from({ length: 8 }, (_, i) => {
                    const liveIds = new Set(sessions.map((s) => s.sessionId));
                    const sid = canvasData.slots[i] ?? null;
                    return sid && liveIds.has(sid) ? sid : null;
                  })}
                  onAssignSlot={async (idx, sid) => {
                    const capacity = canvasData.cols * canvasData.rows;
                    if (idx >= capacity) {
                      const newCols = idx <= 3 ? 2 : idx <= 5 ? 3 : 4;
                      await handleCanvasLayoutChange(newCols, 2);
                    }
                    await handleAssignSlot(idx, sid);
                  }}
                  onClearSlot={handleClearSlot}
                />
              ) : (
                <CanvasGrid
                  key={`${canvasData.id}-${selectedTemplateId}`}
                  templateId={selectedTemplateId}
                  storageKey={canvasData.id}
                  slots={(() => {
                    const liveIds = new Set(sessions.map((s) => s.sessionId));
                    const templateSlots = getTemplate(selectedTemplateId).slots;
                    const rec: Record<string, string | null> = {};
                    templateSlots.forEach((slotId, i) => {
                      const sid = canvasData.slots[i] ?? null;
                      rec[slotId] = sid && liveIds.has(sid) ? sid : null;
                    });
                    return rec;
                  })()}
                  sessions={sessions}
                  fontSize={fontSize}
                  theme={getThemeById(themeId).xterm}
                  onAssign={(slotId, sid) =>
                    handleAssignSlot(slotId.charCodeAt(0) - 97, sid)
                  }
                  onRemove={(slotId) =>
                    handleClearSlot(slotId.charCodeAt(0) - 97)
                  }
                  onKill={async (sid) => {
                    try {
                      await apiFetch(`/api/sessions/${sid}`, { method: 'DELETE' });
                      window.dispatchEvent(new Event('sessions-changed'));
                    } catch {
                      /* silent */
                    }
                  }}
                  onCreateSession={handleCanvasCreateSession}
                  onRename={async (sid, name) => handleRename(sid, name)}
                />
              )}
            </div>
          </div>
        ) : showCanvas ? (
          /* ══ Canvas hub/list ══ */
          <div className="relative min-w-0 flex-1 overflow-hidden overflow-y-auto bg-[#0a0a0f]">
            {/* Canvas list */}
            <div className="p-[16px]">
              {canvasesLoading ? (
                <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[80px] animate-pulse rounded-[12px] border border-white/[0.06] bg-white/[0.03]" />
                  ))}
                </div>
              ) : canvases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-[60px] text-center">
                  <div className="mb-[14px] flex size-[52px] items-center justify-center rounded-[16px] border border-white/[0.08] bg-white/[0.03]">
                    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" className="text-[#b3e502]">
                      <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                      <rect x="8.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                      <rect x="1.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                      <rect x="8.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                    </svg>
                  </div>
                  <h3 className="font-['Syne'] text-[17px] font-bold text-white">Nenhum canvas</h3>
                  <p className="mt-[5px] max-w-[220px] font-['Inter'] text-[12px] text-[#5a626c]">
                    Crie um canvas para organizar terminais
                  </p>
                  <button
                    onClick={handleCreateCanvas}
                    disabled={canvasCreating}
                    className="mt-[16px] flex items-center gap-[5px] rounded-[9px] bg-[#b3e502] px-[16px] py-[9px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516] disabled:opacity-50"
                  >
                    Criar Canvas
                  </button>
                </div>
              ) : (
                <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                  {canvases.map((canvas, i) => (
                    <div
                      key={canvas.id}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      className="kb-rise group relative isolate flex cursor-pointer flex-col gap-[8px] overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.03] p-[12px] transition-[transform,border-color,background-color] duration-200 hover:-translate-y-[2px] hover:border-[#b3e502]/25 hover:bg-white/[0.05]"
                      onClick={() => setSelectedCanvasId(canvas.id)}
                    >
                      <span aria-hidden className="absolute inset-y-[10px] left-0 w-[2px] rounded-r-full bg-[#b3e502] opacity-0 transition-opacity duration-200 group-hover:opacity-70" />
                      <span className="truncate font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">{canvas.name}</span>
                      <div className="flex items-center gap-[5px]">
                        <span className="rounded-[4px] border border-white/[0.07] bg-[rgba(255,255,255,0.04)] px-[6px] py-[2px] font-['JetBrains_Mono'] text-[10px] text-[#9aa3ad]">
                          {canvas.cols}×{canvas.rows}
                        </span>
                        <span className="rounded-[4px] border border-white/[0.07] bg-[rgba(255,255,255,0.04)] px-[6px] py-[2px] font-['Inter'] text-[10px] text-[#667]">
                          {canvas.slotCount}/{canvas.totalSlots}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ══ Terminal ══ */
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {sessionId && (
              <XTermTerminal
                key={sessionId}
                ref={termRef}
                sessionId={sessionId}
                onResize={handleResize}
                onConnectionStatus={setConnStatus}
                fontSize={fontSize}
                theme={getThemeById(themeId).xterm}
                className="absolute inset-0"
              />
            )}
          </div>
        )}
      </div>

      {/* ══ Standard bottom bar ══ */}
      <TerminalStatusBar
        connectionStatus={connStatus}
        sessionCreatedAt={activeSession?.createdAt ?? null}
        sessionName={sessionName}
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
              onKey={(seq) => termRef.current?.sendKey(seq)}
              onSelectAll={() => termRef.current?.selectAll()}
              onCopy={() => {
                const sel = termRef.current?.getSelection() ?? '';
                if (sel) navigator.clipboard.writeText(sel).catch(() => {});
              }}
              onPaste={() => {
                navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (text) termRef.current?.sendKey(text);
                  })
                  .catch(() => {});
              }}
            />
          ) : undefined
        }
      />

      {/* ══ Project Picker Modal ══ */}
      {showProjectPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowProjectPicker(false)}
        >
          <div
            className="relative mx-[16px] w-full max-w-sm rounded-[16px] border border-white/[0.08] bg-[#111118] p-[20px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowProjectPicker(false)}
              className="absolute right-[14px] top-[14px] flex size-[24px] items-center justify-center rounded-[6px] text-[#5a626c] hover:bg-white/[0.06] hover:text-[#9aa3ad] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            <h3 className="font-['Syne'] text-[18px] font-bold text-white">Nova Sessão</h3>
            <p className="mt-[4px] font-['Inter'] text-[12px] text-[#5a626c]">Escolha o projeto</p>

            <div className="mt-[14px] max-h-[320px] space-y-[4px] overflow-y-auto">
              {allProjects.length === 0 ? (
                <p className="py-[20px] text-center font-['Inter'] text-[13px] text-[#5a626c]">
                  Nenhum projeto encontrado
                </p>
              ) : (
                allProjects.map((p) => {
                  const isCreating = creating === p.id;
                  const activeSessions = groups.find((g) => g.project.id === p.id)?.sessions.length ?? 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        handleCreateSession(p.id);
                        setShowProjectPicker(false);
                      }}
                      disabled={!!creating}
                      className="flex w-full items-center justify-between rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-[14px] py-[11px] font-['Inter'] text-[13px] font-medium text-[#e6e8eb] transition-all hover:border-[#b3e502]/30 hover:bg-[rgba(179,229,2,0.05)] hover:text-white disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-left">{p.name}</span>
                      <div className="ml-[8px] flex shrink-0 items-center gap-[8px]">
                        {activeSessions > 0 && (
                          <span className="flex items-center gap-[3px] font-['JetBrains_Mono'] text-[10px] text-[#22dd88]">
                            <span className="size-[4px] rounded-full bg-[#22dd88] animate-pulse" />
                            {activeSessions}
                          </span>
                        )}
                        {isCreating ? (
                          <div className="size-[12px] animate-spin rounded-full border border-[#b3e502] border-t-transparent" />
                        ) : (
                          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-[#445566]">
                            <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Canvas session picker (for CanvasGrid/CanvasMobile slot creation) ══ */}
      {pickerResolver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            const r = pickerResolver;
            setPickerResolver(null);
            r(null);
          }}
        >
          <div
            className="relative mx-[16px] w-full max-w-sm rounded-[16px] border border-white/[0.08] bg-[#111118] p-[20px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const r = pickerResolver;
                setPickerResolver(null);
                r(null);
              }}
              className="absolute right-[14px] top-[14px] flex size-[24px] items-center justify-center rounded-[6px] text-[#5a626c] hover:bg-white/[0.06] hover:text-[#9aa3ad] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <h3 className="font-['Syne'] text-[18px] font-bold text-white">Nova Sessão</h3>
            <p className="mt-[4px] font-['Inter'] text-[12px] text-[#5a626c]">Escolha o projeto para o slot</p>
            <div className="mt-[14px] max-h-[320px] space-y-[4px] overflow-y-auto">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    const r = pickerResolver;
                    setPickerResolver(null);
                    r(p.id);
                  }}
                  className="flex w-full items-center justify-between rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-[14px] py-[11px] font-['Inter'] text-[13px] font-medium text-[#e6e8eb] transition-all hover:border-[#b3e502]/30 hover:bg-[rgba(179,229,2,0.05)] hover:text-white"
                >
                  <span className="min-w-0 truncate text-left">{p.name}</span>
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0 text-[#445566]">
                    <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
