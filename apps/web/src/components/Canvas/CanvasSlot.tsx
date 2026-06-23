import { useState, useCallback, useRef, useEffect } from 'react';
import { XTermTerminal } from '../Terminal';
import type { XTermTerminalHandle } from '../Terminal';
import { apiFetch } from '../../lib/api';
import type { ITheme } from '@xterm/xterm';

export interface AvailableSession {
  sessionId: string;
  name: string;
  status: string;
  projectName?: string;
}

export interface CanvasSlotProps {
  slotIndex: number;
  sessionId: string | null;
  sessionName: string | null;
  sessionStatus: string | null;
  sessionProjectName?: string | null;
  isFocused: boolean;
  availableSessions: AvailableSession[];
  fontSize?: number;
  onFocus: (slotIndex: number) => void;
  onAssignSession: (slotIndex: number, sessionId: string) => void;
  onRemoveSession: (slotIndex: number) => void;
  onKillSession?: () => Promise<void>;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (newName: string) => Promise<void>;
  theme?: ITheme;
  isDragging?: boolean;
  isOver?: boolean;
  containerRef?: React.Ref<HTMLDivElement>;
  headerRef?: React.Ref<HTMLDivElement>;
  headerDragProps?: React.HTMLAttributes<HTMLDivElement>;
}

