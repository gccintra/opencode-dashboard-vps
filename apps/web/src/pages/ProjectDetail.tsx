/**
 * ProjectDetail — session-focused full-screen workspace.
 *
 * Layout (matches Figma node 317:33):
 *   ┌─────────────────────┬─────────────────────────────────────────┐
 *   │  Sessions sidebar   │  Main content                           │
 *   │  220px              │  ┌─────────────────────────────────────┐│
 *   │                     │  │  Header: breadcrumb + status + btns ││
 *   │  • Back → /projects │  └─────────────────────────────────────┘│
 *   │  • Project name     │  ┌─────────────────────────────────────┐│
 *   │  • Session count    │  │  Tab bar (Terminal|Files) OR layout  ││
 *   │  • + New Session    │  └─────────────────────────────────────┘│
 *   │  • Session list     │  ┌─────────────────────────────────────┐│
 *   │  ──────────────     │  │  Terminal / Files / Canvas content  ││
 *   │  • Canvas           │  └─────────────────────────────────────┘│
 *   │                     │  ┌─────────────────────────────────────┐│
 *   │                     │  │  Status bar (always visible)        ││
 *   │                     │  └─────────────────────────────────────┘│
 *   └─────────────────────┴─────────────────────────────────────────┘
 *
 * This page renders its own full-screen layout — the global AppLayout
 * sidebar is NOT rendered for this route. See App.tsx.
 */

import { useEffect, useState, useCallback, useRef, lazy } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import {
  XTermTerminal,
  MobileKeyboard,
  TerminalStatusBar,
  type XTermTerminalHandle,
  type ConnectionStatus,
} from '../components/Terminal';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';
import FileTree from '../components/FileManager/FileTree';
import CodeEditor from '../components/FileManager/CodeEditor';
import { CanvasGrid } from '../components/Canvas/CanvasGrid';
import { CanvasMobile, type CanvasMobileHandle } from '../components/Canvas/CanvasMobile';
import { useCanvasState } from '../hooks/useCanvasState';
import { useSessionEvents } from '../hooks/useSessionEvents';
import { CANVAS_TEMPLATES, getTemplate } from '../components/Canvas/canvasTemplates';

const ResourceConfig = lazy(() => import('../components/ResourceConfig/ResourceConfig'));

/* ── Types ── */

interface Session {
  sessionId: string;
  name: string;
  status: string;
  createdAt: number;
}

interface Project {
  id: string;
  name: string;
  directory: string;
}

type PageTab = 'terminal' | 'files';

/* ── Constants ── */

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);

function TemplatePickerIcon({ id }: { id: string }) {
  const W = 20, H = 13, g = 1, p = 1;
  const w = W - 2 * p, h = H - 2 * p;
  const hw = (w - g) / 2, hh = (h - g) / 2, tw = (w - 2 * g) / 3;
  const r = (x: number, y: number, rw: number, rh: number, key: string) => (
    <rect key={key} x={x} y={y} width={rw} height={rh} rx={0.5} />
  );
  const rects = (() => {
    switch (id) {
      case 'single':      return [r(p,p,w,h,'a')];
      case '2col':        return [r(p,p,hw,h,'a'), r(p+hw+g,p,hw,h,'b')];
      case '2row':        return [r(p,p,w,hh,'a'), r(p,p+hh+g,w,hh,'b')];
      case 'left-stack':  return [r(p,p,hw,hh,'a'), r(p,p+hh+g,hw,hh,'b'), r(p+hw+g,p,hw,h,'c')];
      case 'right-stack': return [r(p,p,hw,h,'a'), r(p+hw+g,p,hw,hh,'b'), r(p+hw+g,p+hh+g,hw,hh,'c')];
      case '2x2':         return [r(p,p,hw,hh,'a'), r(p,p+hh+g,hw,hh,'b'), r(p+hw+g,p,hw,hh,'c'), r(p+hw+g,p+hh+g,hw,hh,'d')];
      case '3col':        return [r(p,p,tw,h,'a'), r(p+tw+g,p,tw,h,'b'), r(p+2*(tw+g),p,tw,h,'c')];
      default:            return [r(p,p,hw,h,'a'), r(p+hw+g,p,hw,h,'b')];
    }
  })();
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="currentColor">{rects}</svg>;
}

/* ── Helpers ── */

function estimateTerminalDims(fontSize: number, isMobile = false): { cols: number; rows: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;

  const sidebarWidth = isMobile ? 0 : 220;
  const containerPadding = isMobile ? 4 : 16 * 2 + 2;
  const headerHeight = 50;
  const tabBarHeight = 42;
  const statusBarHeight = 26;

  const availW = Math.max(40, w - sidebarWidth - containerPadding);
  const availH = Math.max(10, h - headerHeight - tabBarHeight - statusBarHeight - containerPadding);

  const charW = fontSize * 0.6;
  const charH = fontSize * 1.2; // xterm lineHeight:1.2 — actual cell height

  const cols = Math.floor(availW / charW);
  const rows = Math.floor(availH / charH);

  return { cols, rows };
}

