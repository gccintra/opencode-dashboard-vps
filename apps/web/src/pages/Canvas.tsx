/**
 * Global Canvas — full-screen multi-project terminal canvas.
 *
 * Opened from the Sessions page in a new browser tab.
 * No global sidebar, no project sidebar — just the canvas.
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  Header: ← Sessions | "Canvas"  |  layout controls  | theme  │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │  CanvasGrid (desktop) / CanvasMobile (mobile)                 │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │  Footer: font-size controls                                   │
 *   └───────────────────────────────────────────────────────────────┘
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import { ThemePicker, MobileKeyboard } from '../components/Terminal';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';
import { CanvasGrid } from '../components/Canvas/CanvasGrid';
import { CanvasMobile, type CanvasMobileHandle } from '../components/Canvas/CanvasMobile';
import { useCanvasState } from '../hooks/useCanvasState';
import { VpsStatsWidget } from '../components/VpsStatsWidget';

/* ── Types ── */

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

const CANVAS_LAYOUTS = [
  { cols: 1, rows: 1, label: '1×1' },
  { cols: 1, rows: 2, label: '1×2' },
  { cols: 2, rows: 1, label: '2×1' },
  { cols: 2, rows: 2, label: '2×2' },
  { cols: 2, rows: 3, label: '2×3' },
];

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
  return !!id && typeof id === 'string' && id !== 'undefined' && id !== 'null' && id.trim().length > 0;
}

