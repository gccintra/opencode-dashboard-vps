import { useState, useMemo, useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CanvasSlot, type AvailableSession } from './CanvasSlot';
import type { ITheme } from '@xterm/xterm';

interface Session {
  sessionId: string;
  name: string;
  status: string;
  projectName?: string;
}

interface CanvasGridProps {
  templateId: string;
  slots: Record<string, string | null>;
  storageKey: string;
  sessions: Session[];
  fontSize?: number;
  onAssign: (slotId: string, sessionId: string) => void;
  onRemove: (slotId: string) => void;
  onKill?: (sessionId: string) => Promise<void>;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
  onUserResized?: () => void;
  theme?: ITheme;
}

function readLayout(key: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Layout) : undefined;
  } catch {
    return undefined;
  }
}

function VSep() {
  return (
    <Separator
      className="flex items-center justify-center cursor-col-resize group/vsep"
      style={{ width: '8px', flexShrink: 0 }}
    >
      <div className="w-[2px] h-[40px] rounded-full bg-white/[0.08] transition-colors duration-150 group-hover/vsep:bg-[#b3e502]/50" />
    </Separator>
  );
}

function HSep() {
  return (
    <Separator
      className="flex items-center justify-center cursor-row-resize group/hsep"
      style={{ height: '8px', flexShrink: 0 }}
    >
      <div className="h-[2px] w-[40px] rounded-full bg-white/[0.08] transition-colors duration-150 group-hover/hsep:bg-[#b3e502]/50" />
    </Separator>
  );
}

/** Wraps CanvasSlot with dnd-kit hooks. Must be inside DndContext. */
function DndSlot({
  slotId,
  slotIndex,
  sessionId,
  sessionName,
  sessionStatus,
  sessionProjectName,
  isFocused,
  availableSessions,
  fontSize,
  onFocus,
  onAssign,
  onRemove,
  onKill,
  onCreateSession,
  onRename,
  theme,
  activeDragSlot,
}: {
  slotId: string;
  slotIndex: number;
  sessionId: string | null;
  sessionName: string | null;
  sessionStatus: string | null;
  sessionProjectName?: string | null;
  isFocused: boolean;
  availableSessions: AvailableSession[];
  fontSize?: number;
  onFocus: () => void;
  onAssign: (sessionId: string) => void;
  onRemove: () => void;
  onKill?: () => Promise<void>;
  onCreateSession?: () => Promise<string | null>;
  onRename?: (name: string) => Promise<void>;
  theme?: ITheme;
  activeDragSlot: string | null;
}) {
  const isDragging = activeDragSlot === slotId;

  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: slotId,
    disabled: !sessionId,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: slotId });

  return (
    <CanvasSlot
      slotIndex={slotIndex}
      sessionId={isDragging ? null : sessionId}
      sessionName={sessionName}
      sessionStatus={sessionStatus}
      sessionProjectName={sessionProjectName}
      isFocused={isFocused}
      availableSessions={availableSessions}
      fontSize={fontSize}
      onFocus={onFocus}
      onAssignSession={(_idx, sid) => onAssign(sid)}
      onRemoveSession={() => onRemove()}
      onKillSession={onKill}
      onCreateSession={onCreateSession}
      onRename={onRename}
      theme={theme}
      isDragging={isDragging}
      isOver={isOver}
      containerRef={setDropRef}
      headerRef={sessionId ? setDragRef : undefined}
      headerDragProps={sessionId ? { ...attributes, ...listeners } : undefined}
    />
  );
}

