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
  resetLayoutKey?: number;
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
      sessionId={sessionId}
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
  resetLayoutKey,
  theme,
}: CanvasGridProps) {
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const [activeDragSlot, setActiveDragSlot] = useState<string | null>(null);

  // localSlots mirrors `slots` prop but allows visual-only drag swaps without calling parent
  const [localSlots, setLocalSlots] = useState<Record<string, string | null>>(slots);
  const isDraggingRef = useRef(false);
  const slotsJsonRef = useRef(JSON.stringify(slots));

  useEffect(() => {
    const json = JSON.stringify(slots);
    if (!isDraggingRef.current && json !== slotsJsonRef.current) {
      slotsJsonRef.current = json;
      setLocalSlots(slots);
    }
  }, [slots]);

  // Panel reset: clear stored sizes and remount groups via key
  const [panelMountKey, setPanelMountKey] = useState(0);
  const prevResetKeyRef = useRef(resetLayoutKey ?? 0);
  useEffect(() => {
    if (resetLayoutKey !== undefined && resetLayoutKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetLayoutKey;
      for (const s of ['h','vl','vr','v0','v1','v2','v3']) {
        try { localStorage.removeItem(`cpg-${storageKey}-${templateId}-${s}`); } catch {}
      }
      setPanelMountKey((k) => k + 1);
    }
  }, [resetLayoutKey, storageKey, templateId]);

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
    () => new Set(Object.values(localSlots).filter((id): id is string => id !== null)),
    [localSlots],
  );

  const availableSessions: AvailableSession[] = useMemo(
    () =>
      sessions
        .filter((s) => !assignedIds.has(s.sessionId))
        .map((s) => ({ sessionId: s.sessionId, name: s.name, status: s.status, projectName: s.projectName })),
    [sessions, assignedIds],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const activeDragSession = activeDragSlot ? (localSlots[activeDragSlot] ?? null) : null;
  const activeDragSessionObj = activeDragSession ? sessionMap.get(activeDragSession) : null;

  const [dragSnapshot, setDragSnapshot] = useState<{ src: string; w: number; h: number } | null>(null);

  function captureSlotSnapshot(slotId: string): { src: string; w: number; h: number } | null {
    const idx = slotId.charCodeAt(0) - 97;
    const slotEl = document.querySelector(`[data-testid="canvas-slot-${idx}"]`);
    if (!slotEl) return null;
    const rect = slotEl.getBoundingClientRect();
    const canvases = Array.from(slotEl.querySelectorAll('canvas')) as HTMLCanvasElement[];
    if (!canvases.length) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);
    for (const c of canvases) {
      try { ctx.drawImage(c, 0, 0, w, h); } catch {}
    }
    try {
      return { src: composite.toDataURL('image/png'), w: rect.width, h: rect.height };
    } catch {
      return null;
    }
  }

  function handleDragStart(event: DragStartEvent) {
    isDraggingRef.current = true;
    const slotId = String(event.active.id);
    setActiveDragSlot(slotId);
    setDragSnapshot(captureSlotSnapshot(slotId));
  }

  function handleDragEnd(event: DragEndEvent) {
    isDraggingRef.current = false;
    setActiveDragSlot(null);
    setDragSnapshot(null);
    const fromSlot = String(event.active.id);
    const toSlot = event.over ? String(event.over.id) : null;
    if (!toSlot || fromSlot === toSlot) return;
    const fromSession = localSlots[fromSlot] ?? null;
    const toSession = localSlots[toSlot] ?? null;
    if (!fromSession) return;
    // Swap purely in local state — no API, no localStorage
    setLocalSlots((prev) => {
      const next = { ...prev, [toSlot]: fromSession };
      if (toSession) next[fromSlot] = toSession;
      else next[fromSlot] = null;
      return next;
    });
  }

  const hKey  = `cpg-${storageKey}-${templateId}-h`;
  const vlKey = `cpg-${storageKey}-${templateId}-vl`;
  const vrKey = `cpg-${storageKey}-${templateId}-vr`;
  const v0Key = `cpg-${storageKey}-${templateId}-v0`;
  const v1Key = `cpg-${storageKey}-${templateId}-v1`;
  const v2Key = `cpg-${storageKey}-${templateId}-v2`;
  const v3Key = `cpg-${storageKey}-${templateId}-v3`;

  // panelMountKey in deps ensures stale-cache is busted after reset (localStorage cleared, same keys)
  const hLayout  = useMemo(() => readLayout(hKey),  [hKey,  panelMountKey]);
  const vlLayout = useMemo(() => readLayout(vlKey), [vlKey, panelMountKey]);
  const vrLayout = useMemo(() => readLayout(vrKey), [vrKey, panelMountKey]);
  const v0Layout = useMemo(() => readLayout(v0Key), [v0Key, panelMountKey]);
  const v1Layout = useMemo(() => readLayout(v1Key), [v1Key, panelMountKey]);
  const v2Layout = useMemo(() => readLayout(v2Key), [v2Key, panelMountKey]);
  const v3Layout = useMemo(() => readLayout(v3Key), [v3Key, panelMountKey]);

  const mkSlot = (slotId: string, slotIndex: number) => {
    const sessionId = localSlots[slotId] ?? null;
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

  const mkPanel = (slotId: string, slotIndex: number, defaultSize: number, minSize = 10, collapsible = false) => (
    <Panel
      key={`panel-${slotId}`}
      id={`panel-${slotId}`}
      defaultSize={defaultSize}
      minSize={minSize}
      collapsible={collapsible}
      collapsedSize={0}
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
            {mkPanel('a', 0, 50, 15, true)}
            <VSep />
            {mkPanel('b', 1, 50, 15, true)}
          </Group>
        );

      case '2row':
        return (
          <Group orientation="vertical" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 10, true)}
            <HSep />
            {mkPanel('b', 1, 50, 10, true)}
          </Group>
        );

      case 'left-stack':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {mkPanel('a', 0, 50, 10, true)}
                <HSep />
                {mkPanel('b', 1, 50, 10, true)}
              </Group>
            </Panel>
            <VSep />
            {mkPanel('c', 2, 50, 15, true)}
          </Group>
        );

      case 'right-stack':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 15, true)}
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {mkPanel('b', 1, 50, 10, true)}
                <HSep />
                {mkPanel('c', 2, 50, 10, true)}
              </Group>
            </Panel>
          </Group>
        );

      case '2x2':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            <Panel id="left" defaultSize={50} minSize={15} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vlLayout} onLayoutChanged={(l) => save(vlKey, l)}>
                {mkPanel('a', 0, 50, 10, true)}
                <HSep />
                {mkPanel('b', 1, 50, 10, true)}
              </Group>
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group orientation="vertical" className="h-full" defaultLayout={vrLayout} onLayoutChanged={(l) => save(vrKey, l)}>
                {mkPanel('c', 2, 50, 10, true)}
                <HSep />
                {mkPanel('d', 3, 50, 10, true)}
              </Group>
            </Panel>
          </Group>
        );

      case '3col':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 33, 10, true)}
            <VSep />
            {mkPanel('b', 1, 34, 10, true)}
            <VSep />
            {mkPanel('c', 2, 33, 10, true)}
          </Group>
        );

      case '4col':
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 25, 10, true)}
            <VSep />
            {mkPanel('b', 1, 25, 10, true)}
            <VSep />
            {mkPanel('c', 2, 25, 10, true)}
            <VSep />
            {mkPanel('d', 3, 25, 10, true)}
          </Group>
        );

      case '3x2': {
        const mkCol2 = (top: string, ti: number, bot: string, bi: number, vKey: string, vLayout: typeof v0Layout) => (
          <Panel key={`col-${top}`} id={`col-${top}`} defaultSize={33} minSize={10} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Group orientation="vertical" className="h-full" defaultLayout={vLayout} onLayoutChanged={(l) => save(vKey, l)}>
              {mkPanel(top, ti, 50, 10, true)}
              <HSep />
              {mkPanel(bot, bi, 50, 10, true)}
            </Group>
          </Panel>
        );
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkCol2('a', 0, 'b', 1, v0Key, v0Layout)}
            <VSep />
            {mkCol2('c', 2, 'd', 3, v1Key, v1Layout)}
            <VSep />
            {mkCol2('e', 4, 'f', 5, v2Key, v2Layout)}
          </Group>
        );
      }

      case '4x2': {
        const mkCol2b = (top: string, ti: number, bot: string, bi: number, vKey: string, vLayout: typeof v0Layout) => (
          <Panel key={`col-${top}`} id={`col-${top}`} defaultSize={25} minSize={8} collapsible collapsedSize={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Group orientation="vertical" className="h-full" defaultLayout={vLayout} onLayoutChanged={(l) => save(vKey, l)}>
              {mkPanel(top, ti, 50, 10, true)}
              <HSep />
              {mkPanel(bot, bi, 50, 10, true)}
            </Group>
          </Panel>
        );
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkCol2b('a', 0, 'b', 1, v0Key, v0Layout)}
            <VSep />
            {mkCol2b('c', 2, 'd', 3, v1Key, v1Layout)}
            <VSep />
            {mkCol2b('e', 4, 'f', 5, v2Key, v2Layout)}
            <VSep />
            {mkCol2b('g', 6, 'h', 7, v3Key, v3Layout)}
          </Group>
        );
      }

      default:
        return (
          <Group orientation="horizontal" className="h-full" defaultLayout={hLayout} onLayoutChanged={(l) => save(hKey, l)}>
            {mkPanel('a', 0, 50, 15, true)}
            <VSep />
            {mkPanel('b', 1, 50, 15, true)}
          </Group>
        );
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden p-[12px]" data-testid="canvas-grid">
        {/* key includes templateId: forces Group remount on template switch so react-resizable-panels
            re-initialises column counts from scratch instead of inheriting old 2-panel sizes */}
        <div key={`${panelMountKey}-${templateId}`} className="flex flex-col flex-1 min-h-0 w-full">
          {renderTemplate()}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragSlot && (
          <div
            style={{
              transform: 'rotate(2deg) scale(1.04)',
              willChange: 'transform',
              width: dragSnapshot ? Math.min(dragSnapshot.w, 320) : 220,
              height: dragSnapshot
                ? Math.round(Math.min(dragSnapshot.w, 320) / dragSnapshot.w * dragSnapshot.h)
                : 'auto',
              overflow: 'hidden',
            }}
            className="rounded-[8px] border border-[#b3e502]/25 pointer-events-none shadow-[0_28px_64px_-12px_rgba(0,0,0,0.9),0_0_0_1px_rgba(179,229,2,0.10)] opacity-95"
          >
            {dragSnapshot ? (
              <img
                src={dragSnapshot.src}
                style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
                alt=""
              />
            ) : (
              <div className="bg-[#111118] w-full h-full flex flex-col gap-[6px] p-[10px]">
                <div className="flex items-center gap-[7px] min-w-0">
                  <span
                    className="inline-block size-[7px] shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        activeDragSessionObj?.status === 'active' ? '#b3e502'
                        : activeDragSessionObj?.status === 'waiting' ? '#4ade80'
                        : '#5a626c',
                    }}
                  />
                  <span className="truncate font-['JetBrains_Mono'] text-[12px] font-medium text-[#f0f0f0]">
                    {activeDragSessionObj?.name ?? ''}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
