import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { XTermTerminal, type XTermTerminalHandle, type ConnectionStatus } from '../components/Terminal';
import { apiFetch } from '../lib/api';

/* ── Constants ── */

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_DEFAULT_MOBILE = 12;

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
  const [height, setHeight] = useState(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
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

/* ── Status bar ── */

function StatusBar({
  connStatus,
  sessionName,
  fontSize,
  defaultFontSize,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  connStatus: ConnectionStatus;
  sessionName: string;
  fontSize: number;
  defaultFontSize: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  const isConnected = connStatus === 'connected';
  const isDefault = fontSize === defaultFontSize;

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-[rgba(170,255,0,0.1)] bg-[rgba(170,255,0,0.06)] px-[16px] py-[5px]">
      {/* Left: connection + session name */}
      <div className="flex min-w-0 items-center gap-[8px]">
        <span
          className={`size-[6px] shrink-0 rounded-[3px] ${isConnected ? 'bg-[#2d8]' : 'bg-[#445]'}`}
          style={isConnected ? { boxShadow: '0 0 4px rgba(34,221,136,0.5)' } : undefined}
        />
        <span className="font-['JetBrains_Mono'] text-[11px] text-[rgba(170,255,0,0.6)]">
          {isConnected
            ? 'Connected'
            : connStatus === 'connecting'
              ? 'Connecting…'
              : connStatus === 'reconnecting'
                ? 'Reconnecting…'
                : 'Disconnected'}
        </span>
        {sessionName && (
          <span className="hidden truncate font-['JetBrains_Mono'] text-[11px] text-[rgba(170,255,0,0.3)] sm:block">
            · {sessionName}
          </span>
        )}
      </div>

      {/* Right: zoom controls */}
      <div className="flex items-center gap-[2px]">
        <button
          onClick={onZoomOut}
          disabled={fontSize <= FONT_SIZE_MIN}
          title="Diminuir fonte (Ctrl+-)"
          className="flex h-[20px] w-[20px] select-none items-center justify-center rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] transition-colors hover:bg-[rgba(170,255,0,0.1)] hover:text-[rgba(170,255,0,0.9)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          A<span className="relative top-[1px] text-[8px] leading-none">-</span>
        </button>

        <button
          onClick={onZoomReset}
          title={`Fonte: ${fontSize}px — clique para resetar (Ctrl+0)`}
          className={`flex h-[20px] min-w-[28px] select-none items-center justify-center rounded-[3px] px-[4px] font-['JetBrains_Mono'] text-[10px] transition-colors ${
            isDefault
              ? 'text-[rgba(170,255,0,0.3)] hover:bg-[rgba(170,255,0,0.06)] hover:text-[rgba(170,255,0,0.6)]'
              : 'bg-[rgba(170,255,0,0.08)] text-[rgba(170,255,0,0.8)] hover:bg-[rgba(170,255,0,0.14)] hover:text-[rgba(170,255,0,1)]'
          }`}
        >
          {fontSize}px
        </button>

        <button
          onClick={onZoomIn}
          disabled={fontSize >= FONT_SIZE_MAX}
          title="Aumentar fonte (Ctrl++)"
          className="flex h-[20px] w-[20px] select-none items-center justify-center rounded-[3px] font-['Inter'] text-[11px] font-semibold text-[rgba(170,255,0,0.5)] transition-colors hover:bg-[rgba(170,255,0,0.1)] hover:text-[rgba(170,255,0,0.9)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          A<span className="relative top-[1px] text-[8px] leading-none">+</span>
        </button>
      </div>
    </div>
  );
}

/* ── Page ── */

interface LocationState {
  sessionName?: string;
  projectName?: string;
}

export default function SessionTerminalPage() {
  const navigate = useNavigate();
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const location = useLocation();
  const isMobile = useIsMobile();

  const state = (location.state ?? {}) as LocationState;
  const [sessionName, setSessionName] = useState(state.sessionName ?? '');
  const [projectName] = useState(state.projectName ?? '');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');

  const termRef = useRef<XTermTerminalHandle>(null);
  const handleResize = useDebouncedResize(sessionId);
  const viewportHeight = useViewportHeight();

  /* ── Font size (shared with ProjectDetail via localStorage) ── */
  const defaultFontSize = isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem('terminalFontSize');
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) return n;
    }
    return isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT;
  });

  // Persist changes
  useEffect(() => {
    localStorage.setItem('terminalFontSize', String(fontSize));
  }, [fontSize]);

  // Re-fit after font change (needs one frame for DOM update)
  useEffect(() => {
    const t = setTimeout(() => termRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [fontSize]);

  const handleZoomIn = useCallback(
    () => setFontSize((p) => Math.min(p + 1, FONT_SIZE_MAX)),
    [],
  );
  const handleZoomOut = useCallback(
    () => setFontSize((p) => Math.max(p - 1, FONT_SIZE_MIN)),
    [],
  );
  const handleZoomReset = useCallback(
    () => setFontSize(isMobile ? FONT_SIZE_DEFAULT_MOBILE : FONT_SIZE_DEFAULT),
    [isMobile],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn(); }
      else if (e.key === '-') { e.preventDefault(); handleZoomOut(); }
      else if (e.key === '0') { e.preventDefault(); handleZoomReset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  /* ── Fetch session name if not in state ── */
  useEffect(() => {
    if (sessionName || !projectId || !sessionId) return;
    apiFetch<Array<{ sessionId: string; name: string }>>(`/api/projects/${projectId}/sessions`)
      .then((sessions) => {
        const found = sessions.find((s) => s.sessionId === sessionId);
        if (found) setSessionName(found.name);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = connStatus === 'connected';
  const isConnecting = connStatus === 'connecting' || connStatus === 'reconnecting';

  return (
    <div className="flex flex-col bg-[#0a0a0f]" style={{ height: `${viewportHeight}px` }}>
      {/* ══ Header ══ */}
      <header className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[14px] py-[10px] sm:px-[18px]">
        {/* Left: back + breadcrumb */}
        <div className="flex min-w-0 items-center gap-[8px]">
          <button
            onClick={() => navigate('/sessions')}
            className="flex shrink-0 items-center gap-[5px] rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.18)] hover:text-[#f0f0f0] transition-colors"
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
            <span className="hidden sm:inline">Sessions</span>
          </button>

          {projectName && (
            <>
              <span className="max-w-[80px] truncate font-['Inter'] text-[13px] text-[#556] sm:max-w-[140px]">
                {projectName}
              </span>
              <span className="shrink-0 font-['Inter'] text-[13px] text-[#334]">/</span>
            </>
          )}

          <span className="truncate font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">
            {sessionName || 'Session'}
          </span>

          {/* Connection dot */}
          <span
            className={`size-[6px] shrink-0 rounded-full transition-colors ${
              isConnected
                ? 'bg-[#22dd88]'
                : isConnecting
                  ? 'bg-[#ffaa00] animate-pulse'
                  : 'bg-[#445]'
            }`}
            style={isConnected ? { boxShadow: '0 0 6px rgba(34,221,136,0.5)' } : undefined}
          />
        </div>

        {/* Right: reconnect */}
        <button
          onClick={() => termRef.current?.reconnect()}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-[6px] border border-[rgba(34,221,136,0.2)] bg-[rgba(34,221,136,0.08)] text-[#22dd88] hover:bg-[rgba(34,221,136,0.14)] transition-colors"
          title="Reconectar"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M10.5 6A4.5 4.5 0 1 1 7.5 1.8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path
              d="M7.5 1.5h2.5v2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {/* ══ Terminal ══ */}
      <div className="relative flex-1 overflow-hidden">
        {sessionId && (
          <XTermTerminal
            ref={termRef}
            sessionId={sessionId}
            onResize={handleResize}
            onConnectionStatus={setConnStatus}
            fontSize={fontSize}
            className="absolute inset-0"
          />
        )}
      </div>

      {/* ══ Status bar with zoom ══ */}
      <StatusBar
        connStatus={connStatus}
        sessionName={sessionName}
        fontSize={fontSize}
        defaultFontSize={defaultFontSize}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />
    </div>
  );
}