function SlotHeader({
  sessionName,
  sessionStatus,
  projectName,
  onRemove,
  onKill,
  onRename,
  onReconnect,
  onFit,
}: {
  sessionName: string;
  sessionStatus: string | null;
  projectName?: string | null;
  onRemove: () => void;
  onKill?: () => Promise<void>;
  onRename?: (newName: string) => Promise<void>;
  onReconnect?: () => void;
  onFit?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [killPending, setKillPending] = useState(false);
  const killTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKillClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!killPending) {
      setKillPending(true);
      killTimerRef.current = setTimeout(() => setKillPending(false), 3000);
    } else {
      if (killTimerRef.current) clearTimeout(killTimerRef.current);
      setKillPending(false);
      onKill?.().catch(() => {});
    }
  }, [killPending, onKill]);

  const startEdit = useCallback(() => {
    setEditValue(sessionName);
    setEditing(true);
  }, [sessionName]);

  const saveEdit = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== sessionName && onRename) {
      await onRename(trimmed).catch(() => {});
    }
  }, [editValue, sessionName, onRename]);

  return (
    <div className="flex shrink-0 items-center justify-between px-[10px] py-[6px] border-b border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-[6px] min-w-0 flex-1 mr-[4px]">
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') void saveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={saveEdit}
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(179,229,2,0.3)] rounded-[3px] px-[5px] py-[1px] font-['Inter'] text-[11px] text-[#f0f0f0] focus:outline-none"
          />
        ) : (
          <span
            className={`font-['Inter'] text-[11px] truncate ${onRename ? 'cursor-text hover:text-[#bbc]' : ''}`}
            onClick={onRename ? startEdit : undefined}
            title={onRename ? 'Clique para renomear' : undefined}
          >
            {projectName && (
              <span className="text-[#5a626c]">{projectName} — </span>
            )}
            <span className="text-[#9aa3ad]">{sessionName}</span>
          </span>
        )}
        {!editing && sessionStatus && (
          <span
            className={`shrink-0 inline-block size-[6px] rounded-full ${
              sessionStatus === 'active'
                ? 'bg-[#2d8]'
                : sessionStatus === 'waiting'
                  ? 'bg-[#fa0]'
                  : 'bg-[#445]'
            }`}
          />
        )}
      </div>
      <div className="flex items-center gap-[2px] shrink-0">
        {onReconnect && (
          <button
            onClick={(e) => { e.stopPropagation(); onReconnect(); }}
            className="flex items-center justify-center size-[18px] rounded-[3px] text-[#2d8] hover:bg-[rgba(34,221,136,0.1)] transition-colors"
            title="Reconectar terminal"
            aria-label="Reconectar terminal"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M10.5 6A4.5 4.5 0 1 1 7.5 1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M7.5 1.5l1.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onFit && (
          <button
            onClick={(e) => { e.stopPropagation(); onFit(); }}
            className="flex items-center justify-center size-[18px] rounded-[3px] text-[#6af] hover:bg-[rgba(100,160,255,0.1)] transition-colors"
            title="Ajustar layout do terminal"
            aria-label="Ajustar layout do terminal"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {onKill && (
          <button
            onClick={handleKillClick}
            className={`flex items-center justify-center h-[18px] rounded-[3px] transition-colors ${
              killPending
                ? 'px-[5px] bg-[rgba(255,85,68,0.18)] text-[#f54] text-[9px] font-semibold font-[\'Inter\']'
                : 'size-[18px] text-[#5a626c] hover:text-[#f54] hover:bg-[rgba(255,85,68,0.1)]'
            }`}
            title={killPending ? 'Clique novamente para confirmar' : 'Encerrar sessão'}
            aria-label="Encerrar sessão"
          >
            {killPending ? 'Kill?' : (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M4 6h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        )}
        <button
          onClick={onRemove}
          className="flex items-center justify-center size-[18px] rounded-[3px] text-[#5a626c] hover:text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          title="Remover do canvas (mantém sessão ativa)"
          aria-label="Remover sessão do slot"
          data-testid="remove-slot-btn"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EmptySlotPlaceholder({
  slotIndex,
  availableSessions,
  onAssign,
  onCreateSession,
}: {
  slotIndex: number;
  availableSessions: AvailableSession[];
  onAssign: (sessionId: string) => void;
  onCreateSession?: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-[12px] p-[16px]"
      data-testid={`slot-placeholder-${slotIndex}`}
    >
      <div className="flex flex-col items-center gap-[6px] text-[#5a626c]">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="3" y="5" width="22" height="18" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M14 10v8M10 14h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="font-['Inter'] text-[12px]">Adicionar Terminal</span>
      </div>

      {availableSessions.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) onAssign(e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className="w-full max-w-[160px] rounded-[5px] border border-white/[0.07] bg-[#0a0a0f] px-[8px] py-[5px] font-['Inter'] text-[12px] text-[#9aa3ad] focus:outline-none focus:border-[rgba(179,229,2,0.3)]"
          aria-label="Selecionar sessão"
          data-testid={`slot-session-select-${slotIndex}`}
        >
          <option value="" disabled>Selecionar sessão…</option>
          {availableSessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.projectName ? `${s.projectName} — ${s.name}` : s.name}
            </option>
          ))}
        </select>
      )}

      {onCreateSession && (
        <button
          onClick={onCreateSession}
          className="flex items-center gap-[5px] rounded-[5px] bg-[rgba(179,229,2,0.1)] border border-[rgba(179,229,2,0.2)] px-[12px] py-[6px] font-['Inter'] text-[12px] font-medium text-[#b3e502] hover:bg-[rgba(179,229,2,0.16)] transition-colors"
          data-testid={`slot-new-session-btn-${slotIndex}`}
        >
          <span className="text-[14px] leading-none font-light">+</span>
          Nova Sessão
        </button>
      )}
    </div>
  );
}

export function CanvasSlot({
  slotIndex,
  sessionId,
  sessionName,
  sessionStatus,
  sessionProjectName,
  isFocused,
  availableSessions,
  fontSize,
  onFocus,
  onAssignSession,
  onRemoveSession,
  onKillSession,
  onCreateSession,
  onRename,
  theme,
  isDragging = false,
  isOver = false,
  containerRef,
  headerRef,
  headerDragProps,
}: CanvasSlotProps) {
  const terminalRef = useRef<XTermTerminalHandle | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  // TUI sessions replay their buffer at the slot dimensions, but opencode may
  // not process the first SIGWINCH while busy mid-task. resize() also forces the
  // renderer to re-measure its canvas (fixes the Canvas garble). The 500ms shot
  // runs just after the 200ms panel CSS transition settles so the fix is near-
  // instant on open; 1.5s/3s cover a busy/late-idle TUI.
  useEffect(() => {
    if (!sessionId) return;
    const t0 = setTimeout(() => terminalRef.current?.resize(), 500);
    const t1 = setTimeout(() => terminalRef.current?.resize(), 1500);
    const t2 = setTimeout(() => terminalRef.current?.resize(), 3000);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [sessionId]);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      latestDimsRef.current = { cols, rows };
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null;
        const dims = latestDimsRef.current;
        if (!dims) return;
        apiFetch(`/api/sessions/${sessionId}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols: dims.cols, rows: dims.rows }),
        }).catch(() => {});
      }, 300);
    },
    [sessionId],
  );

  const handleAssign = useCallback(
    (sid: string) => onAssignSession(slotIndex, sid),
    [slotIndex, onAssignSession],
  );

  const handleCreate = useCallback(async () => {
    if (!onCreateSession) return;
    const newId = await onCreateSession();
    if (newId) onAssignSession(slotIndex, newId);
  }, [slotIndex, onCreateSession, onAssignSession]);

  const handleRemove = useCallback(
    () => onRemoveSession(slotIndex),
    [slotIndex, onRemoveSession],
  );

  const handleFocus = useCallback(
    () => onFocus(slotIndex),
    [slotIndex, onFocus],
  );

  const borderStyle = sessionId
    ? isOver
      ? 'border-[#b3e502]'
      : isFocused
        ? 'border-[rgba(179,229,2,0.35)]'
        : 'border-white/[0.07]'
    : isOver
      ? 'border-[#b3e502] border-solid'
      : 'border-dashed border-[rgba(255,255,255,0.1)]';

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col overflow-hidden rounded-[6px] border bg-[#0a0a0f] transition-all h-full ${borderStyle} ${
        isDragging ? 'opacity-20 pointer-events-none select-none' : sessionId && !isFocused ? 'opacity-[0.95]' : ''
      }`}
      onClick={sessionId ? handleFocus : undefined}
      data-testid={`canvas-slot-${slotIndex}`}
    >
      {sessionId ? (
        <>
          <div
            ref={headerRef}
            {...headerDragProps}
            style={{ cursor: headerDragProps ? 'grab' : undefined }}
          >
            <SlotHeader
              sessionName={sessionName ?? 'Sessão'}
              sessionStatus={sessionStatus}
              projectName={sessionProjectName}
              onRemove={handleRemove}
              onKill={onKillSession}
              onRename={onRename}
              onReconnect={() => terminalRef.current?.reconnect()}
              onFit={() => { terminalRef.current?.resize(); terminalRef.current?.reconnect(); }}
            />
          </div>
          <div
            className="relative flex-1 min-h-0 overflow-hidden"
            style={{ backgroundColor: theme?.background ?? '#1e1e2e' }}
          >
            <XTermTerminal
              key={sessionId}
              ref={terminalRef}
              sessionId={sessionId}
              onResize={handleResize}
              fontSize={fontSize}
              theme={theme}
            />
          </div>
        </>
      ) : (
        <EmptySlotPlaceholder
          slotIndex={slotIndex}
          availableSessions={availableSessions}
          onAssign={handleAssign}
          onCreateSession={handleCreate}
        />
      )}
    </div>
  );
}
