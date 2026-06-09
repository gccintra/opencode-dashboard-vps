import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import { XTermTerminal, MobileKeyboard, type XTermTerminalHandle } from '../Terminal';
import { apiFetch } from '../../lib/api';
import type { ITheme } from '@xterm/xterm';

/* ── Types ── */

interface Session {
  sessionId: string;
  name: string;
  status: string;
}

interface CanvasMobileProps {
  projectId: string;
  sessions: Session[];
  fontSize?: number;
  theme?: ITheme;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
}

/* ── Persistence ── */

const MOBILE_KEY_PREFIX = 'canvas-mobile-';
const SLOT_COUNT = 3;

function loadMobileSlots(projectId: string): (string | null)[] {
  try {
    const raw = localStorage.getItem(`${MOBILE_KEY_PREFIX}${projectId}`);
    if (!raw) return Array(SLOT_COUNT).fill(null);
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === SLOT_COUNT &&
      parsed.every((v) => v === null || typeof v === 'string')
    ) {
      return parsed as (string | null)[];
    }
  } catch {
    // ignore
  }
  return Array(SLOT_COUNT).fill(null);
}

function saveMobileSlots(projectId: string, slots: (string | null)[]): void {
  localStorage.setItem(`${MOBILE_KEY_PREFIX}${projectId}`, JSON.stringify(slots));
}

/* ── Hook ── */

