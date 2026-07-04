import {
  useState,
  useCallback,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { XTermTerminal, type XTermTerminalHandle } from '../Terminal';
import { apiFetch } from '../../lib/api';
import type { ITheme } from '@xterm/xterm';

/* ── Types ── */

interface Session {
  sessionId: string;
  name: string;
  status: string;
  projectName?: string;
}

export interface CanvasMobileHandle {
  sendKey: (seq: string) => void;
  selectAll: () => void;
  getSelection: () => string;
}

interface CanvasMobileProps {
  projectId: string;
  sessions: Session[];
  fontSize?: number;
  theme?: ITheme;
  onCreateSession?: () => Promise<string | null>;
  onKill?: (sessionId: string) => Promise<void>;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
  projectName?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** External slot management (Canvas Hub). When provided, internal localStorage is bypassed. */
  externalSlots?: (string | null)[];
  onAssignSlot?: (index: number, sessionId: string) => void;
  onClearSlot?: (index: number) => void;
}

/* ── Constants ── */

const SLOT_COUNT = 3;
const MAX_SLOTS = 8;
const SLOTS_PER_GROUP = 3;
const MOBILE_KEY_PREFIX = 'canvas-mobile-';

/* ── Persistence ── */

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

/* ── Internal slot hook (used when externalSlots not provided) ── */

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
  sessionProjectName?: string;
  isFocused: boolean;
  onKill?: () => Promise<void>;
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
  sessionProjectName,
  isFocused,
  onKill,
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
  const [killPending, setKillPending] = useState(false);
  const killTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKillClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!killPending) {
        setKillPending(true);
        killTimerRef.current = setTimeout(() => setKillPending(false), 3000);
      } else {
        if (killTimerRef.current) clearTimeout(killTimerRef.current);
        setKillPending(false);
        onKill?.()
          .then(() => onRemove(slotIndex))
          .catch(() => {});
      }
    },
    [killPending, onKill, onRemove, slotIndex],
  );

  const startEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(sessionName);
      setEditing(true);
    },
    [sessionName],
  );

  const saveEdit = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== sessionName && onRename) {
      await onRename(trimmed).catch(() => {});
    }
  }, [editValue, sessionName, onRename]);

  const statusColor =
    sessionStatus === 'active' ? '#5e6ad2' : sessionStatus === 'waiting' ? '#8a8f98' : '#5a626c';

  return (
    <div
      className="flex flex-col w-full min-w-0 overflow-hidden border-b border-[rgba(255,255,255,0.06)] transition-all duration-200 ease-out"
      style={
        collapsed
          ? { flexGrow: 0, flexShrink: 0, height: '52px' }
          : { flexGrow: isFocused ? 1 : 1, flexShrink: 1, flexBasis: 0, minHeight: '96px' }
      }
      data-testid={`mobile-slot-${slotIndex}`}
    >
      {/* Header — tap to toggle focus */}
      <div
        className={`flex shrink-0 w-full overflow-hidden items-center gap-[10px] px-[14px] h-[52px] transition-colors cursor-pointer select-none ${
          isFocused
            ? 'bg-[rgba(94, 106, 210,0.07)]'
            : 'bg-[#0a0a0f] active:bg-[rgba(255,255,255,0.04)]'
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
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(94, 106, 210,0.3)] rounded-[3px] px-[6px] py-[2px] text-[12px] text-[#f0f0f0] focus:outline-none"
          />
        ) : (
          <span
            className={`flex-1 min-w-0 truncate text-[12px] ${
              isFocused ? 'text-[#f0f0f0] font-semibold' : 'text-[#667]'
            }`}
          >
            {sessionProjectName && (
              <span className={isFocused ? 'text-[#9aa3ad] font-normal' : 'text-[#5a626c]'}>
                {sessionProjectName} —{' '}
              </span>
            )}
            {sessionName}
          </span>
        )}
        {/* Pencil — only when focused and not editing */}
        {isFocused && !editing && onRename && (
          <button
            onClick={startEdit}
            className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#5a626c] active:text-[#5e6ad2] active:bg-[rgba(94, 106, 210,0.1)] transition-colors"
            aria-label="Renomear sessão"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path
                d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {isFocused && !editing && (
          <span className="shrink-0 h-[14px] w-[2px] rounded-full bg-[#5e6ad2]" />
        )}
        {/* Reconectar */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            terminalRef.current?.reconnect();
          }}
          className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#2d8] active:bg-[rgba(34,221,136,0.1)] transition-colors"
          aria-label="Reconectar terminal"
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
        </button>
        {/* Ajustar layout */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            terminalRef.current?.resize();
            terminalRef.current?.reconnect();
          }}
          className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#6af] active:bg-[rgba(100,160,255,0.1)] transition-colors"
          aria-label="Ajustar layout do terminal"
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
            <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        {/* Kill session */}
        {onKill && (
          <button
            onClick={handleKillClick}
            className={`shrink-0 flex items-center justify-center size-[26px] rounded-[4px] transition-colors ${
              killPending
                ? 'text-[#f54] bg-[rgba(255,85,68,0.18)]'
                : 'text-[#5a626c] active:text-[#f54] active:bg-[rgba(255,85,68,0.1)]'
            }`}
            aria-label="Encerrar sessão"
            title={killPending ? 'Toque novamente para confirmar' : 'Encerrar sessão'}
          >
            {killPending ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M4 6h4M6 4v4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M4 6h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}
        {/* Remove from canvas */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(slotIndex);
          }}
          className="shrink-0 flex items-center justify-center size-[26px] rounded-[4px] text-[#334] active:text-[#778] active:bg-[rgba(255,255,255,0.08)] transition-colors"
          aria-label="Remover do canvas"
          data-testid={`mobile-slot-remove-${slotIndex}`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 2l6 6M8 2l-6 6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Terminal — hidden when collapsed */}
      <div className={`relative flex-1 min-h-0 overflow-hidden ${collapsed ? 'hidden' : ''}`}>
        <XTermTerminal
          key={sessionId}
          ref={terminalRef}
          sessionId={sessionId}
          onResize={handleResize}
          fontSize={fontSize}
          theme={theme}
        />
      </div>
    </div>
  );
}

/* ── Add session dropdown ── */

interface AddDropdownProps {
  availableSessions: Session[];
  onAssign: (sessionId: string) => void;
  onCreate?: () => void;
  onDismiss: () => void;
}

function AddDropdown({ availableSessions, onAssign, onCreate, onDismiss }: AddDropdownProps) {
  return (
    <>
      <div className="absolute inset-0 z-10" onClick={onDismiss} aria-hidden="true" />
      <div
        className="absolute top-[44px] right-0 z-20 w-[240px] flex flex-col rounded-b-[10px] rounded-tl-[10px] border border-white/[0.07] bg-[#111118] shadow-xl overflow-hidden"
        data-testid="add-dropdown"
      >
        <div className="px-[12px] pt-[12px] pb-[4px]">
          <p className="text-[11px] text-[#5a626c]">Adicionar terminal</p>
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
                      s.status === 'active' ? '#5e6ad2' : s.status === 'waiting' ? '#8a8f98' : '#5a626c',
                  }}
                />
                <span className="flex-1 min-w-0 truncate text-[13px] text-[#ccd]">
                  {s.projectName && <span className="text-[#5a626c]">{s.projectName} — </span>}
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
              className="flex w-full items-center justify-center gap-[6px] rounded-[6px] bg-[#5e6ad2] py-[10px] text-[13px] font-semibold text-white active:bg-[#6e79de] transition-colors"
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
  canAdd,
  showDropdown,
  onToggleDropdown,
  projectName,
  sidebarOpen,
  onToggleSidebar,
}: {
  canAdd: boolean;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  projectName?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  return (
    <div className="relative flex shrink-0 items-center gap-[4px] px-[10px] h-[44px] border-b border-white/[0.07] bg-[#0a0a0f] z-10">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="flex items-center justify-center size-[30px] shrink-0 rounded-[5px] text-[#778] active:text-[#f0f0f0] active:bg-[rgba(255,255,255,0.08)] transition-colors"
          aria-label={
            sidebarOpen === undefined ? 'Voltar' : sidebarOpen ? 'Fechar menu' : 'Abrir menu'
          }
          data-testid="sidebar-toggle"
        >
          {sidebarOpen === undefined ? (
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M12 4L6 10l6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : sidebarOpen ? (
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5l-10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 6h12M4 10h12M4 14h12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      )}

      {projectName ? (
        <span className="text-[12px] text-[#5a626c] truncate flex-1 min-w-0 ml-[2px]">
          {projectName}
        </span>
      ) : (
        <div className="flex-1" />
      )}

      {canAdd && (
        <button
          onClick={onToggleDropdown}
          aria-expanded={showDropdown}
          aria-label="Adicionar terminal"
          className={`flex items-center gap-[4px] rounded-[6px] px-[8px] py-[5px] text-[12px] font-medium transition-colors shrink-0 ${
            showDropdown
              ? 'bg-[rgba(94, 106, 210,0.15)] text-[#5e6ad2]'
              : 'bg-[rgba(94, 106, 210,0.08)] text-[#5e6ad2] active:bg-[rgba(94, 106, 210,0.15)]'
          }`}
          data-testid="canvas-mobile-add-btn"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add
        </button>
      )}
    </div>
  );
}

/* ── Group dots indicator ── */

function GroupDots({
  numGroups,
  activeGroup,
  onSelect,
}: {
  numGroups: number;
  activeGroup: number;
  onSelect: (g: number) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center gap-[6px] h-[28px] border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]"
      data-testid="group-dots"
    >
      {Array.from({ length: numGroups }, (_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          aria-label={`Grupo ${i + 1}`}
          data-testid={`group-dot-${i}`}
          className="flex items-center justify-center p-[4px]"
        >
          <span
            className="rounded-full transition-all duration-200"
            style={{
              width: i === activeGroup ? '18px' : '6px',
              height: '6px',
              backgroundColor: i === activeGroup ? '#5e6ad2' : 'rgba(255,255,255,0.2)',
            }}
          />
        </button>
      ))}
    </div>
  );
}

/* ── Main ── */

export const CanvasMobile = forwardRef<CanvasMobileHandle, CanvasMobileProps>(function CanvasMobile(
  {
    projectId,
    sessions,
    fontSize,
    theme,
    onCreateSession,
    onKill,
    onRename,
    projectName,
    sidebarOpen,
    onToggleSidebar,
    externalSlots,
    onAssignSlot,
    onClearSlot,
  },
  ref,
) {
  const internal = useMobileSlots(projectId, sessions);

  // Use external slots when provided, otherwise internal
  const slots = externalSlots ?? internal.slots;
  const effectiveAssignSlot = onAssignSlot ?? internal.assignSlot;
  const effectiveClearSlot = onClearSlot ?? internal.clearSlot;

  const totalSlots = slots.length;
  const numGroups = Math.max(1, Math.ceil(totalSlots / SLOTS_PER_GROUP));

  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const touchStartX = useRef<number | null>(null);

  // Reset group when total slots changes
  useEffect(() => {
    setActiveGroup(0);
  }, [totalSlots]);

  // One stable ref per slot index (0..MAX_SLOTS-1)
  const terminalRefs = useRef<RefObject<XTermTerminalHandle | null>[]>(
    Array.from({ length: MAX_SLOTS }, () => ({ current: null })),
  );

  const getTargetRef = useRef<() => number>(() => 0);

  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));
  const filledSlots = slots
    .map((id, i) => ({ id, i }))
    .filter((x): x is { id: string; i: number } => x.id !== null);

  // Visible slot range for current group
  const groupStart = activeGroup * SLOTS_PER_GROUP;
  const groupEnd = groupStart + SLOTS_PER_GROUP;
  const visibleFilledSlots = filledSlots.filter(({ i }) => i >= groupStart && i < groupEnd);

  getTargetRef.current = () =>
    focusedSlot !== null ? focusedSlot : (visibleFilledSlots[0]?.i ?? filledSlots[0]?.i ?? 0);

  useImperativeHandle(
    ref,
    () => ({
      sendKey: (seq) => terminalRefs.current[getTargetRef.current()]?.current?.sendKey(seq),
      selectAll: () => terminalRefs.current[getTargetRef.current()]?.current?.selectAll(),
      getSelection: () =>
        terminalRefs.current[getTargetRef.current()]?.current?.getSelection() ?? '',
    }),
    [],
  );

  // Clear focused slot if it was removed
  useEffect(() => {
    if (focusedSlot !== null && !slots[focusedSlot]) {
      setFocusedSlot(null);
    }
  }, [slots, focusedSlot]);

  // When focused slot is in a different group, switch to that group
  useEffect(() => {
    if (focusedSlot === null) return;
    const group = Math.floor(focusedSlot / SLOTS_PER_GROUP);
    setActiveGroup(group);
  }, [focusedSlot]);

  // Resize terminals after group/focus change
  useEffect(() => {
    let attempt = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const tryResize = () => {
      timerId = null;
      for (const r of terminalRefs.current) {
        r.current?.resize();
      }
      if (attempt++ < 20) {
        timerId = setTimeout(tryResize, 100);
      }
    };
    timerId = setTimeout(tryResize, 300);
    return () => {
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [focusedSlot, activeGroup]);

  const handleFocus = useCallback(
    (i: number) => setFocusedSlot((prev) => (prev === i ? null : i)),
    [],
  );
  const handleRemove = useCallback((i: number) => effectiveClearSlot(i), [effectiveClearSlot]);

  const assignedIds = new Set(slots.filter(Boolean) as string[]);
  const availableSessions = sessions.filter((s) => !assignedIds.has(s.sessionId));
  const nextEmptySlot = slots.findIndex((id) => id === null);
  const canAddMore = nextEmptySlot !== -1;

  const handleAssign = useCallback(
    (sessionId: string) => {
      if (nextEmptySlot === -1) return;
      effectiveAssignSlot(nextEmptySlot, sessionId);
      const group = Math.floor(nextEmptySlot / SLOTS_PER_GROUP);
      setActiveGroup(group);
      setFocusedSlot(nextEmptySlot);
      setShowDropdown(false);
    },
    [nextEmptySlot, effectiveAssignSlot],
  );

  const handleCreate = useCallback(async () => {
    if (!onCreateSession) return;
    setShowDropdown(false);
    const newId = await onCreateSession();
    if (newId && nextEmptySlot !== -1) {
      effectiveAssignSlot(nextEmptySlot, newId);
      const group = Math.floor(nextEmptySlot / SLOTS_PER_GROUP);
      setActiveGroup(group);
      setFocusedSlot(nextEmptySlot);
    }
  }, [nextEmptySlot, onCreateSession, effectiveAssignSlot]);

  // Swipe detection
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null || numGroups <= 1) return;
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      touchStartX.current = null;
      if (Math.abs(delta) < 50) return;
      if (delta < 0) {
        // swipe left → next group
        setActiveGroup((prev) => Math.min(prev + 1, numGroups - 1));
      } else {
        // swipe right → prev group
        setActiveGroup((prev) => Math.max(prev - 1, 0));
      }
      setFocusedSlot(null);
    },
    [numGroups],
  );

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 w-full overflow-x-hidden bg-[#0a0a0f]"
      data-testid="canvas-mobile"
    >
      <TopBar
        canAdd={canAddMore}
        showDropdown={showDropdown}
        onToggleDropdown={() => setShowDropdown((v) => !v)}
        projectName={projectName}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
      />

      {showDropdown && (
        <AddDropdown
          availableSessions={availableSessions}
          onAssign={handleAssign}
          onCreate={onCreateSession ? handleCreate : undefined}
          onDismiss={() => setShowDropdown(false)}
        />
      )}

      {/* Group dots — only when more than one group */}
      {numGroups > 1 && (
        <GroupDots
          numGroups={numGroups}
          activeGroup={activeGroup}
          onSelect={(g) => {
            setActiveGroup(g);
            setFocusedSlot(null);
          }}
        />
      )}

      {filledSlots.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[16px] p-[32px]">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-[#334]">
            <rect
              x="4"
              y="7"
              width="32"
              height="26"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M20 15v10M15 20h10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <div className="text-center">
            <p className="text-[16px] font-semibold text-[#ccd]">Canvas vazio</p>
            <p className="mt-[4px] text-[13px] text-[#5a626c]">
              Adicione um terminal para começar
            </p>
          </div>
          {(availableSessions.length > 0 || onCreateSession) && (
            <button
              onClick={() => setShowDropdown(true)}
              className="flex items-center gap-[6px] rounded-[8px] bg-[#5e6ad2] px-[20px] py-[11px] text-[14px] font-semibold text-white active:bg-[#6e79de] transition-colors"
              data-testid="canvas-mobile-empty-add-btn"
            >
              <span className="text-[18px] leading-none font-light">+</span>
              Adicionar Terminal
            </button>
          )}
        </div>
      ) : (
        <div
          className="flex flex-col flex-1 min-h-0 w-full overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {visibleFilledSlots.length === 0 ? (
            /* Current group is empty but other groups have slots */
            <div className="flex flex-1 flex-col items-center justify-center gap-[10px]">
              <p className="text-[13px] text-[#5a626c]">Grupo vazio</p>
              <p className="text-[11px] text-[#334]">
                Adicione uma sessão ou mude de grupo
              </p>
            </div>
          ) : (
            visibleFilledSlots.map(({ id, i }) => {
              const session = sessionMap.get(id);
              return (
                <MobileSlot
                  key={i}
                  slotIndex={i}
                  sessionId={id}
                  sessionName={session?.name ?? id}
                  sessionStatus={session?.status ?? ''}
                  sessionProjectName={session?.projectName}
                  isFocused={focusedSlot === i}
                  collapsed={focusedSlot !== null && focusedSlot !== i}
                  fontSize={fontSize}
                  theme={theme}
                  terminalRef={terminalRefs.current[i]}
                  onToggleFocus={handleFocus}
                  onRemove={handleRemove}
                  onKill={onKill ? () => onKill(id) : undefined}
                  onRename={onRename ? (newName) => onRename(id, newName) : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});
