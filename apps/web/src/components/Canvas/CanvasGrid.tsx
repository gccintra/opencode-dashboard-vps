import { useState, useMemo, useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout, PanelImperativeHandle } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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

function saveLayout(key: string, layout: Layout, onUserResized?: () => void): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
    onUserResized?.();
  } catch {
    // ignore quota errors
  }
}

function VSep() {
  return (
    <Separator className="flex items-center justify-center cursor-col-resize group/vsep" style={{ width: '8px', flexShrink: 0 }}>
      <div className="w-[2px] h-[40px] rounded-full bg-white/[0.08] transition-colors duration-150 group-hover/vsep:bg-[#b3e502]/50" />
    </Separator>
  );
}

function HSep() {
  return (
    <Separator className="flex items-center justify-center cursor-row-resize group/hsep" style={{ height: '8px', flexShrink: 0 }}>
      <div className="h-[2px] w-[40px] rounded-full bg-white/[0.08] transition-colors duration-150 group-hover/hsep:bg-[#b3e502]/50" />
    </Separator>
  );
}

/** Collapsible Panel wrapper — collapses imperatively when slot is empty */
function SlotPanel({
  id,
  slotId,
  hasSession,
  defaultSize,
  minSize = 10,
  children,
}: {
  id: string;
  slotId: string;
  hasSession: boolean;
  defaultSize: number;
  minSize?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<PanelImperativeHandle | null>(null);
  const prevHasSession = useRef(hasSession);

  useEffect(() => {
    if (prevHasSession.current === hasSession) return;
    prevHasSession.current = hasSession;
    if (!hasSession) {
      ref.current?.collapse();
    } else {
      ref.current?.expand();
    }
  }, [hasSession]);

  return (
    <Panel
      id={id}
      panelRef={ref}
      collapsible
      collapsedSize={0}
      defaultSize={hasSession ? defaultSize : 0}
      minSize={minSize}
      style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      data-slot={slotId}
    >
      {children}
    </Panel>
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
  const [dragSlotId, setDragSlotId] = useState<string | null>(null);
  const save = (key: string, layout: Layout) => saveLayout(key, layout, onUserResized);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const dragSessionId = dragSlotId ? (slots[dragSlotId] ?? null) : null;
  const dragSession = dragSessionId ? sessionMap.get(dragSessionId) : null;

  function handleDragStart(event: DragStartEvent) {
    setDragSlotId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragSlotId(null);
    const fromSlot = String(event.active.id);
    const toSlot = event.over ? String(event.over.id) : null;
    if (!toSlot || fromSlot === toSlot) return;

    const fromSession = slots[fromSlot] ?? null;
    const toSession = slots[toSlot] ?? null;
    if (!fromSession) return;

    // swap
    onAssign(toSlot, fromSession);
    if (toSession) {
      onAssign(fromSlot, toSession);
    } else {
      onRemove(fromSlot);
    }
  }

  // Layout persistence keys
  const hKey = `cpg-${storageKey}-${templateId}-h`;
  const vlKey = `cpg-${storageKey}-${templateId}-vl`;
  const vrKey = `cpg-${storageKey}-${templateId}-vr`;

  const hLayout = useMemo(() => readLayout(hKey), [hKey]);
  const vlLayout = useMemo(() => readLayout(vlKey), [vlKey]);
  const vrLayout = useMemo(() => readLayout(vrKey), [vrKey]);

  const makeSlot = (slotId: string, slotIndex: number, defaultSize: number, minSize = 10) => {
    const sessionId = slots[slotId] ?? null;
    const session = sessionId ? sessionMap.get(sessionId) : null;
    const isDragging = dragSlotId === slotId;
    return (
      <SlotPanel
        id={`panel-${slotId}`}
        slotId={slotId}
        hasSession={!!sessionId}
        defaultSize={defaultSize}
        minSize={minSize}
      >
        <CanvasSlot
          key={slotId}
          slotIndex={slotIndex}
          sessionId={isDragging ? null : sessionId}
          sessionName={session?.name ?? null}
          sessionStatus={session?.status ?? null}
          sessionProjectName={session?.projectName ?? null}
          isFocused={focusedSlot === slotId}
          availableSessions={availableSessions}
          fontSize={fontSize}
          onFocus={() => setFocusedSlot(slotId)}
          onAssignSession={(_idx, sid) => onAssign(slotId, sid)}
          onRemoveSession={() => onRemove(slotId)}
          onKillSession={
            onKill && sessionId
              ? async () => {
                  await onKill(sessionId);
                  onRemove(slotId);
                }
              : undefined
          }
          onCreateSession={onCreateSession}
          onRename={onRename && sessionId ? (name) => onRename(sessionId, name) : undefined}
          theme={theme}
          draggableId={sessionId ? slotId : undefined}
          droppableId={slotId}
        />
      </SlotPanel>
    );
  };

  const renderTemplate = () => {
    switch (templateId) {
      case 'single':
        return (
          <SlotPanel id="panel-a" slotId="a" hasSession={!!slots['a']} defaultSize={100} minSize={0}>
            <CanvasSlot
              key="a"
              slotIndex={0}
              sessionId={slots['a'] ?? null}
              sessionName={slots['a'] ? (sessionMap.get(slots['a'])?.name ?? null) : null}
              sessionStatus={slots['a'] ? (sessionMap.get(slots['a'])?.status ?? null) : null}
              sessionProjectName={slots['a'] ? (sessionMap.get(slots['a'])?.projectName ?? null) : null}
              isFocused={focusedSlot === 'a'}
              availableSessions={availableSessions}
              fontSize={fontSize}
              onFocus={() => setFocusedSlot('a')}
              onAssignSession={(_idx, sid) => onAssign('a', sid)}
              onRemoveSession={() => onRemove('a')}
              onKillSession={
                onKill && slots['a']
                  ? async () => { await onKill(slots['a']!); onRemove('a'); }
                  : undefined
              }
              onCreateSession={onCreateSession}
              onRename={onRename && slots['a'] ? (name) => onRename(slots['a']!, name) : undefined}
              theme={theme}
              droppableId="a"
              draggableId={slots['a'] ? 'a' : undefined}
            />
          </SlotPanel>
        );

      case '2col':
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {makeSlot('a', 0, 50, 15)}
            <VSep />
            {makeSlot('b', 1, 50, 15)}
          </Group>
        );

      case '2row':
        return (
          <Group key={hKey} orientation="vertical" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {makeSlot('a', 0, 50)}
            <HSep />
            {makeSlot('b', 1, 50)}
          </Group>
        );

      case 'left-stack':
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {makeSlot('a', 0, 50)}
                <HSep />
                {makeSlot('b', 1, 50)}
              </Group>
            </Panel>
            <VSep />
            {makeSlot('c', 2, 50, 15)}
          </Group>
        );

      case 'right-stack':
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {makeSlot('a', 0, 50, 15)}
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {makeSlot('b', 1, 50)}
                <HSep />
                {makeSlot('c', 2, 50)}
              </Group>
            </Panel>
          </Group>
        );

      case '2x2':
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {makeSlot('a', 0, 50)}
                <HSep />
                {makeSlot('b', 1, 50)}
              </Group>
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {makeSlot('c', 2, 50)}
                <HSep />
                {makeSlot('d', 3, 50)}
              </Group>
            </Panel>
          </Group>
        );

      case '3col':
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {makeSlot('a', 0, 33, 15)}
            <VSep />
            {makeSlot('b', 1, 34, 15)}
            <VSep />
            {makeSlot('c', 2, 33, 15)}
          </Group>
        );

      default:
        return (
          <Group key={hKey} orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {makeSlot('a', 0, 50, 15)}
            <VSep />
            {makeSlot('b', 1, 50, 15)}
          </Group>
        );
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden p-[12px]" data-testid="canvas-grid">
        <div className="flex flex-col flex-1 min-h-0 w-full" data-testid="canvas-grid-inner">
          {renderTemplate()}
        </div>
      </div>
      <DragOverlay>
        {dragSession && (
          <div className="rounded-[6px] border border-[#b3e502]/40 bg-[#0a0a0f]/90 px-[12px] py-[8px] text-[12px] text-[#b3e502] font-['JetBrains_Mono'] shadow-lg">
            {dragSession.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
