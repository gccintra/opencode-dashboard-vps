import { useState, useCallback, useRef } from 'react';
import { XTermTerminal } from '../Terminal';
import { apiFetch } from '../../lib/api';
import type { ITheme } from '@xterm/xterm';

export interface AvailableSession {
  sessionId: string;
  name: string;
  status: string;
}

export interface CanvasSlotProps {
  slotIndex: number;
  sessionId: string | null;
  sessionName: string | null;
  sessionStatus: string | null;
  isFocused: boolean;
  availableSessions: AvailableSession[];
  fontSize?: number;
  onFocus: (slotIndex: number) => void;
  onAssignSession: (slotIndex: number, sessionId: string) => void;
  onRemoveSession: (slotIndex: number) => void;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (newName: string) => Promise<void>;
  theme?: ITheme;
}

function SlotHeader({
  sessionName,
  sessionStatus,
  onRemove,
  onRename,
}: {
  sessionName: string;
  sessionStatus: string | null;
  onRemove: () => void;
  onRename?: (newName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

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
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(170,255,0,0.3)] rounded-[3px] px-[5px] py-[1px] font-['Inter'] text-[11px] text-[#f0f0f0] focus:outline-none"
          />
        ) : (
          <span
            className={`font-['Inter'] text-[11px] text-[#889] truncate ${onRename ? 'cursor-text hover:text-[#bbc]' : ''}`}
            onClick={onRename ? startEdit : undefined}
            title={onRename ? 'Clique para renomear' : undefined}
          >
            {sessionName}
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
      <button
        onClick={onRemove}
        className="shrink-0 flex items-center justify-center size-[18px] rounded-[3px] text-[#556] hover:text-[#f54] hover:bg-[rgba(255,85,68,0.1)] transition-colors"
        title="Remover do canvas"
        aria-label="Remover sessão do slot"
        data-testid="remove-slot-btn"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
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
      <div className="flex flex-col items-center gap-[6px] text-[#445]">
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
          className="w-full max-w-[160px] rounded-[5px] border border-[rgba(255,255,255,0.08)] bg-[#1a1a23] px-[8px] py-[5px] font-['Inter'] text-[12px] text-[#889] focus:outline-none focus:border-[rgba(170,255,0,0.3)]"
          aria-label="Selecionar sessão"
          data-testid={`slot-session-select-${slotIndex}`}
        >
          <option value="" disabled>Selecionar sessão…</option>
          {availableSessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {onCreateSession && (
        <button
          onClick={onCreateSession}
          className="flex items-center gap-[5px] rounded-[5px] bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.2)] px-[12px] py-[6px] font-['Inter'] text-[12px] font-medium text-[#af0] hover:bg-[rgba(170,255,0,0.16)] transition-colors"
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
  isFocused,
  availableSessions,
  fontSize,
  onFocus,
  onAssignSession,
  onRemoveSession,
  onCreateSession,
  onRename,
  theme,
}: CanvasSlotProps) {
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDimsRef = useRef<{ cols: number; rows: number } | null>(null);

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
    ? isFocused
      ? 'border-[#af0]'
      : 'border-[rgba(255,255,255,0.08)]'
    : 'border-dashed border-[rgba(255,255,255,0.1)]';

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-[6px] border bg-[#0a0a0f] transition-all ${borderStyle} ${
        sessionId && !isFocused ? 'opacity-[0.95]' : ''
      }`}
      onClick={sessionId ? handleFocus : undefined}
      data-testid={`canvas-slot-${slotIndex}`}
    >
      {sessionId ? (
        <>
          <SlotHeader
            sessionName={sessionName ?? 'Sessão'}
            sessionStatus={sessionStatus}
            onRemove={handleRemove}
            onRename={onRename}
          />
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <XTermTerminal
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
