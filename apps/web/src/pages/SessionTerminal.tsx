import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { apiFetch } from '../lib/api';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';
import { useSessionEvents } from '../hooks/useSessionEvents';
import RecoverConversationModal from '../components/RecoverConversationModal';
import CanvasPickerModal from '../components/CanvasPickerModal';
import { StatusGlyph, type GlyphStatus } from '../components/ui';

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

function isValidProjectId(id: unknown): id is string {
  return (
    !!id && typeof id === 'string' && id !== 'undefined' && id !== 'null' && id.trim().length > 0
  );
}

function colsRowsToTemplateId(cols: number, rows: number): string {
  if (cols === 1 && rows === 1) return 'single';
  if (cols === 1 && rows === 2) return '2row';
  if (cols === 2 && rows === 1) return '2col';
  if (cols === 3 && rows === 1) return '3col';
  if (cols === 4 && rows === 1) return '4col';
  if (cols === 2 && rows === 2) return '2x2';
  if (cols === 3 && rows === 2) return '3x2';
  if (cols === 4 && rows === 2) return '4x2';
  return '2col';
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

/* ── Session status → rail glyph ──
   active = amber ring+fill (live/working), waiting = hollow amber (needs
   input), everything else = idle gray. Green stays reserved for done/success. */
function sessionGlyph(status: string): GlyphStatus {
  if (status === 'active') return 'active';
  if (status === 'waiting') return 'waiting';
  return 'idle';
}

/* ── Session rail (master list) ── */

function SessionRail({
  groups,
  activeSessionId,
  onSelect,
  onClose,
  onCreateSession,
  onRecover,
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
  onRecover: (projectId: string) => void;
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
    <div className="flex h-full min-h-0 w-full flex-col bg-void">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-3">
          Sessions
        </span>
        <button
          onClick={onClose}
          className="flex size-[24px] items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink-2"
          title={isMobile ? 'Fechar' : 'Recolher'}
          aria-label="Recolher lista de sessões"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M8 2L4 6L8 10"
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
          <p className="px-[14px] py-[10px] text-[12px] text-ink-3">
            Nenhuma sessão ativa.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.project.id} className="mb-[6px]">
            <div className="flex items-center justify-between px-[14px] py-[5px]">
              <span className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.7px] text-ink-3">
                {g.project.name}
              </span>
              <div className="flex items-center gap-[2px]">
                <button
                  onClick={() => onRecover(g.project.id)}
                  className="flex size-[20px] items-center justify-center rounded-[4px] text-ink-3 hover:bg-accent/10 hover:text-accent transition-all"
                  title={`Recover conversation in ${g.project.name}`}
                >
                  <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                    <path d="M2.5 6.5A4 4 0 1 0 4 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <path d="M2.5 2v2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  onClick={() => onCreateSession(g.project.id)}
                  disabled={creating === g.project.id}
                  className="flex size-[20px] items-center justify-center rounded-[4px] text-ink-3 hover:bg-accent/10 hover:text-accent transition-all disabled:opacity-40"
                  title={`New session in ${g.project.name}`}
                >
                  {creating === g.project.id ? (
                    <div className="size-[8px] animate-spin rounded-full border border-accent border-t-transparent" />
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {g.sessions.map((s) => {
              const glyph = sessionGlyph(s.status);
              const isActive = s.sessionId === activeSessionId && !showCanvas;
              const isRenaming = renamingId === s.sessionId;
              return isRenaming ? (
                <div
                  key={s.sessionId}
                  className={`flex w-full items-center gap-[8px] px-[14px] py-[6px] border-l-2 ${
                    isActive ? 'border-accent bg-accent/[0.08]' : 'border-transparent'
                  }`}
                >
                  <StatusGlyph status={glyph} size="sm" pulse={glyph === 'active'} />
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      else if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={commitRename}
                    className="min-w-0 flex-1 rounded-[4px] border border-accent/30 bg-black/40 px-[6px] py-[2px] text-[13px] text-ink outline-none"
                  />
                </div>
              ) : (
                <div
                  key={s.sessionId}
                  className={`group flex w-full items-center gap-[8px] pl-[14px] pr-[6px] py-[8px] text-[13px] transition-colors ${
                    isActive
                      ? 'border-l-2 border-accent bg-accent/[0.08] text-ink'
                      : 'border-l-2 border-transparent text-ink-2 hover:bg-white/[0.04] hover:text-ink'
                  }`}
                >
                  <button
                    onClick={() => onSelect(s)}
                    className="flex min-w-0 flex-1 items-center gap-[8px] text-left"
                  >
                    <StatusGlyph status={glyph} size="sm" pulse={glyph === 'active'} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(s); }}
                    className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] text-ink-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-white/[0.06] hover:text-ink-2 transition-all"
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

      {/* Canvas nav item — like ProjectDetail. Hidden on mobile: canvas multi-terminal
          is desktop-only; mobile just switches between sessions. */}
      <div className={`shrink-0 border-t border-hairline py-[6px] ${isMobile ? 'hidden' : ''}`}>
        <button
          onClick={onSelectCanvas}
          className={`flex w-full items-center gap-[8px] border-l-2 px-[14px] py-[9px] text-[13px] font-medium transition-colors ${
            showCanvas
              ? 'border-accent bg-accent/[0.08] text-ink'
              : 'border-transparent text-ink-2 hover:bg-white/[0.04] hover:text-ink'
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

/* ── Canvas hub card (with rename + delete) ── */

function CanvasHubCard({
  canvas,
  index,
  onSelect,
  onRename,
  onDelete,
}: {
  canvas: CanvasItem;
  index: number;
  onSelect: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(canvas.name);
      setEditing(true);
    },
    [canvas.name],
  );

  const saveEdit = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== canvas.name) onRename(canvas.id, trimmed);
  }, [editValue, canvas.id, canvas.name, onRename]);

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className="group relative flex cursor-pointer flex-col gap-[8px] rounded-panel border border-hairline bg-surface p-[12px] transition-colors duration-150 hover:border-hairline-strong"
      onClick={() => !editing && !confirmDelete && onSelect()}
    >
      <span aria-hidden className="absolute inset-y-[10px] left-0 w-[2px] rounded-r-full bg-accent opacity-0 transition-opacity duration-200 group-hover:opacity-70" />
      <div className="flex items-center gap-[6px] min-w-0">
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={saveEdit}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded-control border border-accent/30 bg-white/[0.06] px-[6px] py-[3px] text-[13px] font-semibold text-ink outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
            {canvas.name}
          </span>
        )}

        {!editing && !confirmDelete && (
          <div className="flex shrink-0 items-center gap-[2px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={startEdit}
              className="flex size-[22px] items-center justify-center rounded-control text-ink-3 hover:bg-accent/10 hover:text-accent transition-colors"
              aria-label="Renomear canvas"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="flex size-[22px] items-center justify-center rounded-control text-ink-3 hover:bg-danger/10 hover:text-danger transition-colors"
              aria-label="Deletar canvas"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                <path d="M1 3h9M4 3V2h3v1M2 3l.8 7h5.4L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {!editing && confirmDelete && (
          <div className="flex shrink-0 items-center gap-[5px]" onClick={(e) => e.stopPropagation()}>
            <button
              className="rounded-control bg-danger px-[7px] py-[2px] text-[11px] font-medium text-white hover:bg-danger/80 transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(canvas.id); }}
            >
              Sim
            </button>
            <button
              className="rounded-control bg-white/[0.08] px-[7px] py-[2px] text-[11px] text-ink-2 hover:bg-white/[0.12] transition-colors"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
            >
              Não
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-[5px]">
        <span className="rounded-[4px] border border-hairline bg-white/[0.04] px-[6px] py-[2px] font-['JetBrains_Mono'] text-[10px] text-ink-2">
          {canvas.cols}×{canvas.rows}
        </span>
        <span className="rounded-[4px] border border-hairline bg-white/[0.04] px-[6px] py-[2px] text-[10px] text-ink-3">
          {canvas.slotCount}/{canvas.totalSlots}
        </span>
      </div>
    </div>
  );
}

/* ── Page: Sessions Workspace (master-detail, no global sidebar) ── */

export default function SessionTerminalPage() {
  const navigate = useNavigate();
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const [searchParams] = useSearchParams();
  const canvasParam = searchParams.get('canvas');
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

  // Global session-events channel — replaces the old 15s HTTP poll.
  const { onSessionEvent } = useSessionEvents();

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
    // Push-based sync: re-fetch on any server-reported session change (<1s).
    const unsubscribe = onSessionEvent(() => fetchAll());
    // Fallback safety net (deprecated, kept for 1 release) — spec Risk #4.
    const handler = () => fetchAll();
    window.addEventListener('sessions-changed', handler);
    return () => {
      unsubscribe();
      window.removeEventListener('sessions-changed', handler);
    };
  }, [fetchAll, onSessionEvent]);

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

  // Corrective re-sync on session open/switch — mirrors CanvasSlot. resize()
  // bundles re-fit + dedup-busting SIGWINCH + atlas rebuild. Two shots: 500ms
  // fixes boot/layout size mismatch; 1.8s covers a TUI that was busy mid-task
  // and ignored the first SIGWINCH.
  useEffect(() => {
    if (!sessionId) return;
    const t0 = setTimeout(() => termRef.current?.resize(), 500);
    const t1 = setTimeout(() => termRef.current?.resize(), 1800);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [sessionId]);

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
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false);
  const [canvasRenaming, setCanvasRenaming] = useState(false);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [canvases, setCanvases] = useState<CanvasItem[]>([]);
  const [canvasesLoading, setCanvasesLoading] = useState(false);
  const [canvasCreating, setCanvasCreating] = useState(false);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [, setCanvasDataLoading] = useState(false);
  const [panelResetKey, setPanelResetKey] = useState(0);
  type PickerResolver = (projectId: string | null) => void;
  const [pickerResolver, setPickerResolver] = useState<PickerResolver | null>(null);
  const canvasMobileRef = useRef<CanvasMobileHandle | null>(null);

  /* ── Canvas is route-driven: ?canvas=<id> on /sessions is the source of truth.
        Opening a canvas leaves the session route, so the session is no longer the
        active section; terminals keep running in tmux regardless.
        Canvas is desktop-only — on mobile we strip the param and stay in session mode. ── */
  useEffect(() => {
    if (canvasParam && isMobile) {
      navigate('/sessions', { replace: true });
      return;
    }
    setShowCanvas(!!canvasParam);
    setSelectedCanvasId(canvasParam);
  }, [canvasParam, isMobile, navigate]);

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

  const [recoverModalOpen, setRecoverModalOpen] = useState(false);
  const [recoverProjectId, setRecoverProjectId] = useState<string | null>(null);

  const handleOpenRecover = useCallback((projectId: string) => {
    setRecoverProjectId(projectId);
    setRecoverModalOpen(true);
  }, []);

  const handleRecover = useCallback(
    async (projectId: string, conversationId: string, sessionName: string, agentType: 'claude' | 'opencode') => {
      const session = await apiFetch<{ sessionId: string }>(
        `/api/projects/${projectId}/sessions`,
        {
          method: 'POST',
          body: JSON.stringify({ name: sessionName, resumeConversationId: conversationId, agentType }),
        },
      );
      window.dispatchEvent(new Event('sessions-changed'));
      setRecoverModalOpen(false);
      navigate(`/sessions/${projectId}/${session.sessionId}`);
    },
    [navigate],
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

  const handleRenameCanvas = useCallback(async (id: string, name: string) => {
    setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    setCanvasData((prev) => (prev && prev.id === id ? { ...prev, name } : prev));
    try {
      await apiFetch(`/api/canvases/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
    } catch {
      /* next fetch reverts */
    }
  }, []);

  const handleDeleteCanvas = useCallback(
    async (id: string) => {
      setCanvases((prev) => prev.filter((c) => c.id !== id));
      if (selectedCanvasId === id) setSelectedCanvasId(null);
      try {
        await apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
      } catch {
        /* silent */
      }
    },
    [selectedCanvasId],
  );

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
      className="relative flex flex-col overflow-hidden bg-bg"
      style={{ height: `${viewportHeight}px` }}
    >

      {/* ══ Header — adapts to mode: terminal / canvas-hub / canvas-embed ══ */}
      <header className="vibrancy relative z-10 flex shrink-0 items-center justify-between gap-[8px] border-b border-hairline px-[12px] py-[10px] sm:px-[18px]">
        {/* Left: back + rail toggle + mode-specific breadcrumb */}
        <div className="flex min-w-0 items-center gap-[8px]">
          <button
            onClick={() => navigate('/projects')}
            className="flex shrink-0 items-center gap-[5px] rounded-control border border-hairline bg-white/[0.03] px-[10px] py-[5px] text-[12px] font-medium text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink"
            title="Voltar para Projects"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Projects</span>
          </button>

          {!railOpen && (
            <button
              onClick={() => persistRail(true)}
              className="flex size-[30px] shrink-0 items-center justify-center rounded-control border border-hairline bg-white/[0.03] text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink"
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
                onClick={() => setCanvasPickerOpen(true)}
                title="Trocar de canvas"
                className="flex shrink-0 items-center gap-[4px] rounded-control px-[6px] py-[3px] text-[12px] text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink-2"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                Canvas
              </button>
              <span className="shrink-0 text-[13px] text-ink-4">/</span>
              {canvasRenaming ? (
                <input
                  autoFocus
                  value={canvasRenameValue}
                  onChange={(e) => setCanvasRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = canvasRenameValue.trim();
                      if (v && v !== canvasData.name) handleRenameCanvas(canvasData.id, v);
                      setCanvasRenaming(false);
                    } else if (e.key === 'Escape') {
                      setCanvasRenaming(false);
                    }
                  }}
                  onBlur={() => {
                    const v = canvasRenameValue.trim();
                    if (v && v !== canvasData.name) handleRenameCanvas(canvasData.id, v);
                    setCanvasRenaming(false);
                  }}
                  className="min-w-0 max-w-[180px] rounded-[4px] border border-accent/30 bg-black/40 px-[6px] py-[2px] text-[13px] font-semibold text-ink outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setCanvasRenameValue(canvasData.name);
                    setCanvasRenaming(true);
                  }}
                  title="Renomear canvas"
                  className="min-w-0 max-w-[180px] truncate rounded-[4px] px-[4px] py-[2px] text-[13px] font-semibold text-ink transition-colors hover:bg-white/[0.06]"
                >
                  {canvasData.name}
                </button>
              )}
            </>
          ) : showCanvas ? (
            /* Canvas hub */
            <span className="text-[13px] font-semibold text-ink">Canvas</span>
          ) : (
            /* Terminal: project / session + rename + status dot */
            <>
              {projectName && (
                <>
                  <span className="hidden max-w-[140px] truncate text-[13px] text-ink-3 sm:inline">
                    {projectName}
                  </span>
                  <span className="hidden shrink-0 text-[13px] text-ink-4 sm:inline">/</span>
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
                  className="min-w-0 max-w-[160px] rounded-control border border-accent/30 bg-black/40 px-[8px] py-[3px] text-[13px] font-semibold text-ink outline-none"
                />
              ) : (
                <div className="group flex min-w-0 items-center gap-[4px]">
                  <span className="min-w-0 max-w-[140px] truncate text-[13px] font-semibold text-ink">
                    {sessionName || (sessionId ? 'Session' : 'Sessions')}
                  </span>
                  {sessionName && (
                    <button
                      onClick={startHeaderRename}
                      className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] text-ink-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-white/[0.06] hover:text-ink-2 transition-all"
                      title="Renomear sessão"
                    >
                      <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                        <path d="M7.5 1.5l2 2L3.5 9.5H1.5V7.5L7.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              {sessionId && (
                <span
                  className={`size-[6px] shrink-0 rounded-full transition-colors ${
                    isConnected ? 'bg-success' : isConnecting ? 'bg-ink-3 animate-pulse' : 'bg-ink-4'
                  }`}
                                  />
              )}
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
                  {/* Single-row group: max vertical space */}
                  {[
                    { cols: 1, rows: 1, label: '1×1' },
                    { cols: 2, rows: 1, label: '1×2' },
                    { cols: 3, rows: 1, label: '1×3' },
                    { cols: 4, rows: 1, label: '1×4' },
                  ].map((opt) => {
                    const active = canvasData.cols === opt.cols && canvasData.rows === opt.rows;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => handleCanvasLayoutChange(opt.cols, opt.rows)}
                        className={`rounded-control px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                          active
                            ? 'border border-accent/30 bg-accent/12 text-accent'
                            : 'border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <div className="h-[14px] w-px bg-hairline" />
                  {/* Two-row group: growing columns */}
                  {[
                    { cols: 2, rows: 2, label: '2×2' },
                    { cols: 3, rows: 2, label: '2×3' },
                    { cols: 4, rows: 2, label: '2×4' },
                  ].map((opt) => {
                    const active = canvasData.cols === opt.cols && canvasData.rows === opt.rows;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => handleCanvasLayoutChange(opt.cols, opt.rows)}
                        className={`rounded-control px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                          active
                            ? 'border border-accent/30 bg-accent/12 text-accent'
                            : 'border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPanelResetKey((k) => k + 1)}
                    title="Restaurar tamanhos iguais"
                    className="flex items-center justify-center size-[27px] rounded-control border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6a4 4 0 1 0 .8-2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      <path d="M2 2.5v2.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <div className="mx-[2px] h-[16px] w-px bg-hairline" />
                </>
              )}
              <button
                onClick={() => setShowProjectPicker(true)}
                title="Nova sessão"
                className="flex items-center gap-[5px] rounded-control border border-accent/25 bg-accent/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-accent hover:bg-accent/15 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
              <button
                onClick={() => handleOpenRecover(projectId ?? '')}
                title="Recuperar conversa"
                className="flex items-center gap-[5px] rounded-control border border-hairline bg-white/[0.03] px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-ink-2 hover:border-hairline-strong hover:text-ink transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                  <path d="M2.5 6.5A4 4 0 1 0 4 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M2.5 2v2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="hidden sm:inline">Recover</span>
              </button>
            </>
          ) : showCanvas ? (
            /* Canvas hub: create canvas + new session */
            <>
              <button
                onClick={handleCreateCanvas}
                disabled={canvasCreating}
                className="flex items-center gap-[5px] rounded-control bg-accent px-[10px] py-[4px] text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-accent-hover disabled:opacity-50"
              >
                {canvasCreating ? (
                  <div className="size-[10px] animate-spin rounded-full border-[1.5px] border-black border-t-transparent" />
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
                className="flex items-center gap-[5px] rounded-control border border-accent/25 bg-accent/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-accent hover:bg-accent/15 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
              <button
                onClick={() => handleOpenRecover(projectId ?? '')}
                title="Recuperar conversa"
                className="flex items-center gap-[5px] rounded-control border border-hairline bg-white/[0.03] px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-ink-2 hover:border-hairline-strong hover:text-ink transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                  <path d="M2.5 6.5A4 4 0 1 0 4 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M2.5 2v2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="hidden sm:inline">Recover</span>
              </button>
            </>
          ) : (
            /* Terminal: new session + reconnect + fit + kill */
            <>
              <button
                onClick={() => setShowProjectPicker(true)}
                title="Nova sessão"
                className="flex items-center gap-[5px] rounded-control border border-accent/25 bg-accent/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-accent hover:bg-accent/15 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">New Session</span>
              </button>
              {sessionId && (
              <>
              <button
                onClick={() => handleOpenRecover(projectId ?? '')}
                title="Recuperar conversa"
                className="flex items-center gap-[5px] rounded-control border border-hairline bg-white/[0.03] px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-ink-2 hover:border-hairline-strong hover:text-ink transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                  <path d="M2.5 6.5A4 4 0 1 0 4 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M2.5 2v2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="hidden sm:inline">Recover</span>
              </button>
              <button
                onClick={() => termRef.current?.reconnect()}
                title="Reconnect"
                className="flex items-center gap-[5px] rounded-control border border-success/25 bg-success/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-success hover:bg-success/15 transition-colors"
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
                className="flex items-center gap-[5px] rounded-control border border-hairline bg-surface-2 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-ink-2 hover:bg-surface-3 transition-colors"
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
                className="flex items-center gap-[5px] rounded-control border border-danger/25 bg-danger/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">{killing ? 'Killing…' : 'Kill'}</span>
              </button>
              </>
              )}
            </>
          )}
        </div>
      </header>

      {/* ══ Body: rail + terminal ══ */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop rail */}
        {railOpen && !isMobile && (
          <aside className="w-[240px] shrink-0 border-r border-hairline bg-surface">
            <SessionRail
              groups={groups}
              activeSessionId={sessionId}
              onSelect={handleSelect}
              onClose={() => persistRail(false)}
              onCreateSession={handleCreateSession}
              onRecover={handleOpenRecover}
              creating={creating}
              onRename={handleRename}
              isMobile={false}
              showCanvas={showCanvas}
              onSelectCanvas={() => {
                setCanvasPickerOpen(true);
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
              className="absolute inset-0 z-20 bg-black/60"
              onClick={() => persistRail(false)}
            />
            <aside className="absolute inset-y-0 left-0 z-30 w-[260px] border-r border-hairline bg-surface shadow-2xl">
              <SessionRail
                groups={groups}
                activeSessionId={sessionId}
                onSelect={handleSelect}
                onClose={() => persistRail(false)}
                onCreateSession={handleCreateSession}
                onRecover={handleOpenRecover}
                creating={creating}
                onRename={handleRename}
                isMobile
                showCanvas={showCanvas}
                onSelectCanvas={() => {
                  setCanvasPickerOpen(true);
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
                  templateId={colsRowsToTemplateId(canvasData.cols, canvasData.rows)}
                  slots={(() => {
                    const liveIds = new Set(sessions.map((s) => s.sessionId));
                    const capacity = canvasData.cols * canvasData.rows;
                    const rec: Record<string, string | null> = {};
                    for (let i = 0; i < capacity; i++) {
                      const sid = canvasData.slots[i] ?? null;
                      rec[String.fromCharCode(97 + i)] = sid && liveIds.has(sid) ? sid : null;
                    }
                    return rec;
                  })()}
                  storageKey={canvasData.id}
                  sessions={sessions}
                  fontSize={fontSize}
                  theme={getThemeById(themeId).xterm}
                  onAssign={(slotId, sid) => handleAssignSlot(slotId.charCodeAt(0) - 97, sid)}
                  onRemove={(slotId) => handleClearSlot(slotId.charCodeAt(0) - 97)}
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
                  resetLayoutKey={panelResetKey}
                />
              )}
            </div>
          </div>
        ) : showCanvas ? (
          /* ══ Canvas loading (canvasData fetch in flight) ══ */
          <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
            <div className="size-[22px] animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          /* ══ Terminal ══ */
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {sessionId ? (
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
            ) : (
              /* No session selected — workspace landing */
              <div className="flex h-full flex-col items-center justify-center px-[24px] text-center">
                <div className="mb-[16px] flex size-[60px] items-center justify-center rounded-panel border border-hairline bg-surface">
                  <svg width="26" height="26" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
                    <path d="M5 13.5h6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                    <line x1="8" y1="11.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.25" />
                  </svg>
                </div>
                <h3 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">
                  {sessions.length > 0 ? 'Selecione uma sessão' : 'Nenhuma sessão ativa'}
                </h3>
                <p className="mt-[6px] max-w-[280px] text-[13px] leading-relaxed text-ink-3">
                  {sessions.length > 0
                    ? 'Escolha uma sessão na lista à esquerda, abra um Canvas, ou crie uma nova.'
                    : 'Crie uma sessão para começar, ou abra um Canvas.'}
                </p>
                <div className="mt-[20px] flex flex-wrap items-center justify-center gap-[10px]">
                  <button
                    onClick={() => setShowProjectPicker(true)}
                    className="flex items-center gap-[6px] rounded-control bg-accent px-[16px] py-[8px] text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-accent-hover"
                  >
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                      <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    Nova Sessão
                  </button>
                  {!isMobile && (
                    <button
                      onClick={() => setCanvasPickerOpen(true)}
                      className="flex items-center gap-[6px] rounded-control border border-hairline bg-white/[0.03] px-[18px] py-[10px] text-[13px] font-medium text-ink-2 transition-all hover:border-hairline-strong hover:text-ink"
                    >
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                        <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                      Abrir Canvas
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ Standard bottom bar ══ */}
      <div className="relative z-10 shrink-0">
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
      </div>

      {/* ══ Project Picker Modal ══ */}
      {showProjectPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowProjectPicker(false)}
        >
          <div
            className="relative mx-[16px] w-full max-w-sm rounded-modal border border-hairline bg-surface-2 p-[20px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowProjectPicker(false)}
              className="absolute right-[14px] top-[14px] flex size-[24px] items-center justify-center rounded-control text-ink-3 hover:bg-white/[0.06] hover:text-ink-2 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            <h3 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">Nova Sessão</h3>
            <p className="mt-[4px] text-[12px] text-ink-3">Escolha o projeto</p>

            <div className="mt-[14px] max-h-[320px] space-y-[4px] overflow-y-auto">
              {allProjects.length === 0 ? (
                <p className="py-[20px] text-center text-[13px] text-ink-3">
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
                      className="flex w-full items-center justify-between rounded-control border border-hairline bg-white/[0.02] px-[14px] py-[11px] text-[13px] font-medium text-ink transition-all hover:border-accent/30 hover:bg-accent/[0.05] hover:text-ink disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-left">{p.name}</span>
                      <div className="ml-[8px] flex shrink-0 items-center gap-[8px]">
                        {activeSessions > 0 && (
                          <span className="flex items-center gap-[3px] font-['JetBrains_Mono'] text-[10px] text-success">
                            <span className="size-[4px] rounded-full bg-success animate-pulse" />
                            {activeSessions}
                          </span>
                        )}
                        {isCreating ? (
                          <div className="size-[12px] animate-spin rounded-full border border-accent border-t-transparent" />
                        ) : (
                          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-ink-4">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => {
            const r = pickerResolver;
            setPickerResolver(null);
            r(null);
          }}
        >
          <div
            className="relative mx-[16px] w-full max-w-sm rounded-modal border border-hairline bg-surface-2 p-[20px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const r = pickerResolver;
                setPickerResolver(null);
                r(null);
              }}
              className="absolute right-[14px] top-[14px] flex size-[24px] items-center justify-center rounded-control text-ink-3 hover:bg-white/[0.06] hover:text-ink-2 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <h3 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">Nova Sessão</h3>
            <p className="mt-[4px] text-[12px] text-ink-3">Escolha o projeto para o slot</p>
            <div className="mt-[14px] max-h-[320px] space-y-[4px] overflow-y-auto">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    const r = pickerResolver;
                    setPickerResolver(null);
                    r(p.id);
                  }}
                  className="flex w-full items-center justify-between rounded-control border border-hairline bg-white/[0.02] px-[14px] py-[11px] text-[13px] font-medium text-ink transition-all hover:border-accent/30 hover:bg-accent/[0.05] hover:text-ink"
                >
                  <span className="min-w-0 truncate text-left">{p.name}</span>
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0 text-ink-4">
                    <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <RecoverConversationModal
        open={recoverModalOpen}
        onClose={() => setRecoverModalOpen(false)}
        onRecover={handleRecover}
      />

      <CanvasPickerModal
        open={canvasPickerOpen}
        onClose={() => setCanvasPickerOpen(false)}
        onSelect={(id) => {
          setCanvasPickerOpen(false);
          navigate(`/sessions?canvas=${id}`);
        }}
      />
    </div>
  );
}