/* ── Page ── */

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
      {/* Mobile: bottom sheet. Desktop: centered dialog. */}
      <div
        className="flex flex-col w-full sm:w-[340px] max-h-[70vh] sm:max-h-[460px]
          rounded-t-[16px] sm:rounded-[12px]
          border border-[rgba(255,255,255,0.1)] bg-[#111118] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle (mobile only) */}
        <div className="flex sm:hidden justify-center pt-[10px] pb-[4px] shrink-0">
          <span className="w-[36px] h-[4px] rounded-full bg-[rgba(255,255,255,0.15)]" />
        </div>

        <div className="flex items-center justify-between px-[16px] pt-[12px] pb-[12px] border-b border-[rgba(255,255,255,0.06)] shrink-0">
          <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">Criar sessão em qual projeto?</span>
          <button
            onClick={onDismiss}
            className="flex items-center justify-center size-[26px] rounded-[5px] text-[#556] hover:text-[#889] hover:bg-[rgba(255,255,255,0.06)] active:bg-[rgba(255,255,255,0.1)] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col overflow-y-auto py-[6px]">
          {projects.length === 0 && (
            <p className="px-[16px] py-[14px] font-['Inter'] text-[13px] text-[#556]">Nenhum projeto encontrado.</p>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="flex items-center gap-[12px] px-[16px] py-[14px] text-left active:bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              <span className="shrink-0 size-[8px] rounded-full bg-[rgba(170,255,0,0.5)]" />
              <span className="flex-1 min-w-0 truncate font-['Inter'] text-[14px] text-[#ccd]">{p.name}</span>
              <svg className="shrink-0 text-[#445]" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
          {/* Safe area padding for iOS home indicator */}
          <div className="h-[env(safe-area-inset-bottom,0px)] sm:hidden" />
        </div>
      </div>
    </div>
  );
}

export default function CanvasPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const viewportHeight = useViewportHeight();
  const canvasMobileRef = useRef<CanvasMobileHandle | null>(null);

  /* ── Sessions data ── */
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
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
              return (Array.isArray(list) ? list : []).map((s) => ({ ...s, projectId: project.id, projectName: project.name }));
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
      // silent — keep last known data
    } finally {
      setLoading(false);
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

  /* ── Rename ── */
  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName }),
      });
      setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, name: newName } : s)));
    } catch {
      // silent
    }
  }, []);

  /* ── Create session — project picker ── */
  type PickerResolver = (projectId: string | null) => void;
  const [pickerResolver, setPickerResolver] = useState<PickerResolver | null>(null);

  const handleCreateSession = useCallback((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      // Store resolver so the picker modal can settle it
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

  /* ── Canvas state ── */
  const canvasSessions = useMemo(
    () => sessions.map((s) => ({ sessionId: s.sessionId })),
    [sessions],
  );
  const { layout, setCanvasLayout, assignSlot, clearSlot } = useCanvasState('__sessions__', canvasSessions);

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

  useEffect(() => { localStorage.setItem('terminalFontSize', String(fontSize)); }, [fontSize]);

  const handleZoomIn = useCallback(() => setFontSize((p) => Math.min(p + 1, FONT_SIZE_MAX)), []);
  const handleZoomOut = useCallback(() => setFontSize((p) => Math.max(p - 1, FONT_SIZE_MIN)), []);
  const handleZoomReset = useCallback(() => setFontSize(defaultFontSize), [defaultFontSize]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn(); }
      else if (e.key === '-') { e.preventDefault(); handleZoomOut(); }
      else if (e.key === '0') { e.preventDefault(); handleZoomReset(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  /* ── Theme ── */
  const [themeId, setThemeId] = useState<string>(() => getThemeId());
  const handleThemeChange = useCallback((id: string) => { setThemeId(id); saveThemeId(id); }, []);

  /* ── Render ── */
  return (
    <div className="flex flex-col overflow-hidden bg-[#0a0a0f]" style={{ height: `${viewportHeight}px` }}>

      {/* Header — hidden on mobile (CanvasMobile TopBar takes over) */}
      <header className={`${isMobile ? 'hidden' : 'flex'} shrink-0 items-center justify-between gap-[12px] border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[20px] py-[10px]`}>
        {/* Left: back + title */}
        <div className="flex items-center gap-[8px] min-w-0">
          <button
            onClick={() => navigate('/sessions')}
            className="flex items-center gap-[4px] shrink-0 font-['Inter'] text-[12px] text-[#556] hover:text-[#889] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 2L4 6l3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sessions
          </button>
          <span className="text-[#334]">/</span>
          <span className="font-['Inter'] text-[14px] font-semibold text-[#f0f0f0]">Canvas</span>

          {sessions.length > 0 && (
            <span className="ml-[4px] font-['Inter'] text-[11px] text-[#445]">
              {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''} ativa{sessions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Right: layout controls (desktop only) */}
        {!isMobile && (
          <div className="flex items-center gap-[8px] shrink-0">
            <span className="font-['Inter'] text-[11px] text-[#556]">Layout:</span>
            <div className="flex items-center gap-[4px]" role="group" aria-label="Layout">
              {CANVAS_LAYOUTS.map((opt) => {
                const isActive = layout.cols === opt.cols && layout.rows === opt.rows;
                return (
                  <button
                    key={opt.label}
                    onClick={() => setCanvasLayout({ cols: opt.cols, rows: opt.rows })}
                    aria-pressed={isActive}
                    className={`rounded-[5px] px-[8px] py-[4px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                      isActive
                        ? 'bg-[rgba(170,255,0,0.15)] text-[#af0] border border-[rgba(170,255,0,0.3)]'
                        : 'border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main: canvas */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <svg className="animate-spin size-[28px] text-[#556]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ) : isMobile ? (
          <CanvasMobile
            ref={canvasMobileRef}
            projectId="__sessions__"
            sessions={sessions}
            fontSize={fontSize}
            theme={getThemeById(themeId).xterm}
            onCreateSession={handleCreateSession}
            onKill={handleKillSession}
            onRename={handleRenameSession}
            projectName="Canvas"
            onToggleSidebar={() => navigate('/sessions')}
            hideKeyboardFAB
          />
        ) : (
          <CanvasGrid
            cols={layout.cols}
            rows={layout.rows}
            slots={layout.slots}
            sessions={sessions}
            fontSize={fontSize}
            theme={getThemeById(themeId).xterm}
            onAssign={assignSlot}
            onRemove={clearSlot}
            onKill={handleKillSession}
            onCreateSession={handleCreateSession}
            onRename={handleRenameSession}
          />
        )}
      </div>

      {/* Project picker modal — shown when a slot's "Nova Sessão" button is clicked */}
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

      {/* Footer: font size + theme + keyboard (mobile, rightmost) */}
      <div className="flex shrink-0 items-center justify-end gap-[8px] border-t border-[rgba(170,255,0,0.1)] bg-[rgba(170,255,0,0.06)] px-[20px] py-[5px]">
        <VpsStatsWidget />
        <div className="h-[14px] w-px bg-[rgba(170,255,0,0.12)]" />
        <ThemePicker themeId={themeId} onChange={handleThemeChange} />
        <div className="h-[14px] w-px bg-[rgba(170,255,0,0.12)]" />
        <div className="flex items-center gap-[2px]">
          <button
            onClick={handleZoomOut}
            disabled={fontSize <= FONT_SIZE_MIN}
            title="Diminuir fonte (Ctrl+-)"
            className="flex items-center justify-center h-[20px] w-[20px] rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] hover:text-[rgba(170,255,0,0.9)] hover:bg-[rgba(170,255,0,0.1)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
          >
            A<span className="text-[8px] leading-none relative top-[1px]">-</span>
          </button>
          <button
            onClick={handleZoomReset}
            title={`Fonte: ${fontSize}px — clique para resetar`}
            className={`flex items-center justify-center h-[20px] min-w-[28px] px-[4px] rounded-[3px] font-['JetBrains_Mono'] text-[10px] transition-colors select-none ${
              fontSize === defaultFontSize
                ? 'text-[rgba(170,255,0,0.3)] hover:text-[rgba(170,255,0,0.6)]'
                : 'text-[rgba(170,255,0,0.8)] bg-[rgba(170,255,0,0.08)] hover:bg-[rgba(170,255,0,0.14)]'
            }`}
          >
            {fontSize}px
          </button>
          <button
            onClick={handleZoomIn}
            disabled={fontSize >= FONT_SIZE_MAX}
            title="Aumentar fonte (Ctrl++)"
            className="flex items-center justify-center h-[20px] w-[20px] rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] hover:text-[rgba(170,255,0,0.9)] hover:bg-[rgba(170,255,0,0.1)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
          >
            A<span className="text-[8px] leading-none relative top-[1px]">+</span>
          </button>
        </div>
        {isMobile && (
          <>
            <div className="h-[14px] w-px bg-[rgba(170,255,0,0.12)]" />
            <MobileKeyboard
              inline
              onKey={(seq) => canvasMobileRef.current?.sendKey(seq)}
              onSelectAll={() => canvasMobileRef.current?.selectAll()}
              onCopy={() => {
                const sel = canvasMobileRef.current?.getSelection() ?? '';
                if (sel) navigator.clipboard.writeText(sel).catch(() => {});
              }}
              onPaste={() => {
                navigator.clipboard.readText().then((text) => {
                  if (text) canvasMobileRef.current?.sendKey(text);
                }).catch(() => {});
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
