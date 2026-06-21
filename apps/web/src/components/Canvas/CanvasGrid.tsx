import { useState, useMemo } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
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

function saveLayout(key: string, layout: Layout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
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
  theme,
}: CanvasGridProps) {
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);

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

  // Layout persistence keys
  const hKey = `cpg-${storageKey}-${templateId}-h`;
  const vlKey = `cpg-${storageKey}-${templateId}-vl`;
  const vrKey = `cpg-${storageKey}-${templateId}-vr`;

  const hLayout = useMemo(() => readLayout(hKey), [hKey]);
  const vlLayout = useMemo(() => readLayout(vlKey), [vlKey]);
  const vrLayout = useMemo(() => readLayout(vrKey), [vrKey]);

  const makeSlot = (slotId: string, slotIndex: number) => {
    const sessionId = slots[slotId] ?? null;
    const session = sessionId ? sessionMap.get(sessionId) : null;
    return (
      <CanvasSlot
        key={slotId}
        slotIndex={slotIndex}
        sessionId={sessionId}
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
      />
    );
  };

  const renderTemplate = () => {
    switch (templateId) {
      case 'single':
        return <div className="h-full overflow-hidden">{makeSlot('a', 0)}</div>;

      case '2col':
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="a" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('a', 0)}
            </Panel>
            <VSep />
            <Panel id="b" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('b', 1)}
            </Panel>
          </Group>
        );

      case '2row':
        return (
          <Group
            key={hKey}
            orientation="vertical"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="a" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('a', 0)}
            </Panel>
            <HSep />
            <Panel id="b" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('b', 1)}
            </Panel>
          </Group>
        );

      case 'left-stack':
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={vlLayout}
                onLayoutChanged={(l) => saveLayout(vlKey, l)}
              >
                <Panel id="a" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('a', 0)}
                </Panel>
                <HSep />
                <Panel id="b" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('b', 1)}
                </Panel>
              </Group>
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('c', 2)}
            </Panel>
          </Group>
        );

      case 'right-stack':
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('a', 0)}
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={vrLayout}
                onLayoutChanged={(l) => saveLayout(vrKey, l)}
              >
                <Panel id="b" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('b', 1)}
                </Panel>
                <HSep />
                <Panel id="c" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('c', 2)}
                </Panel>
              </Group>
            </Panel>
          </Group>
        );

      case '2x2':
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="left" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={vlLayout}
                onLayoutChanged={(l) => saveLayout(vlKey, l)}
              >
                <Panel id="a" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('a', 0)}
                </Panel>
                <HSep />
                <Panel id="b" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('b', 1)}
                </Panel>
              </Group>
            </Panel>
            <VSep />
            <Panel id="right" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={vrLayout}
                onLayoutChanged={(l) => saveLayout(vrKey, l)}
              >
                <Panel id="c" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('c', 2)}
                </Panel>
                <HSep />
                <Panel id="d" defaultSize={50} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {makeSlot('d', 3)}
                </Panel>
              </Group>
            </Panel>
          </Group>
        );

      case '3col':
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="a" defaultSize={33} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('a', 0)}
            </Panel>
            <VSep />
            <Panel id="b" defaultSize={34} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('b', 1)}
            </Panel>
            <VSep />
            <Panel id="c" defaultSize={33} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('c', 2)}
            </Panel>
          </Group>
        );

      default:
        return (
          <Group
            key={hKey}
            orientation="horizontal"
            className="h-full"
            defaultLayout={hLayout}
            onLayoutChanged={(l) => saveLayout(hKey, l)}
          >
            <Panel id="a" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('a', 0)}
            </Panel>
            <VSep />
            <Panel id="b" defaultSize={50} minSize={15} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {makeSlot('b', 1)}
            </Panel>
          </Group>
        );
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden p-[12px]" data-testid="canvas-grid">
      <div className="h-full w-full" data-testid="canvas-grid-inner">
        {renderTemplate()}
      </div>
    </div>
  );
}
