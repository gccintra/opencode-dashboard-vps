import { useState, useCallback } from 'react';
import { CanvasSlot, type AvailableSession } from './CanvasSlot';
import type { ITheme } from '@xterm/xterm';

interface Session {
  sessionId: string;
  name: string;
  status: string;
  projectName?: string;
}

interface CanvasGridProps {
  cols: number;
  rows: number;
  slots: Record<number, string | null>;
  sessions: Session[];
  fontSize?: number;
  onAssign: (slotIndex: number, sessionId: string) => void;
  onRemove: (slotIndex: number) => void;
  onKill?: (sessionId: string) => Promise<void>;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
  theme?: ITheme;
}

export function CanvasGrid({
  cols,
  rows,
  slots,
  sessions,
  fontSize,
  onAssign,
  onRemove,
  onKill,
  onCreateSession,
  onRename,
  theme,
}: CanvasGridProps) {
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const capacity = cols * rows;

  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const handleFocus = useCallback((slotIndex: number) => {
    setFocusedSlot(slotIndex);
  }, []);

  // Sessions not yet assigned to any slot in this grid
  const assignedIds = new Set(
    Object.values(slots).filter((id): id is string => id !== null),
  );
  const availableSessions: AvailableSession[] = sessions
    .filter((s) => !assignedIds.has(s.sessionId))
    .map((s) => ({ sessionId: s.sessionId, name: s.name, status: s.status, projectName: s.projectName }));

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden p-[12px]"
      data-testid="canvas-grid"
    >
      <div
        className="h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: '8px',
        }}
        data-testid="canvas-grid-inner"
      >
        {Array.from({ length: capacity }, (_, i) => {
          const sessionId = slots[i] ?? null;
          const session = sessionId ? sessionMap.get(sessionId) : null;
          return (
            <CanvasSlot
              key={i}
              slotIndex={i}
              sessionId={sessionId}
              sessionName={session?.name ?? null}
              sessionStatus={session?.status ?? null}
              sessionProjectName={session?.projectName ?? null}
              isFocused={focusedSlot === i}
              availableSessions={availableSessions}
              fontSize={fontSize}
              onFocus={handleFocus}
              onAssignSession={onAssign}
              onRemoveSession={onRemove}
              onKillSession={onKill && sessionId ? () => onKill(sessionId) : undefined}
              onCreateSession={onCreateSession}
              onRename={onRename && sessionId ? (newName) => onRename(sessionId, newName) : undefined}
              theme={theme}
            />
          );
        })}
      </div>
    </div>
  );
}
