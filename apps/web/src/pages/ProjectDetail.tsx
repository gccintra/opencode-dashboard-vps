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
    <aside className="flex flex-1 min-h-0 w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0f]">
      {/* Header: back + project name */}
      <div className="flex shrink-0 flex-col border-b border-white/[0.07] px-[16px] pt-[19px] pb-[12px] gap-[6px]">
        <button
          onClick={onBack}
          className="flex items-center gap-[4px] w-fit font-['Inter'] text-[11px] text-[#5a626c] hover:text-[#9aa3ad] transition-colors"
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
          className="font-['Inter'] text-[14px] font-semibold tracking-[-0.14px] text-[#f0f0f0] truncate"
          data-testid="project-name"
        >
          {projectName || '…'}
        </p>
        <p className="font-['Inter'] text-[11px] text-[#5a626c]">
          {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''}
          {liveCount > 0 ? ` · ${liveCount} ativa${liveCount !== 1 ? 's' : ''}` : ''}
        </p>
      </div>

      {/* New Session button */}
      <div className="shrink-0 px-[16px] pt-[12px] pb-[8px] flex flex-col gap-[6px]">
        <button
          onClick={onCreateSession}
          disabled={creating}
          className="kb-sheen relative flex w-full items-center justify-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] py-[8px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] disabled:cursor-not-allowed disabled:opacity-60"
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
            className="flex w-full items-center justify-center gap-[5px] rounded-[5px] border border-white/[0.06] py-[6px] font-['Inter'] text-[12px] font-medium text-[#5a626c] hover:border-[rgba(255,85,85,0.25)] hover:text-[#f54] transition-colors"
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
          <p className="px-[14px] py-[12px] font-['Inter'] text-[11px] text-[#5a626c]">
            Nenhuma sessão ainda
          </p>
        ) : (
          <div className="flex flex-col">
            {sessions.map((session) => {
              const isActive = session.sessionId === activeSessionId && !showCanvas;
              const isDead = DEAD_STATUSES.has(session.status);
              const isRenaming = renaming === session.sessionId;
              const dotColor = isDead
                ? '#445566'
                : session.status === 'active'
                  ? '#22dd88'
                  : session.status === 'waiting'
                    ? '#ffaa00'
                    : '#445566';
              const dotPulse = session.status === 'active' && !isDead;

              return (
                <div
                  key={session.sessionId}
                  onClick={() => !isRenaming && onSelectSession(session.sessionId)}
                  className={`group relative flex cursor-pointer items-center gap-[8px] border-l-2 px-[14px] py-[8px] transition-colors ${
                    isActive
                      ? 'border-[#b3e502] bg-[rgba(179,229,2,0.07)]'
                      : 'border-transparent hover:bg-white/[0.03]'
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
                      className="min-w-0 flex-1 rounded-[4px] border border-[rgba(179,229,2,0.3)] bg-[#0a0a0f] px-[6px] py-[1px] font-['Inter'] text-[13px] text-[#f0f0f0] outline-none"
                      data-testid={`rename-input-${session.sessionId}`}
                    />
                  ) : (
                    <>
                      <span
                        className={`min-w-0 flex-1 truncate font-['Inter'] text-[13px] transition-colors ${
                          isActive ? 'text-[#f0f0f0]' : 'text-[#9aa3ad] group-hover:text-[#e6e8eb]'
                        }`}
                        onDoubleClick={(e) => startRename(session, e)}
                        title="Duplo clique para renomear"
                      >
                        {session.name}
                      </span>
                      <span className="shrink-0 font-['Inter'] text-[10px] text-[#5a626c]">
                        {formatRelativeTime(session.createdAt)}
                      </span>
                      <button
                        className="hidden size-[16px] shrink-0 items-center justify-center rounded-[3px] text-[#5a626c] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[#9aa3ad] group-hover:flex"
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
      <div className="shrink-0 border-t border-white/[0.06] py-[6px]">
        <button
          onClick={onSelectCanvas}
          className={`flex w-full items-center gap-[8px] border-l-2 px-[14px] py-[9px] font-['Inter'] text-[13px] font-medium transition-colors ${
            showCanvas
              ? 'border-[#b3e502] bg-[rgba(179,229,2,0.07)] text-[#f0f0f0]'
              : 'border-transparent text-[#9aa3ad] hover:bg-white/[0.03] hover:text-[#e6e8eb]'
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
      className="flex shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#111118] px-[20px] py-[10px]"
      data-testid="page-header"
    >
      {/* Breadcrumb + connection status */}
      <div className="flex items-center gap-[6px] min-w-0">
        {/* Hamburger — visible only below md breakpoint */}
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex items-center justify-center size-[32px] shrink-0 rounded-[5px] text-[#9aa3ad] hover:text-[#f0f0f0] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
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

        <span className="font-['Inter'] text-[13px] text-[#9aa3ad] shrink-0 truncate">
          {projectName}
        </span>

        {showCanvas ? (
          <>
            <span className="font-['Inter'] text-[13px] text-[#5a626c]">/</span>
            <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">Canvas</span>
          </>
        ) : (
          <>
            {sessionName && (
              <>
                <span className="font-['Inter'] text-[13px] text-[#5a626c]">/</span>
                <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0] truncate">
                  {sessionName}
                </span>
              </>
            )}
            {hasActiveSession && (
              <span className="ml-[6px] hidden sm:flex items-center gap-[4px] shrink-0">
                <span
                  className={`size-[7px] rounded-[3.5px] ${isConnected ? 'bg-[#2d8]' : 'bg-[#fa0]'}`}
                  style={isConnected ? { boxShadow: '0 0 6px rgba(34,221,136,0.6)' } : undefined}
                />
                <span
                  className={`font-['Inter'] text-[11px] font-medium ${isConnected ? 'text-[#2d8]' : 'text-[#fa0]'}`}
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
            className={`flex items-center gap-[5px] rounded-[5px] px-[8px] py-[4px] font-['Inter'] text-[11px] font-medium transition-colors ${
              canvasShowFiles
                ? 'bg-[rgba(179,229,2,0.12)] border border-[rgba(179,229,2,0.25)] text-[#b3e502]'
                : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
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
          <div className="h-[14px] w-px bg-white/[0.08]" />
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
              className={`rounded-[5px] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                canvasTemplateId === t.id
                  ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                  : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="h-[14px] w-px bg-white/[0.08]" />
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
              className={`rounded-[5px] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                canvasTemplateId === t.id
                  ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                  : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={onResetLayout}
            title="Restaurar tamanhos iguais"
            className="flex items-center justify-center size-[27px] rounded-[5px] border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb] transition-colors"
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
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(34,221,136,0.2)] bg-[rgba(34,221,136,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#2d8] hover:bg-[rgba(34,221,136,0.14)] transition-colors"
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
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(100,160,255,0.2)] bg-[rgba(100,160,255,0.08)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#6af] hover:bg-[rgba(100,160,255,0.14)] transition-colors"
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
                className="flex items-center gap-[5px] rounded-[5px] border border-[rgba(255,85,102,0.2)] bg-[rgba(255,85,102,0.15)] px-[7px] sm:px-[10px] py-[4px] font-['Inter'] text-[12px] font-medium text-[#f56] hover:bg-[rgba(255,85,102,0.22)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      className="flex shrink-0 items-center gap-[24px] border-b border-white/[0.07] bg-[#111118] px-[20px]"
      role="tablist"
      data-testid="tab-bar"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => onTabChange(tab)}
          className={`relative py-[12px] font-['Inter'] text-[13px] font-medium capitalize transition-colors ${
            activeTab === tab
              ? 'text-[#2d8] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#2d8] after:rounded-t-[1px]'
              : 'text-[#9aa3ad] hover:text-[#e6e8eb]'
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
      className="kb-rise flex flex-1 flex-col items-center justify-center gap-[20px] p-8"
      data-testid="empty-state"
    >
      <div className="flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <svg width="30" height="30" viewBox="0 0 48 48" fill="none" className="text-[#b3e502]">
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
        <h2 className="font-['Syne'] text-[20px] font-bold text-white">No active session</h2>
        <p className="mt-[6px] font-['Inter'] text-[14px] text-[#9aa3ad]">
          Create a session to open a terminal for this project
        </p>
      </div>
      <button
        onClick={onCreate}
        disabled={creating}
        className="kb-sheen relative flex items-center gap-[8px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516] hover:shadow-[0_8px_28px_-6px_rgba(179,229,2,0.7)] disabled:opacity-60 disabled:cursor-not-allowed"
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
          const isMob = window.innerWidth < 640;
          const dims = estimateTerminalDims(fontSizeRef.current, isMob);
          apiFetch(`/api/sessions/${resolvedId}/resize`, {
            method: 'POST',
            body: JSON.stringify(dims),
          }).catch(() => {});

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

  // Poll every 10 s
  useEffect(() => {
    const id = setInterval(fetchSessions, 10_000);
    return () => clearInterval(id);
  }, [fetchSessions]);

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
  useEffect(() => {
    if (!activeSessionId) return;
    const t = setTimeout(() => {
      terminalRef.current?.resize();
    }, 300);
    return () => clearTimeout(t);
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
      className="relative flex overflow-hidden bg-[#0a0a0f]"
      style={{ height: `${viewportHeight}px` }}
    >
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="kb-aurora"
          style={{
            top: '-180px',
            left: '-120px',
            width: 620,
            height: 620,
            opacity: 0.5,
            background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-220px',
            left: '38%',
            width: 680,
            height: 680,
            opacity: 0.4,
            animationDelay: '-7s',
            background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-160px',
            right: '-160px',
            width: 560,
            height: 560,
            opacity: 0.38,
            animationDelay: '-13s',
            background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)',
          }}
        />
        <div className="kb-grid" />
      </div>

      {/* ── Backdrop (mobile only) ── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sessions sidebar ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-[220px] shrink-0 flex-col
          border-r border-white/[0.06] bg-[#0a0a0f]
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
                    className="flex shrink-0 border-r border-white/[0.07]"
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
                        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-white/[0.07]">
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
                <p className="font-['Inter'] text-[15px] text-red-400" data-testid="error-message">
                  {sessionsError}
                </p>
                <button
                  onClick={() => {
                    setSessionsError(null);
                    fetchSessions();
                  }}
                  className="rounded-[6px] border border-white/[0.07] px-[16px] py-[8px] font-['Inter'] text-[13px] text-[#9aa3ad] hover:text-[#e6e8eb] transition-colors"
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
                      className="animate-spin size-[28px] text-[#5a626c]"
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
                      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1e1e2e]/80 backdrop-blur-sm">
                        <svg className="animate-spin size-5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="9" stroke="rgba(179,229,2,0.2)" strokeWidth="2" />
                          <path d="M21 12a9 9 0 00-9-9" stroke="#aaff00" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="font-['JetBrains_Mono'] text-[11px] text-[rgba(179,229,2,0.4)]">Criando sessão…</span>
                      </div>
                    )}
                    {closeError && (
                      <div
                        className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-[20px] py-[8px] font-['Inter'] text-[13px] text-red-400"
                        data-testid="error-banner"
                      >
                        {closeError}
                        <button
                          onClick={() => setCloseError(null)}
                          className="ml-[8px] underline hover:text-red-300"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                    <div className="relative flex flex-1 min-h-0 overflow-hidden p-1 sm:p-2">
                      <div
                        className="relative h-full min-h-0 w-full overflow-hidden rounded-[6px] border border-white/[0.07] bg-[#0a0a0f]"
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
                  <div className="w-[260px] shrink-0 overflow-y-auto border-r border-white/[0.07]">
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
