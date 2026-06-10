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

import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import {
  XTermTerminal,
  ThemePicker,
  type XTermTerminalHandle,
  type ConnectionStatus,
} from '../components/Terminal';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';
import FileTree from '../components/FileTree/FileTree';
import CodeEditor from '../components/CodeEditor/CodeEditor';
import { CanvasGrid } from '../components/Canvas/CanvasGrid';
import { CanvasMobile, type CanvasMobileHandle } from '../components/Canvas/CanvasMobile';
import { MobileKeyboard } from '../components/Terminal';
import { useCanvasState } from '../hooks/useCanvasState';
import type { CanvasLayout } from '../hooks/useCanvasState';

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

const CANVAS_LAYOUTS: Array<{ cols: number; rows: number; label: string }> = [
  { cols: 1, rows: 1, label: '1×1' },
  { cols: 1, rows: 2, label: '1×2' },
  { cols: 2, rows: 1, label: '2×1' },
  { cols: 2, rows: 2, label: '2×2' },
  { cols: 2, rows: 3, label: '2×3' },
];

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
  const charH = fontSize;

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

function formatUptime(startMs: number): string {
  const sec = Math.floor((Date.now() - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
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

/* ── Status badge pill (session list) ── */

interface PillConfig {
  bg: string;
  dot: string;
  dotGlow?: string;
  text: string;
  label: string;
  pulse?: boolean;
}

const STATUS_PILL: Record<string, PillConfig> = {
  active: {
    bg: 'bg-[rgba(34,221,136,0.1)]',
    dot: 'bg-[#2d8]',
    dotGlow: '0 0 5px rgba(34,221,136,0.7)',
    text: 'text-[#2d8]',
    label: 'Rodando',
    pulse: true,
  },
  waiting: {
    bg: 'bg-[rgba(255,170,0,0.1)]',
    dot: 'bg-[#fa0]',
    text: 'text-[#fa0]',
    label: 'Aguardando',
  },
  finished: {
    bg: 'bg-[rgba(68,68,85,0.15)]',
    dot: 'bg-[#445]',
    text: 'text-[#556]',
    label: 'Finalizada',
  },
  exited: {
    bg: 'bg-[rgba(68,68,85,0.15)]',
    dot: 'bg-[#445]',
    text: 'text-[#556]',
    label: 'Finalizada',
  },
  killed: {
    bg: 'bg-[rgba(255,85,68,0.1)]',
    dot: 'bg-[#f54]',
    text: 'text-[#f54]',
    label: 'Encerrada',
  },
};

function SessionStatusPill({ status }: { status: string }) {
  const cfg: PillConfig = STATUS_PILL[status] ?? {
    bg: 'bg-[rgba(68,68,85,0.15)]',
    dot: 'bg-[#445]',
    text: 'text-[#556]',
    label: status,
  };

  return (
    <span className={`inline-flex items-center gap-[4px] rounded-full px-[8px] py-[2px] ${cfg.bg}`}>
      <span
        className={`size-[6px] shrink-0 rounded-[3px] ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`}
        style={cfg.dotGlow ? { boxShadow: cfg.dotGlow } : undefined}
      />
      <span className={`font-['Inter'] text-[11px] font-medium ${cfg.text}`}>{cfg.label}</span>
    </span>
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
    <aside className="flex flex-1 min-h-0 w-[220px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#111118]">
      {/* Header: back + project name */}
      <div className="flex shrink-0 flex-col border-b border-[rgba(255,255,255,0.08)] px-[16px] pt-[19px] pb-[12px] gap-[6px]">
        <button
          onClick={onBack}
          className="flex items-center gap-[4px] w-fit font-['Inter'] text-[11px] text-[#556] hover:text-[#889] transition-colors"
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
        <p className="font-['Inter'] text-[11px] text-[#556]">
          {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''}
          {liveCount > 0 ? ` · ${liveCount} ativa${liveCount !== 1 ? 's' : ''}` : ''}
        </p>
      </div>

      {/* New Session button */}
      <div className="shrink-0 px-[16px] pt-[12px] pb-[8px] flex flex-col gap-[6px]">
        <button
          onClick={onCreateSession}
          disabled={creating}
          className="flex w-full items-center justify-center gap-[6px] rounded-[5px] bg-[#af0] py-[8px] font-['Inter'] text-[13px] font-semibold text-black hover:bg-[#9e0] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
            className="flex w-full items-center justify-center gap-[5px] rounded-[5px] border border-[rgba(255,255,255,0.07)] py-[6px] font-['Inter'] text-[12px] font-medium text-[#556] hover:border-[rgba(255,85,85,0.25)] hover:text-[#f54] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 2.5h7M4.5 2.5V2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v.5M3 2.5l.5 6h4l.5-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Limpar {deadCount} finalizada{deadCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-[8px] pb-[8px]">
        {sessions.length === 0 ? (
          <p className="px-[8px] py-[12px] font-['Inter'] text-[11px] text-[#445]">
            Nenhuma sessão ainda
          </p>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {sessions.map((session, idx) => {
              const isActive = session.sessionId === activeSessionId && !showCanvas;
              const isDead = DEAD_STATUSES.has(session.status);
              const isRenaming = renaming === session.sessionId;

              return (
                <div
                  key={session.sessionId}
                  className={`group relative flex flex-col gap-[4px] rounded-[5px] border px-[13px] py-[9px] transition-colors ${
                    isActive
                      ? 'border-[rgba(170,255,0,0.2)] bg-[rgba(170,255,0,0.12)]'
                      : 'border-transparent hover:bg-[rgba(255,255,255,0.04)]'
                  } ${isDead ? 'opacity-60' : ''}`}
                  data-testid={`session-item-${session.sessionId}`}
                >
                  {/* Row 1: index + name / rename input + time + pencil */}
                  <div
                    className="flex items-center justify-between w-full cursor-pointer"
                    onClick={() => !isRenaming && onSelectSession(session.sessionId)}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => handleRenameKeyDown(e, session.sessionId)}
                        onBlur={() => commitRename(session.sessionId)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 rounded-[4px] border border-[rgba(170,255,0,0.3)] bg-[#1a1a23] px-[6px] py-[1px] font-['Inter'] text-[12px] text-[#f0f0f0] outline-none"
                        data-testid={`rename-input-${session.sessionId}`}
                      />
                    ) : (
                      <>
                        <span
                          className={`font-['JetBrains_Mono'] text-[11px] truncate max-w-[95px] ${isActive ? 'text-[#af0]' : 'text-[#889]'}`}
                          onDoubleClick={(e) => startRename(session, e)}
                          title="Duplo clique para renomear"
                        >
                          #{idx + 1} · {session.name}
                        </span>
                        <div className="flex items-center gap-[4px] ml-[4px] shrink-0">
                          <span className="font-['Inter'] text-[11px] text-[#556]">
                            {formatRelativeTime(session.createdAt)}
                          </span>
                          <button
                            className="hidden group-hover:flex items-center justify-center size-[14px] rounded-[3px] text-[#445] hover:text-[#889] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
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
                        </div>
                      </>
                    )}
                  </div>

                  {/* Row 2: status pill */}
                  <div
                    className="cursor-pointer"
                    onClick={() => !isRenaming && onSelectSession(session.sessionId)}
                  >
                    <SessionStatusPill status={session.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Canvas nav item — below session list */}
      <div className="shrink-0 border-t border-[rgba(255,255,255,0.08)] p-[8px]">
        <button
          onClick={onSelectCanvas}
          className={`flex w-full items-center gap-[8px] rounded-[5px] px-[12px] py-[9px] font-['Inter'] text-[13px] font-medium transition-colors ${
            showCanvas
              ? 'border border-[rgba(170,255,0,0.2)] bg-[rgba(170,255,0,0.12)] text-[#af0]'
              : 'border border-transparent text-[#889] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#ccd]'
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
  canvasLayout,
  onLayoutChange,
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
  canvasLayout: Pick<CanvasLayout, 'cols' | 'rows'>;
  onLayoutChange: (dims: { cols: number; rows: number }) => void;
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
      className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[20px] py-[10px]"
      data-testid="page-header"
    >
      {/* Breadcrumb + connection status */}
      <div className="flex items-center gap-[6px] min-w-0">
        {/* Hamburger — visible only below md breakpoint */}
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex items-center justify-center size-[32px] shrink-0 rounded-[5px] text-[#889] hover:text-[#f0f0f0] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          data-testid="sidebar-toggle"
        >
          {sidebarOpen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>

        <span className="font-['Inter'] text-[13px] text-[#889] shrink-0 truncate">{projectName}</span>

        {showCanvas ? (
          <>
            <span className="font-['Inter'] text-[13px] text-[#556]">/</span>
            <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">Canvas</span>
          </>
        ) : (
          <>
            {sessionName && (
              <>
                <span className="font-['Inter'] text-[13px] text-[#556]">/</span>
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
        <div className="hidden md:flex items-center gap-[8px] shrink-0">
          {/* Files toggle button */}
          <button
            onClick={onToggleCanvasFiles}
            className={`flex items-center gap-[5px] rounded-[5px] px-[8px] py-[4px] font-['Inter'] text-[11px] font-medium transition-colors ${
              canvasShowFiles
                ? 'bg-[rgba(170,255,0,0.12)] border border-[rgba(170,255,0,0.25)] text-[#af0]'
                : 'border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]'
            }`}
            title={canvasShowFiles ? 'Fechar arquivos' : 'Abrir arquivos'}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 2h4l1 1.5H9.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5V2.5a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            </svg>
            Files
          </button>

          <div className="h-[14px] w-px bg-[rgba(255,255,255,0.08)]" />

          {/* Layout picker */}
          <span className="font-['Inter'] text-[11px] text-[#556]">Layout:</span>
          <div className="flex items-center gap-[4px]" role="group" aria-label="Layout do canvas">
            {CANVAS_LAYOUTS.map((opt) => {
              const isActive = canvasLayout.cols === opt.cols && canvasLayout.rows === opt.rows;
              return (
                <button
                  key={opt.label}
                  onClick={() => onLayoutChange({ cols: opt.cols, rows: opt.rows })}
                  aria-pressed={isActive}
                  className={`rounded-[5px] px-[8px] py-[4px] font-['JetBrains_Mono'] text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'bg-[rgba(170,255,0,0.15)] text-[#af0] border border-[rgba(170,255,0,0.3)]'
                      : 'border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]'
                  }`}
                  data-testid={`layout-btn-${opt.label}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Session action buttons */
        hasActiveSession && (
          <div className="flex items-center gap-[8px] shrink-0 ml-[16px]">
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
                <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">{killing ? 'Killing…' : 'Kill'}</span>
            </button>
          </div>
        )
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
      className="flex shrink-0 items-center gap-[24px] border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[20px]"
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
              : 'text-[#889] hover:text-[#ccd]'
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

function TerminalStatusBar({
  connectionStatus,
  sessionCreatedAt,
  fontSize,
  defaultFontSize,
  themeId,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onThemeChange,
  mobileKeyboard,
}: {
  connectionStatus: ConnectionStatus;
  sessionCreatedAt: number | null;
  fontSize: number;
  defaultFontSize: number;
  themeId: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onThemeChange: (id: string) => void;
  mobileKeyboard?: React.ReactNode;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!sessionCreatedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [sessionCreatedAt]);

  const isConnected = connectionStatus === 'connected';

  const startMs = sessionCreatedAt
    ? sessionCreatedAt > 1e12
      ? sessionCreatedAt
      : sessionCreatedAt * 1000
    : null;

  const isDefault = fontSize === defaultFontSize;

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-[rgba(170,255,0,0.1)] bg-[rgba(170,255,0,0.06)] px-[20px] py-[5px]">
      <div className="flex items-center gap-[10px]">
        {sessionCreatedAt && (
          <span className="flex items-center gap-[6px]">
            <span
              className={`size-[6px] rounded-[3px] ${isConnected ? 'bg-[#2d8]' : 'bg-[#445]'}`}
              style={isConnected ? { boxShadow: '0 0 4px rgba(34,221,136,0.5)' } : undefined}
            />
            <span className="font-['JetBrains_Mono'] text-[11px] text-[rgba(170,255,0,0.6)]">
              {isConnected ? 'Connected' : connectionStatus}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-[8px]">
        {startMs && (
          <span className="hidden sm:block font-['JetBrains_Mono'] text-[11px] text-[rgba(170,255,0,0.4)]" key={tick}>
            uptime {formatUptime(startMs)}
          </span>
        )}

        <ThemePicker themeId={themeId} onChange={onThemeChange} />

        <div className="h-[14px] w-px bg-[rgba(170,255,0,0.12)]" />

        {/* Zoom controls */}
        <div className="flex items-center gap-[2px]">
          <button
            onClick={onZoomOut}
            disabled={fontSize <= FONT_SIZE_MIN}
            title="Diminuir fonte (Ctrl+-)"
            className="flex items-center justify-center h-[20px] w-[20px] rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] hover:text-[rgba(170,255,0,0.9)] hover:bg-[rgba(170,255,0,0.1)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
          >
            A<span className="text-[8px] leading-none relative top-[1px]">-</span>
          </button>

          <button
            onClick={onZoomReset}
            title={`Fonte: ${fontSize}px — clique para resetar (Ctrl+0)`}
            className={`flex items-center justify-center h-[20px] min-w-[28px] px-[4px] rounded-[3px] font-['JetBrains_Mono'] text-[10px] transition-colors select-none ${
              isDefault
                ? 'text-[rgba(170,255,0,0.3)] hover:text-[rgba(170,255,0,0.6)] hover:bg-[rgba(170,255,0,0.06)]'
                : 'text-[rgba(170,255,0,0.8)] hover:text-[rgba(170,255,0,1)] bg-[rgba(170,255,0,0.08)] hover:bg-[rgba(170,255,0,0.14)]'
            }`}
          >
            {fontSize}px
          </button>

          <button
            onClick={onZoomIn}
            disabled={fontSize >= FONT_SIZE_MAX}
            title="Aumentar fonte (Ctrl++)"
            className="flex items-center justify-center h-[20px] w-[20px] rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] hover:text-[rgba(170,255,0,0.9)] hover:bg-[rgba(170,255,0,0.1)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
          >
            A<span className="text-[8px] leading-none relative top-[1px]">+</span>
          </button>
        </div>

        {mobileKeyboard && (
          <>
            <div className="h-[14px] w-px bg-[rgba(170,255,0,0.12)]" />
            {mobileKeyboard}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Empty state ── */

function EmptyTerminalState({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-[20px] p-8"
      data-testid="empty-state"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-[#445]">
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
      <div className="text-center">
        <h2 className="font-['Inter'] text-[18px] font-semibold text-[#f0f0f0]">
          No active session
        </h2>
        <p className="mt-[6px] font-['Inter'] text-[14px] text-[#889]">
          Create a session to open a terminal for this project
        </p>
      </div>
      <button
        onClick={onCreate}
        disabled={creating}
        className="flex items-center gap-[8px] rounded-[6px] bg-[#af0] px-[20px] py-[10px] font-['Inter'] text-[14px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        data-testid="new-session-button"
      >
        {creating ? (
          <>
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
              <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

        const resolvedId = urlSession && !DEAD_STATUSES.has(urlSession.status)
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Poll every 10 s
  useEffect(() => {
    const id = setInterval(fetchSessions, 10_000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  useEffect(() => {
    const handler = () => { fetchSessions(); };
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
  const { layout: canvasLayout, setCanvasLayout, assignSlot, clearSlot } = useCanvasState(
    projectId ?? '',
    sessions,
  );

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
    terminalRef.current?.resize();
  }, []);

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

  const handleSessionStatusChange = useCallback((status: string) => {
    if (status === 'exited' || status === 'killed' || status === 'finished') {
      fetchSessions();
    }
  }, [fetchSessions]);

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
  useEffect(() => { fontSizeRef.current = fontSize; }, [fontSize]);

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
    <div className="flex overflow-hidden bg-[#0a0a0f]" style={{ height: `${viewportHeight}px` }}>

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
          border-r border-[rgba(255,255,255,0.08)] bg-[#111118]
          transition-transform duration-200 ease-out
          md:relative md:inset-auto md:z-auto md:translate-x-0
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
            canvasLayout={canvasLayout}
            onLayoutChange={setCanvasLayout}
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
                hideKeyboardFAB
              />
            ) : (
              <>
                {/* File navigation panel (desktop, collapsible) */}
                {canvasShowFiles && (
                  <div className="flex shrink-0 border-r border-[rgba(255,255,255,0.08)]" style={{ width: '460px' }}>
                    {!canvasFilesOpenPath ? (
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <FileTree
                          projectId={projectId}
                          onFileOpen={(_pid, filePath) => setCanvasFilesOpenPath(filePath)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-1 overflow-hidden">
                        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[rgba(255,255,255,0.08)]">
                          <FileTree
                            projectId={projectId}
                            onFileOpen={(_pid, filePath) => setCanvasFilesOpenPath(filePath)}
                          />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <CodeEditor
                            projectId={projectId}
                            initialFilePath={canvasFilesOpenPath}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Canvas grid */}
                <CanvasGrid
                  cols={canvasLayout.cols}
                  rows={canvasLayout.rows}
                  slots={canvasLayout.slots}
                  sessions={sessions}
                  fontSize={fontSize}
                  theme={getThemeById(themeId).xterm}
                  onAssign={assignSlot}
                  onRemove={clearSlot}
                  onCreateSession={handleCanvasCreateSession}
                  onRename={handleRenameSession}
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
                <p
                  className="font-['Inter'] text-[15px] text-red-400"
                  data-testid="error-message"
                >
                  {sessionsError}
                </p>
                <button
                  onClick={() => {
                    setSessionsError(null);
                    fetchSessions();
                  }}
                  className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] text-[#889] hover:text-[#ccd] transition-colors"
                  data-testid="retry-button"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* ── Terminal tab — kept mounted via CSS display ── */}
            {!sessionsError && (
              <div
                className="flex flex-1 min-h-0 flex-col"
                style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
              >
                {sessionsLoading ? (
                  <div
                    className="flex flex-1 items-center justify-center"
                    data-testid="loading-state"
                  >
                    <svg className="animate-spin size-[28px] text-[#556]" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                ) : activeSessionId ? (
                  <>
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
                        className="relative h-full min-h-0 w-full overflow-hidden rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f]"
                        data-testid="terminal-container"
                      >
                        <XTermTerminal
                          ref={terminalRef}
                          sessionId={activeSessionId}
                          onResize={onResize}
                          onConnectionStatus={setConnectionStatus}
                          onStatusChange={handleSessionStatusChange}
                          onCreateNewSession={handleCreateSession}
                          fontSize={fontSize}
                          theme={getThemeById(themeId).xterm}
                          hideMobileFAB={isMobile}
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
                  <div className="w-[260px] shrink-0 overflow-y-auto border-r border-[rgba(255,255,255,0.08)]">
                    <FileTree
                      projectId={projectId}
                      onFileOpen={(_pid, filePath) => setFilesOpenPath(filePath)}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <CodeEditor projectId={projectId} initialFilePath={filesOpenPath || undefined} />
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
          mobileKeyboard={isMobile && (showCanvas || (activeTab === 'terminal' && !!activeSessionId)) ? (
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
                navigator.clipboard.readText().then((text) => {
                  if (!text) return;
                  if (showCanvas) canvasMobileRef.current?.sendKey(text);
                  else terminalRef.current?.sendKey(text);
                }).catch(() => {});
              }}
            />
          ) : undefined}
        />
      </div>
    </div>
  );
}