function useMobileSlots(projectId: string, sessions: Session[]) {
  const [slots, setSlots] = useState<(string | null)[]>(() => loadMobileSlots(projectId));

  useEffect(() => {
    setSlots(loadMobileSlots(projectId));
  }, [projectId]);

  useEffect(() => {
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    setSlots((prev) => {
      const next = prev.map((id) => (id && liveIds.has(id) ? id : null));
      const changed = next.some((v, i) => v !== prev[i]);
      if (!changed) return prev;
      saveMobileSlots(projectId, next);
      return next;
    });
  }, [sessions, projectId]);

  const assignSlot = useCallback(
    (slotIndex: number, sessionId: string) => {
      setSlots((prev) => {
        const next = [...prev];
        next[slotIndex] = sessionId;
        saveMobileSlots(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const clearSlot = useCallback(
    (slotIndex: number) => {
      setSlots((prev) => {
        const next = [...prev];
        next[slotIndex] = null;
        saveMobileSlots(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  return { slots, assignSlot, clearSlot };
}

/* ── Resize helper ── */

function useSlotResize(sessionId: string | null) {
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

/* ── Slot ── */

interface MobileSlotProps {
  slotIndex: number;
  sessionId: string;
  sessionName: string;
  sessionStatus: string;
  isFocused: boolean;
  collapsed: boolean;
  fontSize?: number;
  theme?: ITheme;
  terminalRef: RefObject<XTermTerminalHandle | null>;
  onToggleFocus: (i: number) => void;
  onRemove: (i: number) => void;
  onRename?: (newName: string) => Promise<void>;
}

function MobileSlot({
  slotIndex,
  sessionId,
  sessionName,
  sessionStatus,
  isFocused,
  collapsed,
  fontSize,
  theme,
  terminalRef,
  onToggleFocus,
  onRemove,
  onRename,
}: MobileSlotProps) {
  const handleResize = useSlotResize(sessionId);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

  const statusColor =
    sessionStatus === 'active' ? '#2d8' : sessionStatus === 'waiting' ? '#fa0' : '#445';

  return (
    <div
      className="flex flex-col overflow-hidden border-b border-[rgba(255,255,255,0.06)] transition-all duration-200 ease-out"
      style={
        collapsed
          ? { flexGrow: 0, flexShrink: 0, height: '40px' }
          : { flexGrow: isFocused ? 1 : 1, flexShrink: 1, flexBasis: 0, minHeight: '96px' }
      }
      data-testid={`mobile-slot-${slotIndex}`}
    >
      {/* Header — tap to toggle focus */}
      <div
        className={`flex shrink-0 w-full items-center gap-[10px] px-[14px] h-[40px] transition-colors cursor-pointer select-none ${
          isFocused ? 'bg-[rgba(170,255,0,0.07)]' : 'bg-[#0d0d14] active:bg-[rgba(255,255,255,0.04)]'
        }`}
        onClick={() => onToggleFocus(slotIndex)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggleFocus(slotIndex)}
        data-testid={`mobile-slot-header-${slotIndex}`}
      >
        <span
          className="shrink-0 size-[7px] rounded-full"
          style={{
            backgroundColor: statusColor,
            boxShadow: sessionStatus === 'active' ? `0 0 5px ${statusColor}88` : undefined,
          }}
        />
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
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(170,255,0,0.3)] rounded-[3px] px-[6px] py-[2px] font-['Inter'] text-[12px] text-[#f0f0f0] focus:outline-none"
          />
        ) : (
          <span
            className={`flex-1 min-w-0 truncate font-['Inter'] text-[12px] ${
              isFocused ? 'text-[#f0f0f0] font-semibold' : 'text-[#667]'
            }`}
          >
            {sessionName}
          </span>
        )}
        {/* Pencil — only when focused and not editing */}
        {isFocused && !editing && onRename && (
          <button
            onClick={startEdit}
            className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#556] active:text-[#af0] active:bg-[rgba(170,255,0,0.1)] transition-colors"
            aria-label="Renomear sessão"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {isFocused && !editing && (
          <span className="shrink-0 h-[14px] w-[2px] rounded-full bg-[#af0]" />
        )}
        {/* Reconectar */}
        <button
          onClick={(e) => { e.stopPropagation(); terminalRef.current?.reconnect(); }}
          className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#2d8] active:bg-[rgba(34,221,136,0.1)] transition-colors"
          aria-label="Reconectar terminal"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M10.5 6A4.5 4.5 0 1 1 7.5 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M7.5 1.5l1.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Remove */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(slotIndex); }}
          className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#445] active:text-[#f54] active:bg-[rgba(255,85,68,0.1)] transition-colors"
          aria-label="Remover sessão"
          data-testid={`mobile-slot-remove-${slotIndex}`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Terminal — hidden when collapsed to only show header */}
      <div className={`relative flex-1 min-h-0 overflow-hidden ${collapsed ? 'hidden' : ''}`}>
        <XTermTerminal
          ref={terminalRef}
          sessionId={sessionId}
          onResize={handleResize}
          fontSize={fontSize}
          theme={theme}
          hideMobileFAB
        />
      </div>
    </div>
  );
}

/* ── Add session dropdown (anchors downward from top bar) ── */

interface AddDropdownProps {
  availableSessions: Session[];
  onAssign: (sessionId: string) => void;
  onCreate?: () => void;
  onDismiss: () => void;
}

function AddDropdown({ availableSessions, onAssign, onCreate, onDismiss }: AddDropdownProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-10"
        onClick={onDismiss}
        aria-hidden="true"
      />
      {/* Dropdown panel — anchors below the top bar */}
      <div
        className="absolute top-[40px] right-0 z-20 w-[240px] flex flex-col rounded-b-[10px] rounded-tl-[10px] border border-[rgba(255,255,255,0.08)] bg-[#111118] shadow-xl overflow-hidden"
        data-testid="add-dropdown"
      >
        <div className="px-[12px] pt-[12px] pb-[4px]">
          <p className="font-['Inter'] text-[11px] text-[#445]">Adicionar terminal</p>
        </div>

        {availableSessions.length > 0 && (
          <div className="flex flex-col px-[8px] pb-[4px] gap-[2px]">
            {availableSessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => onAssign(s.sessionId)}
                className="flex items-center gap-[8px] rounded-[6px] px-[10px] py-[9px] text-left active:bg-[rgba(255,255,255,0.06)] transition-colors"
                data-testid={`dropdown-session-${s.sessionId}`}
              >
                <span
                  className="shrink-0 size-[7px] rounded-full"
                  style={{
                    backgroundColor:
                      s.status === 'active' ? '#2d8' : s.status === 'waiting' ? '#fa0' : '#445',
                  }}
                />
                <span className="flex-1 min-w-0 truncate font-['Inter'] text-[13px] text-[#ccd]">
                  {s.name}
                </span>
              </button>
            ))}
            <div className="h-px bg-[rgba(255,255,255,0.06)] mx-[2px] my-[4px]" />
          </div>
        )}

        {onCreate && (
          <div className="px-[8px] pb-[10px]">
            <button
              onClick={onCreate}
              className="flex w-full items-center justify-center gap-[6px] rounded-[6px] bg-[#af0] py-[10px] font-['Inter'] text-[13px] font-semibold text-black active:bg-[#9e0] transition-colors"
              data-testid="dropdown-new-session-btn"
            >
              <span className="text-[16px] leading-none font-light">+</span>
              Nova Sessão
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Top bar ── */

function TopBar({
  filledCount,
  canAdd,
  showDropdown,
  onToggleDropdown,
}: {
  filledCount: number;
  canAdd: boolean;
  showDropdown: boolean;
  onToggleDropdown: () => void;
}) {
  return (
    <div className="relative flex shrink-0 items-center justify-between px-[14px] h-[40px] border-b border-[rgba(255,255,255,0.08)] bg-[#0d0d14] z-10">
      <span className="font-['Inter'] text-[11px] text-[#445]">
        {filledCount} de {SLOT_COUNT} terminal{filledCount !== 1 ? 'is' : ''}
      </span>
      {canAdd && (
        <button
          onClick={onToggleDropdown}
          aria-expanded={showDropdown}
          aria-label="Adicionar terminal"
          className={`flex items-center gap-[5px] rounded-[6px] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium transition-colors ${
            showDropdown
              ? 'bg-[rgba(170,255,0,0.15)] text-[#af0]'
              : 'bg-[rgba(170,255,0,0.08)] text-[#af0] active:bg-[rgba(170,255,0,0.15)]'
          }`}
          data-testid="canvas-mobile-add-btn"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Adicionar
        </button>
      )}
    </div>
  );
}

/* ── Main ── */

export function CanvasMobile({
  projectId,
  sessions,
  fontSize,
  theme,
  onCreateSession,
  onRename,
}: CanvasMobileProps) {
  const { slots, assignSlot, clearSlot } = useMobileSlots(projectId, sessions);
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // One stable ref per slot index (0-2)
  const terminalRefs = useRef<RefObject<XTermTerminalHandle | null>[]>(
    Array.from({ length: SLOT_COUNT }, () => ({ current: null })),
  );

  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));
  const filledSlots = slots
    .map((id, i) => ({ id, i }))
    .filter((x): x is { id: string; i: number } => x.id !== null);

  // Clear focused slot if it was removed; don't auto-select another
  useEffect(() => {
    if (focusedSlot !== null && !slots[focusedSlot]) {
      setFocusedSlot(null);
    }
  }, [slots, focusedSlot]);

  const handleFocus = useCallback((i: number) => setFocusedSlot((prev) => prev === i ? null : i), []);
  const handleRemove = useCallback((i: number) => clearSlot(i), [clearSlot]);

  const assignedIds = new Set(slots.filter(Boolean) as string[]);
  const availableSessions = sessions.filter((s) => !assignedIds.has(s.sessionId));
  const nextEmptySlot = slots.findIndex((id) => id === null);
  const canAddMore = nextEmptySlot !== -1;

  const handleAssign = useCallback(
    (sessionId: string) => {
      if (nextEmptySlot === -1) return;
      assignSlot(nextEmptySlot, sessionId);
      setFocusedSlot(nextEmptySlot);
      setShowDropdown(false);
    },
    [nextEmptySlot, assignSlot],
  );

  const handleCreate = useCallback(async () => {
    if (!onCreateSession) return;
    setShowDropdown(false);
    const newId = await onCreateSession();
    if (newId && nextEmptySlot !== -1) {
      assignSlot(nextEmptySlot, newId);
      setFocusedSlot(nextEmptySlot);
    }
  }, [nextEmptySlot, onCreateSession, assignSlot]);

  return (
    <div className="relative flex flex-col flex-1 min-h-0 bg-[#0a0a0f]" data-testid="canvas-mobile">
      {/* Top bar — always visible, keyboard can't cover it */}
      {filledSlots.length > 0 && (
        <TopBar
          filledCount={filledSlots.length}
          canAdd={canAddMore}
          showDropdown={showDropdown}
          onToggleDropdown={() => setShowDropdown((v) => !v)}
        />
      )}

      {/* Add dropdown — drops downward from top bar, safe from keyboard */}
      {showDropdown && (
        <AddDropdown
          availableSessions={availableSessions}
          onAssign={handleAssign}
          onCreate={handleCreate}
          onDismiss={() => setShowDropdown(false)}
        />
      )}

      {filledSlots.length === 0 ? (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-[16px] p-[32px]">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-[#334]">
            <rect x="4" y="7" width="32" height="26" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M20 15v10M15 20h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <div className="text-center">
            <p className="font-['Inter'] text-[16px] font-semibold text-[#ccd]">Canvas vazio</p>
            <p className="mt-[4px] font-['Inter'] text-[13px] text-[#556]">
              Adicione um terminal para começar
            </p>
          </div>
          {(availableSessions.length > 0 || onCreateSession) && (
          <button
            onClick={() => setShowDropdown(true)}
            className="flex items-center gap-[6px] rounded-[8px] bg-[#af0] px-[20px] py-[11px] font-['Inter'] text-[14px] font-semibold text-black active:bg-[#9e0] transition-colors"
            data-testid="canvas-mobile-empty-add-btn"
          >
            <span className="text-[18px] leading-none font-light">+</span>
            Adicionar Terminal
          </button>
        )}
          {/* Dropdown anchored to the button area when open from empty state */}
          {showDropdown && (
            <AddDropdown
              availableSessions={availableSessions}
              onAssign={handleAssign}
              onCreate={handleCreate}
              onDismiss={() => setShowDropdown(false)}
            />
          )}
        </div>
      ) : (
        /* Split view — all terminals visible simultaneously */
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {filledSlots.map(({ id, i }) => {
            const session = sessionMap.get(id);
            return (
              <MobileSlot
                key={i}
                slotIndex={i}
                sessionId={id}
                sessionName={session?.name ?? id}
                sessionStatus={session?.status ?? ''}
                isFocused={focusedSlot === i}
                collapsed={focusedSlot !== null && focusedSlot !== i}
                fontSize={fontSize}
                theme={theme}
                terminalRef={terminalRefs.current[i]}
                onToggleFocus={handleFocus}
                onRemove={handleRemove}
                onRename={onRename ? (newName) => onRename(id, newName) : undefined}
              />
            );
          })}

        </div>
      )}

      {/* Single MobileKeyboard FAB for the whole canvas — delegates to focused terminal */}
      {filledSlots.length > 0 && (
        <MobileKeyboard
          onKey={(seq) => {
            const target = focusedSlot !== null ? focusedSlot : filledSlots[0].i;
            terminalRefs.current[target]?.current?.sendKey(seq);
          }}
          onSelectAll={() => {
            const target = focusedSlot !== null ? focusedSlot : filledSlots[0].i;
            terminalRefs.current[target]?.current?.selectAll();
          }}
          onCopy={() => {
            const target = focusedSlot !== null ? focusedSlot : filledSlots[0].i;
            const sel = terminalRefs.current[target]?.current?.getSelection() ?? '';
            if (sel) navigator.clipboard.writeText(sel).catch(() => {});
          }}
          onPaste={() => {
            const target = focusedSlot !== null ? focusedSlot : filledSlots[0].i;
            navigator.clipboard.readText().then((text) => {
              if (text) terminalRefs.current[target]?.current?.sendKey(text);
            }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