export function CanvasGrid({
  templateId,
  slots,
  storageKey,
  sessions,
  fontSize,
  onAssign,
  onRemove,
  onKill,
  onCreateSession,
  onRename,
  onUserResized,
  theme,
}: CanvasGridProps) {
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const [activeDragSlot, setActiveDragSlot] = useState<string | null>(null);

  // Ignore onLayoutChanged fired during initial Group mount
  const userInteractedRef = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => { userInteractedRef.current = true; }, 300);
    return () => clearTimeout(id);
  }, []);

  const save = (key: string, layout: Layout) => {
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* ignore */ }
    if (userInteractedRef.current) onUserResized?.();
  };

  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions]);

  const assignedIds = useMemo(
    () => new Set(Object.values(slots).filter((id): id is string => id !== null)),
    [slots],
  );

  const availableSessions: AvailableSession[] = useMemo(
    () =>
      sessions
        .filter((s) => !assignedIds.has(s.sessionId))
        .map((s) => ({ sessionId: s.sessionId, name: s.name, status: s.status, projectName: s.projectName })),
    [sessions, assignedIds],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const activeDragSession = activeDragSlot ? (slots[activeDragSlot] ?? null) : null;
  const activeDragSessionObj = activeDragSession ? sessionMap.get(activeDragSession) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDragSlot(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragSlot(null);
    const fromSlot = String(event.active.id);
    const toSlot = event.over ? String(event.over.id) : null;
    if (!toSlot || fromSlot === toSlot) return;
    const fromSession = slots[fromSlot] ?? null;
    const toSession = slots[toSlot] ?? null;
    if (!fromSession) return;
    onAssign(toSlot, fromSession);
    if (toSession) onAssign(fromSlot, toSession);
    else onRemove(fromSlot);
  }

  const hKey = `cpg-${storageKey}-${templateId}-h`;
  const vlKey = `cpg-${storageKey}-${templateId}-vl`;
  const vrKey = `cpg-${storageKey}-${templateId}-vr`;

  const hLayout = useMemo(() => readLayout(hKey), [hKey]);
  const vlLayout = useMemo(() => readLayout(vlKey), [vlKey]);
  const vrLayout = useMemo(() => readLayout(vrKey), [vrKey]);

  const mkSlot = (slotId: string, slotIndex: number) => {
    const sessionId = slots[slotId] ?? null;
    const session = sessionId ? sessionMap.get(sessionId) : null;
    return (
      <DndSlot
        key={slotId}
        slotId={slotId}
        slotIndex={slotIndex}
        sessionId={sessionId}
        sessionName={session?.name ?? null}
        sessionStatus={session?.status ?? null}
        sessionProjectName={session?.projectName ?? null}
        isFocused={focusedSlot === slotId}
        availableSessions={availableSessions}
        fontSize={fontSize}
        onFocus={() => setFocusedSlot(slotId)}
        onAssign={(sid) => onAssign(slotId, sid)}
        onRemove={() => onRemove(slotId)}
        onKill={
          onKill && sessionId
            ? async () => { await onKill(sessionId); onRemove(slotId); }
            : undefined
        }
        onCreateSession={onCreateSession}
        onRename={onRename && sessionId ? (name) => onRename(sessionId, name) : undefined}
        theme={theme}
        activeDragSlot={activeDragSlot}
      />
    );
  };

  const mkPanel = (slotId: string, slotIndex: number, defaultSize: number, minSize = 10) => (
    <Panel
      key={`panel-${slotId}`}
      id={`panel-${slotId}`}
      defaultSize={defaultSize}
      minSize={minSize}
      style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {mkSlot(slotId, slotIndex)}
    </Panel>
  );

  const renderTemplate = () => {
    switch (templateId) {
      case 'single':
        return (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {mkSlot('a', 0)}
          </div>
        );

      case '2col':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 15)}
            <VSep />
            {mkPanel('b', 1, 50, 15)}
          </Group>
        );

      case '2row':
        return (
          <Group orientation="vertical" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50)}
            <HSep />
            {mkPanel('b', 1, 50)}
          </Group>
        );

      case 'left-stack':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {mkPanel('a', 0, 50)}
                <HSep />
                {mkPanel('b', 1, 50)}
              </Group>
            </Panel>
            <VSep />
            {mkPanel('c', 2, 50, 15)}
          </Group>
        );

      case 'right-stack':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 15)}
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {mkPanel('b', 1, 50)}
                <HSep />
                {mkPanel('c', 2, 50)}
              </Group>
            </Panel>
          </Group>
        );

      case '2x2':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {mkPanel('a', 0, 50)}
                <HSep />
                {mkPanel('b', 1, 50)}
              </Group>
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {mkPanel('c', 2, 50)}
                <HSep />
                {mkPanel('d', 3, 50)}
              </Group>
            </Panel>
          </Group>
        );

      case '3col':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 33, 15)}
            <VSep />
            {mkPanel('b', 1, 34, 15)}
            <VSep />
            {mkPanel('c', 2, 33, 15)}
          </Group>
        );

      default:
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 15)}
            <VSep />
            {mkPanel('b', 1, 50, 15)}
          </Group>
        );
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden p-[12px]" data-testid="canvas-grid">
        <div className="flex flex-col flex-1 min-h-0 w-full">
          {renderTemplate()}
        </div>
      </div>
      <DragOverlay>
        {activeDragSessionObj && (
          <div className="rounded-[6px] border border-[#b3e502]/40 bg-[#0a0a0f]/90 px-[12px] py-[8px] text-[12px] text-[#b3e502] font-['JetBrains_Mono'] shadow-lg">
            {activeDragSessionObj.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