function formatRelativeTime(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
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

function useDebouncedResize(sessionId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ cols: number; rows: number } | null>(null);

  return useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      latestRef.current = { cols, rows };

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

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

/* ── Sessions Sidebar ── */

function SessionsSidebar({
  projectName,
  sessions,
  activeSessionId,
  showCanvas,
  creating,
  onBack,
  onSelectSession,
  onSelectCanvas,
  onCreateSession,
  onRenameSession,
  onClearFinished,
}: {
  projectName: string;
  sessions: Session[];
  activeSessionId: string | null;
  showCanvas: boolean;
  creating: boolean;
  onBack: () => void;
  onSelectSession: (id: string) => void;
  onSelectCanvas: () => void;
  onCreateSession: () => void;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onClearFinished: () => void;
}) {
  const liveCount = sessions.filter((s) => !DEAD_STATUSES.has(s.status)).length;
  const deadCount = sessions.filter((s) => DEAD_STATUSES.has(s.status)).length;

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const startRename = useCallback((session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(session.sessionId);
    setRenameValue(session.name);
  }, []);

  const commitRename = useCallback(
    async (sessionId: string) => {
      const trimmed = renameValue.trim();
      setRenaming(null);
      if (!trimmed) return;
      await onRenameSession(sessionId, trimmed).catch(() => {});
    },
    [renameValue, onRenameSession],
  );

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, sessionId: string) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename(sessionId);
      } else if (e.key === 'Escape') {
        setRenaming(null);
      }
    },
    [commitRename],
  );

  return (
    <aside className="flex flex-1 min-h-0 w-[220px] shrink-0 flex-col border-r border-hairline bg-surface">
      {/* Header: back + project name */}
      <div className="flex shrink-0 flex-col border-b border-hairline px-[16px] pt-[19px] pb-[12px] gap-[6px]">
        <button
          onClick={onBack}
          className="flex items-center gap-[4px] w-fit text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
          data-testid="back-button"
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
          Voltar
        </button>
        <p
          className="text-[14px] font-semibold tracking-[-0.14px] text-ink truncate"
          data-testid="project-name"
        >
          {projectName || '…'}
        </p>
        <p className="text-[11px] text-ink-3">
          {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''}
          {liveCount > 0 ? ` · ${liveCount} ativa${liveCount !== 1 ? 's' : ''}` : ''}
        </p>
      </div>

      {/* New Session button */}
      <div className="shrink-0 px-[16px] pt-[12px] pb-[8px] flex flex-col gap-[6px]">
        <button
          onClick={onCreateSession}
          disabled={creating}
          className="flex w-full items-center justify-center gap-[6px] rounded-control bg-accent py-[7px] text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeOpacity="0.25"
              />
              <path
                d="M10.5 6a4.5 4.5 0 00-4.5-4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <span className="text-[16px] leading-none font-light">+</span>
          )}
          {creating ? 'Criando…' : 'Nova Sessão'}
        </button>
        {deadCount > 0 && (
          <button
            onClick={onClearFinished}
            className="flex w-full items-center justify-center gap-[5px] rounded-control border border-hairline py-[6px] text-[12px] font-medium text-ink-3 hover:border-danger/25 hover:text-danger transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path
                d="M2 2.5h7M4.5 2.5V2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v.5M3 2.5l.5 6h4l.5-6"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Limpar {deadCount} finalizada{deadCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto pb-[8px]">
        {sessions.length === 0 ? (
          <p className="px-[14px] py-[12px] text-[11px] text-ink-3">
            Nenhuma sessão ainda
          </p>
        ) : (
          <div className="flex flex-col">
            {sessions.map((session) => {
              const isActive = session.sessionId === activeSessionId && !showCanvas;
              const isDead = DEAD_STATUSES.has(session.status);
              const isRenaming = renaming === session.sessionId;
              const dotColor = isDead
                ? '#4a4a52'
                : session.status === 'active'
                  ? '#5e6ad2'
                  : session.status === 'waiting'
                    ? '#8a8f98'
                    : '#4a4a52';
              const dotPulse = session.status === 'active' && !isDead;

              return (
                <div
                  key={session.sessionId}
                  onClick={() => !isRenaming && onSelectSession(session.sessionId)}
                  className={`group relative flex cursor-pointer items-center gap-[8px] border-l-2 px-[14px] py-[8px] transition-colors ${
                    isActive
                      ? 'border-accent bg-accent/[0.08]'
                      : 'border-transparent hover:bg-white/[0.04]'
                  } ${isDead ? 'opacity-60' : ''}`}
                  data-testid={`session-item-${session.sessionId}`}
                >
                  <span
                    className={`size-[6px] shrink-0 rounded-full ${dotPulse ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: dotColor }}
                  />
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, session.sessionId)}
                      onBlur={() => commitRename(session.sessionId)}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 rounded-[4px] border border-accent/30 bg-black/40 px-[6px] py-[1px] text-[13px] text-ink outline-none"
                      data-testid={`rename-input-${session.sessionId}`}
                    />
                  ) : (
                    <>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] transition-colors ${
                          isActive ? 'text-ink' : 'text-ink-2 group-hover:text-ink'
                        }`}
                        onDoubleClick={(e) => startRename(session, e)}
                        title="Duplo clique para renomear"
                      >
                        {session.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-3">
                        {formatRelativeTime(session.createdAt)}
                      </span>
                      <button
                        className="hidden size-[16px] shrink-0 items-center justify-center rounded-[3px] text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink-2 group-hover:flex"
                        onClick={(e) => startRename(session, e)}
                        title="Renomear sessão"
                        data-testid={`rename-btn-${session.sessionId}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z"
                            stroke="currentColor"
                            strokeWidth="1.1"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Canvas nav item — below session list */}
      <div className="shrink-0 border-t border-hairline py-[6px]">
        <button
          onClick={onSelectCanvas}
          className={`flex w-full items-center gap-[8px] border-l-2 px-[14px] py-[9px] text-[13px] font-medium transition-colors ${
            showCanvas
              ? 'border-accent bg-accent/[0.08] text-ink'
              : 'border-transparent text-ink-2 hover:bg-white/[0.04] hover:text-ink'
          }`}
          data-testid="canvas-nav-item"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Canvas
        </button>
      </div>
    </aside>
  );
}

/* ── Terminal header ── */

function TerminalHeader({
  projectName,
  sessionName,
  connectionStatus,
  hasActiveSession,
  showCanvas,
  canvasShowFiles,
  onToggleCanvasFiles,
  canvasTemplateId,
  onTemplateChange,
  onResetLayout,
  onReconnect,
  onRefresh,
  onKill,
  killing,
  sidebarOpen,
  onToggleSidebar,
}: {
  projectName: string;
  sessionName: string | null;
  connectionStatus: ConnectionStatus;
  hasActiveSession: boolean;
  showCanvas: boolean;
  canvasShowFiles: boolean;
  onToggleCanvasFiles: () => void;
  canvasTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  onResetLayout: () => void;
  onReconnect: () => void;
  onRefresh: () => void;
  onKill: () => void;
  killing: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const isConnected = connectionStatus === 'connected';

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-hairline bg-surface px-[20px] py-[10px]"
      data-testid="page-header"
    >
      {/* Breadcrumb + connection status */}
      <div className="flex items-center gap-[6px] min-w-0">
        {/* Hamburger — visible only below md breakpoint */}
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex items-center justify-center size-[32px] shrink-0 rounded-control text-ink-2 hover:text-ink hover:bg-hairline transition-colors"
          aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          data-testid="sidebar-toggle"
        >
          {sidebarOpen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5l-10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 6h12M4 10h12M4 14h12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>

        <span className="text-[13px] text-ink-2 shrink-0 truncate">
          {projectName}
        </span>

        {showCanvas ? (
          <>
            <span className="text-[13px] text-ink-3">/</span>
            <span className="text-[13px] font-semibold text-ink">Canvas</span>
          </>
        ) : (
          <>
            {sessionName && (
              <>
                <span className="text-[13px] text-ink-3">/</span>
                <span className="text-[13px] font-semibold text-ink truncate">
                  {sessionName}
                </span>
              </>
            )}
            {hasActiveSession && (
              <span className="ml-[6px] hidden sm:flex items-center gap-[4px] shrink-0">
                <span
                  className={`size-[7px] rounded-full ${isConnected ? 'bg-success' : 'bg-ink-4 animate-pulse'}`}
                                  />
                <span
                  className={`text-[11px] font-medium ${isConnected ? 'text-success' : 'text-ink-3'}`}
                >
                  {isConnected
                    ? 'Connected'
                    : connectionStatus === 'connecting'
                      ? 'Connecting…'
                      : connectionStatus === 'reconnecting'
                        ? 'Reconnecting…'
                        : 'Disconnected'}
                </span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Right side: canvas controls on desktop, or session action buttons */}
      {showCanvas ? (
        <div className="hidden md:flex items-center gap-[6px] shrink-0">
          {/* Files toggle */}
          <button
            onClick={onToggleCanvasFiles}
            className={`flex items-center gap-[5px] rounded-control px-[8px] py-[4px] text-[11px] font-medium transition-colors ${
              canvasShowFiles
                ? 'border border-accent/25 bg-accent/12 text-accent'
                : 'border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
            }`}
            title={canvasShowFiles ? 'Fechar arquivos' : 'Abrir arquivos'}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path
                d="M1.5 2h4l1 1.5H9.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5V2.5a.5.5 0 0 1 .5-.5z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            Files
          </button>
          <div className="h-[14px] w-px bg-hairline" />
          {/* Single-row layouts */}
          {[
            { id: 'single', label: '1×1' },
            { id: '2col',   label: '1×2' },
            { id: '3col',   label: '1×3' },
            { id: '4col',   label: '1×4' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => onTemplateChange(t.id)}
              aria-pressed={canvasTemplateId === t.id}
              data-testid={`layout-btn-${t.id}`}
              className={`rounded-control px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                canvasTemplateId === t.id
                  ? 'border border-accent/30 bg-accent/12 text-accent'
                  : 'border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="h-[14px] w-px bg-hairline" />
          {/* Multi-row layouts */}
          {[
            { id: '2x2', label: '2×2' },
            { id: '3x2', label: '2×3' },
            { id: '4x2', label: '2×4' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => onTemplateChange(t.id)}
              aria-pressed={canvasTemplateId === t.id}
              data-testid={`layout-btn-${t.id}`}
              className={`rounded-control px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                canvasTemplateId === t.id
                  ? 'border border-accent/30 bg-accent/12 text-accent'
                  : 'border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={onResetLayout}
            title="Restaurar tamanhos iguais"
            className="flex items-center justify-center size-[27px] rounded-control border border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6a4 4 0 1 0 .8-2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M2 2.5v2.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-[8px] shrink-0 ml-[16px]">
          {hasActiveSession && (
            <>
              <button
                onClick={onReconnect}
                title="Reconnect"
                className="flex items-center gap-[5px] rounded-control border border-success/25 bg-success/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-success hover:bg-success/15 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M10.5 6A4.5 4.5 0 1 1 7.5 1.8"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M7.5 1.5l1.5 1.5-1.5 1.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="hidden sm:inline">Reconnect</span>
              </button>
              <button
                onClick={onRefresh}
                title="Fit/Refresh terminal layout"
                className="flex items-center gap-[5px] rounded-control border border-hairline bg-surface-2 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect
                    x="1.5"
                    y="1.5"
                    width="9"
                    height="9"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M4 6h4M6 4v4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="hidden sm:inline">Fit</span>
              </button>
              <button
                onClick={onKill}
                disabled={killing}
                title={killing ? 'Killing…' : 'Kill'}
                className="flex items-center gap-[5px] rounded-control border border-danger/25 bg-danger/10 px-[7px] sm:px-[10px] py-[4px] text-[12px] font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="close-session-button"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 2l8 8M10 2l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="hidden sm:inline">{killing ? 'Killing…' : 'Kill'}</span>
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

/* ── Tab bar (terminal / files — no canvas) ── */

const TAB_LABELS: Record<PageTab, string> = {
  terminal: 'Terminal',
  files: 'Files',
};

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: PageTab;
  onTabChange: (t: PageTab) => void;
}) {
  const tabs: PageTab[] = ['terminal', 'files'];
  return (
    <div
      className="flex shrink-0 items-center gap-[24px] border-b border-hairline bg-surface px-[20px]"
      role="tablist"
      data-testid="tab-bar"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => onTabChange(tab)}
          className={`relative py-[12px] text-[13px] font-medium capitalize transition-colors ${
            activeTab === tab
              ? 'text-ink after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-accent after:rounded-t-[1px]'
              : 'text-ink-2 hover:text-ink'
          }`}
          data-testid={`tab-${tab}`}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}

/* ── Status bar ── */

const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_DEFAULT_MOBILE = 12;

/* ── Empty state ── */

function EmptyTerminalState({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-[20px] p-8"
      data-testid="empty-state"
    >
      <div className="flex size-[48px] items-center justify-center rounded-panel border border-hairline bg-surface">
        <svg width="30" height="30" viewBox="0 0 48 48" fill="none" className="text-ink-3">
          <rect x="5" y="9" width="38" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M13 19L18 24L13 29"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="21"
            y1="30"
            x2="33"
            y2="30"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">No active session</h2>
        <p className="mt-[6px] text-[13px] text-ink-2">
          Create a session to open a terminal for this project
        </p>
      </div>
      <button
        onClick={onCreate}
        disabled={creating}
        className="flex items-center gap-[8px] rounded-control bg-accent px-[16px] py-[8px] text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
        data-testid="new-session-button"
      >
        {creating ? (
          <>
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeOpacity="0.25"
              />
              <path
                d="M12.5 7a5.5 5.5 0 00-5.5-5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Creating…
          </>
        ) : (
          <>+ New Session</>
        )}
      </button>
    </div>
  );
}

/* ── Page ── */

export default function ProjectDetailPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const viewportHeight = useViewportHeight();

  const [project, setProject] = useState<Project | null>(null);

  const abortedRef = useRef(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false); // synchronous guard against double-create
  const [killing, setKilling] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const urlSessionId = searchParams.get('session');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');

  // Canvas is now a sidebar nav item, not a tab
  const [showCanvas, setShowCanvas] = useState(false);
  const [activeTab, setActiveTab] = useState<PageTab>('terminal');
  const [filesOpenPath, setFilesOpenPath] = useState<string | null>(null);

  // File navigation within the canvas view (desktop only)
  const [canvasShowFiles, setCanvasShowFiles] = useState(false);
  const [canvasFilesOpenPath, setCanvasFilesOpenPath] = useState<string | null>(null);

  // Deep-link from the ⌘K command palette: `?view=canvas` opens the canvas,
  // `?tab=files` opens the files tab. Read once on mount — the session-resolver
  // effect later rewrites the query string, but the view/tab state persists.
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    deepLinkAppliedRef.current = true;
    const view = searchParams.get('view');
    const tab = searchParams.get('tab');
    const file = searchParams.get('file');
    if (view === 'canvas') {
      setShowCanvas(true);
    } else if (file) {
      setShowCanvas(false);
      setActiveTab('files');
      setFilesOpenPath(file);
    } else if (tab === 'files' || tab === 'terminal') {
      setShowCanvas(false);
      setActiveTab(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const terminalRef = useRef<XTermTerminalHandle | null>(null);
  const canvasMobileRef = useRef<CanvasMobileHandle | null>(null);

  const onResize = useDebouncedResize(activeSessionId);

  /* ── Fetch project ── */
  useEffect(() => {
    if (!projectId) return;
    apiFetch<Project[]>('/api/projects')
      .then((list) => {
        if (Array.isArray(list)) {
          const found = list.find((p) => p.id === projectId);
          if (found) setProject(found);
        }
      })
      .catch(() => {});
  }, [projectId]);

  /* ── Fetch sessions ── */
  // Global session-events channel — replaces the old 10s HTTP poll.
  const { onSessionEvent } = useSessionEvents();

  const fetchSessions = useCallback(async () => {
    if (!projectId || abortedRef.current) return;
    try {
      const data = await apiFetch<Session[]>(`/api/projects/${projectId}/sessions`);
      const list: Session[] = Array.isArray(data) ? data : [];
      list.sort((a, b) => a.createdAt - b.createdAt);
      setSessions(list);
      setSessionsError(null);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 404) {
        abortedRef.current = true;
        navigate('/projects', { replace: true });
        return;
      }
      setSessionsError(apiErr.message || 'Failed to load sessions');
    }
  }, [projectId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial mount: resolve activeSessionId from URL param or newest live session.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<Session[]>(`/api/projects/${projectId}/sessions`);
        if (cancelled) return;
        const list: Session[] = Array.isArray(data) ? data : [];
        list.sort((a, b) => a.createdAt - b.createdAt);
        setSessions(list);
        setSessionsLoading(false);

        const urlId = searchParams.get('session');
        const urlSession = urlId && list.find((s) => s.sessionId === urlId);
        const live = list.filter((s) => !DEAD_STATUSES.has(s.status));

        const resolvedId =
          urlSession && !DEAD_STATUSES.has(urlSession.status)
            ? urlSession.sessionId
            : live.length > 0
              ? live[live.length - 1].sessionId
              : null;

        if (resolvedId) {
          setActiveSessionId((prev) => prev ?? resolvedId);
          if (!urlSession || DEAD_STATUSES.has(urlSession.status)) {
            setSearchParams({ session: resolvedId }, { replace: true });
          }
        }
      } catch (err) {
        if (cancelled) return;
        const apiErr = err as ApiError;
        if (apiErr.status === 404) {
          abortedRef.current = true;
          navigate('/projects', { replace: true });
          return;
        }
        setSessionsLoading(false);
        setSessionsError(apiErr.message || 'Failed to load sessions');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Push-based sync: re-fetch whenever the server reports a session change.
  // Replaces the old 10s HTTP poll (changes in any tab arrive in <1s).
  useEffect(() => {
    const unsubscribe = onSessionEvent(() => {
      fetchSessions();
    });
    return unsubscribe;
  }, [fetchSessions, onSessionEvent]);

  // Fallback safety net (deprecated, kept for 1 release): the in-page
  // 'sessions-changed' custom event still triggers a refresh if the events WS
  // is down during a local mutation (spec Risk #4).
  useEffect(() => {
    const handler = () => {
      fetchSessions();
    };
    window.addEventListener('sessions-changed', handler);
    return () => window.removeEventListener('sessions-changed', handler);
  }, [fetchSessions]);

  /* ── Select session from sidebar ── */
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.sessionId === sessionId);
      if (session && !DEAD_STATUSES.has(session.status)) {
        const { cols, rows } = estimateTerminalDims(fontSizeRef.current, isMobile);
        apiFetch(`/api/sessions/${sessionId}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols, rows }),
        }).catch(() => {});
      }

      setActiveSessionId(sessionId);
      setShowCanvas(false);
      setActiveTab('terminal');
      setSearchParams({ session: sessionId }, { replace: true });
    },
    [setSearchParams, isMobile],
  );

  /* ── Select canvas from sidebar ── */
  const handleSelectCanvas = useCallback(() => {
    setShowCanvas(true);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  /* ── Create session ── */
  const handleCreateSession = useCallback(async () => {
    // Use a ref (not state) as the guard — refs update synchronously, preventing
    // double-create from rapid double-clicks or React StrictMode remounts.
    if (!projectId || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    if (import.meta.env.DEV) console.log('[Session] creating...');
    try {
      const { cols, rows } = estimateTerminalDims(fontSizeRef.current, isMobile);
      const created = await apiFetch<Session>(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows }),
      });
      if (import.meta.env.DEV) console.log('[Session] created:', created.sessionId);
      setSessions((prev) => [...prev, created].sort((a, b) => a.createdAt - b.createdAt));
      setActiveSessionId(created.sessionId);
      setShowCanvas(false);
      setActiveTab('terminal');
      setSearchParams({ session: created.sessionId }, { replace: true });
      window.dispatchEvent(new CustomEvent('sessions-changed'));
      fetchSessions();
    } catch (err) {
      const msg = (err as ApiError).message || 'Failed to create session';
      console.error('[ProjectDetail] create session failed', msg);
      setSessionsError(msg);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [projectId, fetchSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Kill session ── */
  const handleKillSession = useCallback(async () => {
    if (!activeSessionId || killing) return;
    setKilling(true);
    try {
      await apiFetch(`/api/sessions/${activeSessionId}`, { method: 'DELETE' });
    } catch (err) {
      const apiErr = err as ApiError;
      // 404 means the session is already gone — treat as success.
      if (apiErr.status !== 404) {
        setCloseError(apiErr.message || 'Failed to close session');
        console.error('[ProjectDetail] kill session failed', apiErr.message);
        setKilling(false);
        return;
      }
    }
    setActiveSessionId(null);
    setSearchParams({}, { replace: true });
    window.dispatchEvent(new CustomEvent('sessions-changed'));
    await fetchSessions();
    setKilling(false);
  }, [activeSessionId, killing, fetchSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Clear finished sessions ── */
  const handleClearFinished = useCallback(async () => {
    if (!projectId) return;
    try {
      await apiFetch(`/api/projects/${projectId}/sessions/finished`, { method: 'DELETE' });
      window.dispatchEvent(new CustomEvent('sessions-changed'));
      await fetchSessions();
    } catch (err) {
      console.error('[ProjectDetail] clear finished failed', (err as ApiError).message);
    }
  }, [projectId, fetchSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Rename session ── */
  const handleRenameSession = useCallback(async (sessionId: string, name: string) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, name } : s)));
    } catch (err) {
      console.error('[ProjectDetail] rename failed', (err as ApiError).message);
    }
  }, []);

  /* ── Canvas state ── */
  const [panelResetKey, setPanelResetKey] = useState(0);
  const handleResetLayout = useCallback(() => setPanelResetKey((k) => k + 1), []);

  const {
    layout: canvasLayout,
    setTemplate: setCanvasTemplate,
    assignSlot,
    clearSlot,
  } = useCanvasState(projectId ?? '', sessions);

  const handleCanvasCreateSession = useCallback(async (): Promise<string | null> => {
    if (!projectId) return null;
    try {
      const { cols, rows } = estimateTerminalDims(fontSizeRef.current, isMobile);
      const created = await apiFetch<Session>(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows }),
      });
      setSessions((prev) => [...prev, created].sort((a, b) => a.createdAt - b.createdAt));
      window.dispatchEvent(new CustomEvent('sessions-changed'));
      fetchSessions();
      return created.sessionId;
    } catch {
      return null;
    }
  }, [projectId, fetchSessions, isMobile]);

  /* ── Reconnect ── */
  const handleReconnect = useCallback(() => {
    terminalRef.current?.reconnect();
  }, []);

  /* ── Fit/refresh terminal layout ── */
  const handleRefresh = useCallback(() => {
    const handle = terminalRef.current;
    if (!handle) return;
    handle.resize();
    // Bypass the 300ms debounce for user-initiated fit — sends SIGWINCH
    // immediately so OpenCode re-renders its TUI without perceptible delay.
    const dims = handle.getDims();
    if (dims && activeSessionId) {
      apiFetch(`/api/sessions/${activeSessionId}/resize`, {
        method: 'POST',
        body: JSON.stringify(dims),
      }).catch(() => {});
    }
  }, [activeSessionId]);

  /* ── Resize on tab focus ── */
  useEffect(() => {
    if (showCanvas || activeTab !== 'terminal') return;
    const t = setTimeout(() => {
      terminalRef.current?.resize();
    }, 50);
    return () => clearTimeout(t);
  }, [activeTab, showCanvas]);

  /* ── Resize on session switch ── */
  // Dual-shot corrective re-sync — mirrors CanvasSlot. 500ms fixes boot/layout
  // size mismatch; 1.8s covers a TUI that was busy mid-task and ignored the
  // first SIGWINCH (the old single 300ms shot missed that case).
  useEffect(() => {
    if (!activeSessionId) return;
    const t0 = setTimeout(() => terminalRef.current?.resize(), 500);
    const t1 = setTimeout(() => terminalRef.current?.resize(), 1800);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [activeSessionId]);

  const handleSessionStatusChange = useCallback(
    (status: string) => {
      if (status === 'exited' || status === 'killed' || status === 'finished') {
        fetchSessions();
      }
    },
    [fetchSessions],
  );

  /* ── Derived ── */
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId) ?? null;
  const activeSessionName = activeSession?.name ?? null;
  const activeSessionCreatedAt = activeSession?.createdAt ?? null;
  const projectName = project?.name ?? projectId ?? '';

  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* ── Font size / zoom ── */
  const defaultFontSize = isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem('terminalFontSize');
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) return n;
    }
    return isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  });

  const fontSizeRef = useRef(fontSize);
  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('terminalFontSize', String(fontSize));
  }, [fontSize]);

  const handleZoomIn = useCallback(() => {
    setFontSize((prev) => Math.min(prev + 1, FONT_SIZE_MAX));
  }, []);

  const handleZoomOut = useCallback(() => {
    setFontSize((prev) => Math.max(prev - 1, FONT_SIZE_MIN));
  }, []);

  const handleZoomReset = useCallback(() => {
    setFontSize(isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT);
  }, [isMobile]);

  /* ── Theme ── */
  const [themeId, setThemeId] = useState<string>(() => getThemeId());
  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  // Keyboard shortcuts: Ctrl+= (zoom in), Ctrl+- (zoom out), Ctrl+0 (reset)
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

  const handleSelectSessionMobile = useCallback(
    (sessionId: string) => {
      handleSelectSession(sessionId);
      setSidebarOpen(false);
    },
    [handleSelectSession],
  );

  const handleSelectCanvasMobile = useCallback(() => {
    handleSelectCanvas();
    setSidebarOpen(false);
  }, [handleSelectCanvas]);

  return (
    <div
      className="relative flex overflow-hidden bg-bg"
      style={{ height: `${viewportHeight}px` }}
    >

      {/* ── Backdrop (mobile only) ── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 md:hidden ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sessions sidebar ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-[220px] shrink-0 flex-col
          border-r border-hairline bg-surface
          transition-transform duration-200 ease-out
          md:relative md:inset-auto md:z-10 md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Sessions"
      >
        <SessionsSidebar
          projectName={projectName}
          sessions={sessions}
          activeSessionId={activeSessionId}
          showCanvas={showCanvas}
          creating={creating}
          onBack={() => navigate('/projects')}
          onSelectSession={handleSelectSessionMobile}
          onSelectCanvas={handleSelectCanvasMobile}
          onCreateSession={handleCreateSession}
          onRenameSession={handleRenameSession}
          onClearFinished={handleClearFinished}
        />
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Header — hidden on mobile canvas (CanvasMobile has its own combined header) */}
        {!(isMobile && showCanvas) && (
          <TerminalHeader
            projectName={projectName}
            sessionName={activeSessionName}
            connectionStatus={connectionStatus}
            hasActiveSession={!!activeSessionId}
            showCanvas={showCanvas}
            canvasShowFiles={canvasShowFiles}
            onToggleCanvasFiles={() => setCanvasShowFiles((v) => !v)}
            canvasTemplateId={canvasLayout.templateId}
            onTemplateChange={setCanvasTemplate}
            onResetLayout={handleResetLayout}
            onReconnect={handleReconnect}
            onRefresh={handleRefresh}
            onKill={handleKillSession}
            killing={killing}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
        )}

        {/* ── Canvas view ── */}
        {showCanvas && projectId && (
          <div className="flex flex-1 min-h-0 overflow-hidden" data-testid="canvas-panel">
            {isMobile ? (
              <CanvasMobile
                ref={canvasMobileRef}
                projectId={projectId}
                sessions={sessions}
                fontSize={fontSize}
                theme={getThemeById(themeId).xterm}
                onCreateSession={handleCanvasCreateSession}
                onRename={handleRenameSession}
                projectName={projectName}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                externalSlots={getTemplate(canvasLayout.templateId).slots.map(
                  (id) => canvasLayout.slots[id] ?? null,
                )}
                onAssignSlot={(index, sid) =>
                  assignSlot(getTemplate(canvasLayout.templateId).slots[index], sid)
                }
                onClearSlot={(index) =>
                  clearSlot(getTemplate(canvasLayout.templateId).slots[index])
                }
              />
            ) : (
              <>
                {/* File navigation panel (desktop, collapsible) */}
                {canvasShowFiles && (
                  <div
                    className="flex shrink-0 border-r border-hairline"
                    style={{ width: '460px' }}
                  >
                    {!canvasFilesOpenPath ? (
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <FileTree
                          projectId={projectId}
                          onFileOpen={(_pid, filePath) => setCanvasFilesOpenPath(filePath)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-1 overflow-hidden">
                        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-hairline">
                          <FileTree
                            projectId={projectId}
                            onFileOpen={(_pid, filePath) => setCanvasFilesOpenPath(filePath)}
                          />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <CodeEditor projectId={projectId} initialFilePath={canvasFilesOpenPath} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Canvas grid */}
                <CanvasGrid
                  templateId={canvasLayout.templateId}
                  slots={canvasLayout.slots}
                  storageKey={projectId ?? ''}
                  sessions={sessions}
                  fontSize={fontSize}
                  theme={getThemeById(themeId).xterm}
                  onAssign={assignSlot}
                  onRemove={clearSlot}
                  onCreateSession={handleCanvasCreateSession}
                  onRename={handleRenameSession}
                  resetLayoutKey={panelResetKey}
                />
              </>
            )}
          </div>
        )}

        {/* ── Session view (terminal + files) ── */}
        {!showCanvas && (
          <>
            {/* Tab bar */}
            <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Error state for sessions fetch */}
            {sessionsError && !sessionsLoading && (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-[16px] p-8"
                data-testid="error-state"
              >
                <p className="text-[15px] text-danger" data-testid="error-message">
                  {sessionsError}
                </p>
                <button
                  onClick={() => {
                    setSessionsError(null);
                    fetchSessions();
                  }}
                  className="rounded-[6px] border border-hairline px-[16px] py-[8px] text-[13px] text-ink-2 hover:text-ink transition-colors"
                  data-testid="retry-button"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* ── Terminal tab — kept mounted via CSS display ── */}
            {!sessionsError && (
              <div
                className="relative flex flex-1 min-h-0 flex-col"
                style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
              >
                {sessionsLoading ? (
                  <div
                    className="flex flex-1 items-center justify-center"
                    data-testid="loading-state"
                  >
                    <svg
                      className="animate-spin size-[28px] text-ink-3"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
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
                ) : activeSessionId ? (
                  <>
                    {creating && (
                      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/80">
                        <svg className="animate-spin size-5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="9" stroke="rgba(94, 106, 210,0.2)" strokeWidth="2" />
                          <path d="M21 12a9 9 0 00-9-9" stroke="#5e6ad2" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="font-['JetBrains_Mono'] text-[11px] text-accent/60">Criando sessão…</span>
                      </div>
                    )}
                    {closeError && (
                      <div
                        className="shrink-0 border-b border-danger/30 bg-danger/10 px-[20px] py-[8px] text-[13px] text-danger"
                        data-testid="error-banner"
                      >
                        {closeError}
                        <button
                          onClick={() => setCloseError(null)}
                          className="ml-[8px] underline hover:text-danger/80"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                    <div className="relative flex flex-1 min-h-0 overflow-hidden p-1 sm:p-2">
                      <div
                        className="relative h-full min-h-0 w-full overflow-hidden rounded-control border border-hairline bg-bg"
                        data-testid="terminal-container"
                      >
                        <XTermTerminal
                          key={activeSessionId}
                          ref={terminalRef}
                          sessionId={activeSessionId}
                          onResize={onResize}
                          onConnectionStatus={setConnectionStatus}
                          onStatusChange={handleSessionStatusChange}
                          onCreateNewSession={handleCreateSession}
                          fontSize={fontSize}
                          theme={getThemeById(themeId).xterm}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyTerminalState creating={creating} onCreate={handleCreateSession} />
                )}
              </div>
            )}

            {/* ── Files tab ── */}
            {activeTab === 'files' && projectId && (
              <div className="flex flex-1 overflow-hidden" data-testid="files-panel">
                <div className="hidden md:flex w-full">
                  <div className="w-[260px] shrink-0 overflow-y-auto border-r border-hairline">
                    <FileTree
                      projectId={projectId}
                      onFileOpen={(_pid, filePath) => setFilesOpenPath(filePath)}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <CodeEditor
                      projectId={projectId}
                      initialFilePath={filesOpenPath || undefined}
                    />
                  </div>
                </div>
                <div className="flex md:hidden w-full">
                  {!filesOpenPath ? (
                    <FileTree
                      projectId={projectId}
                      onFileOpen={(_pid, filePath) => setFilesOpenPath(filePath)}
                      isMobile
                    />
                  ) : (
                    <CodeEditor
                      projectId={projectId}
                      initialFilePath={filesOpenPath}
                      isMobile
                      onBack={() => setFilesOpenPath(null)}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Status bar — always visible for font size / theme access ── */}
        <TerminalStatusBar
          connectionStatus={showCanvas || activeTab !== 'terminal' ? 'idle' : connectionStatus}
          sessionCreatedAt={showCanvas || activeTab !== 'terminal' ? null : activeSessionCreatedAt}
          fontSize={fontSize}
          defaultFontSize={defaultFontSize}
          themeId={themeId}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onThemeChange={handleThemeChange}
          mobileKeyboard={
            isMobile && (showCanvas || (activeTab === 'terminal' && !!activeSessionId)) ? (
              <MobileKeyboard
                inline
                onKey={(seq) => {
                  if (showCanvas) canvasMobileRef.current?.sendKey(seq);
                  else terminalRef.current?.sendKey(seq);
                }}
                onSelectAll={() => {
                  if (showCanvas) canvasMobileRef.current?.selectAll();
                  else terminalRef.current?.selectAll();
                }}
                onCopy={() => {
                  const sel = showCanvas
                    ? (canvasMobileRef.current?.getSelection() ?? '')
                    : (terminalRef.current?.getSelection() ?? '');
                  if (sel) navigator.clipboard.writeText(sel).catch(() => {});
                }}
                onPaste={() => {
                  navigator.clipboard
                    .readText()
                    .then((text) => {
                      if (!text) return;
                      if (showCanvas) canvasMobileRef.current?.sendKey(text);
                      else terminalRef.current?.sendKey(text);
                    })
                    .catch(() => {});
                }}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
