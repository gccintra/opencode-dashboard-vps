import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LabelBadge,
  type GitHubLabel,
} from './TaskBadge';
import { LabelChip } from './LabelChip';
import { PriorityBadge } from './PriorityBadge';
import type { TaskPriority } from '../../lib/api';

/** Customizable label applied to a task. */
export interface TaskLabel {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

/** Attachment metadata attached to a task. */
export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  source: string;
  priority?: TaskPriority;
  commentCount?: number;
  linkCount?: number;
  column: string;
  columnName?: string | null;
  columnCategory?: string | null;
  columnColor?: string | null;
  sortOrder: number;
  issueNumber?: number | null;
  githubIssueUrl: string | null;
  githubLabels: GitHubLabel[] | null;
  githubIssueNumber: number | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  agentType?: 'opencode' | 'claude' | null;
  agentName?: string | null;
  agentSource?: 'agents' | 'commands' | null;
  model?: string | null;
  effort?: string | null;
  labels?: TaskLabel[];
  attachments?: TaskAttachment[];
  sessionStatus?: 'active' | 'expired' | null;
}

interface KanbanCardProps {
  task: Task;
  onEdit: () => void;
  /** Deletion is intentionally not surfaced in the UI; prop kept for callers. */
  onDelete?: () => void;
  draggable?: boolean;
  /**
   * Move the task to another column (and/or position) after a drag-drop.
   * `beforeTaskId` is the id of the task that should end up right after the
   * dragged one — null means "drop at the end of the column".
   */
  onMoveTo?: (taskId: string, columnId: string, beforeTaskId: string | null) => void;
  /** Position in its column — drives the staggered entrance delay. */
  index?: number;
  /** Column accent colour, painted as a hairline edge on hover. */
  accent?: string;
}

interface DropHit {
  columnEl: HTMLElement | null;
  columnId: string | null;
  beforeTaskId: string | null;
}

// Touch needs to hold still this long before a press becomes a drag — a finger
// swiping across the screen to scroll columns must never be mistaken for one.
const TOUCH_LONG_PRESS_MS = 350;
// If a touch moves further than this before the long-press timer fires, it's a
// scroll, not a hold — cancel the timer and let the browser pan natively.
// Real touchscreens have natural finger jitter well above mouse-grade
// precision; too tight a value here cancels nearly every genuine hold and
// drag never engages — it just always feels like scrolling.
const TOUCH_SCROLL_CANCEL_PX = 24;

export function KanbanCard({
  task,
  onEdit,
  draggable = true,
  onMoveTo,
  index = 0,
  accent = '#b3e502',
}: KanbanCardProps) {
  const isGithub = task.source === 'github';
  const ghLabels = task.githubLabels || [];
  const richLabels = task.labels || [];
  const issueNum = isGithub ? task.githubIssueNumber : (task.issueNumber ?? null);

  // Click-vs-drag, done with raw pointer events (NOT native HTML5 DnD, which
  // starts a drag on the slightest movement and swallows the click — that made
  // a normal click register as a drag and never open the task). A press becomes
  // a drag only after the pointer moves past the threshold; until then a
  // pointer-up is a plain click → open the task. Touch presses get a larger
  // threshold than mouse because a finger naturally wobbles a few px on tap.
  // The dragged visual is rendered as a `position: fixed` portal attached to
  // <body> — escaping every ancestor's `overflow: auto/hidden` (the column's
  // vertical scroll and the board's horizontal scroll) so it can actually
  // follow the pointer anywhere on screen, including across columns.
  const articleRef = useRef<HTMLElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const thresholdRef = useRef(5);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTarget = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  // Manual scroll-panning state: once a touch move proves itself a scroll (not
  // a hold), touch-action is permanently 'none' on the card (see kb-card /
  // touch-none below — needed so the browser never races our long-press timer
  // by committing to its own native pan a few px in, which a later
  // preventDefault can't undo). So from that point on WE drive the scroll
  // ourselves for the rest of the gesture, locked to whichever axis the
  // finger first committed to.
  const scrollPanActiveRef = useRef(false);
  const scrollPanAxisRef = useRef<'x' | 'y' | null>(null);
  const scrollPanPointRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ghostRect, setGhostRect] = useState<DOMRect | null>(null);

  // Paint/clear the hovered column highlight directly (no shared React state).
  const setDropTarget = (el: HTMLElement | null) => {
    if (dropTarget.current === el) return;
    if (dropTarget.current) {
      dropTarget.current.style.removeProperty('background-color');
      dropTarget.current.style.removeProperty('box-shadow');
    }
    dropTarget.current = el;
    if (el) {
      el.style.backgroundColor = 'rgba(179,229,2,0.04)';
      el.style.boxShadow = 'inset 0 0 0 1px rgba(179,229,2,0.4)';
    }
  };

  // Column + insertion point under the point — self is hidden so we see what's
  // beneath. `beforeTaskId` is null when dropping past the last card (append).
  const dropInfoAt = (x: number, y: number): DropHit => {
    const node = articleRef.current;
    const prevPE = node?.style.pointerEvents;
    if (node) node.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    if (node) node.style.pointerEvents = prevPE ?? '';

    const columnEl = (hit?.closest('[data-column-id]') as HTMLElement | null) ?? null;
    if (!columnEl) return { columnEl: null, columnId: null, beforeTaskId: null };
    const columnId = columnEl.dataset.columnId ?? null;

    const cardEl = hit?.closest('[data-task-id]') as HTMLElement | null;
    if (!cardEl) return { columnEl, columnId, beforeTaskId: null };

    const rect = cardEl.getBoundingClientRect();
    const beforeTaskId =
      y < rect.top + rect.height / 2
        ? cardEl.dataset.taskId ?? null
        : ((cardEl.nextElementSibling as HTMLElement | null)?.dataset.taskId ?? null);
    return { columnEl, columnId, beforeTaskId };
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Edge auto-scroll: dragging a card to the rim of the board/column should
  // scroll that track on its own, like every other Kanban tool. Runs as a
  // rAF loop (not per pointermove) so it keeps scrolling even while the
  // finger/cursor sits still right at the edge.
  const EDGE_ZONE = 56;
  const EDGE_MAX_SPEED = 16;

  const autoScrollTick = () => {
    if (!draggingRef.current) {
      autoScrollFrameRef.current = null;
      return;
    }
    // No pointer position yet (engaged via long-press, finger hasn't moved) —
    // keep the loop alive so it picks up the first move without needing a
    // restart from handlePointerMove.
    if (lastPointerRef.current) {
      const { x, y } = lastPointerRef.current;
      const colEl = dropTarget.current ?? (articleRef.current?.closest('[data-column-id]') as HTMLElement | null);
      const boardEl = (colEl ?? articleRef.current)?.closest('.overflow-x-auto') as HTMLElement | null;

      const speedFor = (distanceIntoEdge: number) =>
        EDGE_MAX_SPEED * Math.max(0, Math.min(1, (EDGE_ZONE - distanceIntoEdge) / EDGE_ZONE));

      if (boardEl) {
        const rect = boardEl.getBoundingClientRect();
        if (x < rect.left + EDGE_ZONE) boardEl.scrollLeft -= speedFor(Math.max(0, x - rect.left));
        else if (x > rect.right - EDGE_ZONE) boardEl.scrollLeft += speedFor(Math.max(0, rect.right - x));
      }
      if (colEl) {
        const rect = colEl.getBoundingClientRect();
        if (y < rect.top + EDGE_ZONE) colEl.scrollTop -= speedFor(Math.max(0, y - rect.top));
        else if (y > rect.bottom - EDGE_ZONE) colEl.scrollTop += speedFor(Math.max(0, rect.bottom - y));
      }
    }
    autoScrollFrameRef.current = requestAnimationFrame(autoScrollTick);
  };

  const engageDrag = (pointerId: number) => {
    draggingRef.current = true;
    setGhostRect(articleRef.current?.getBoundingClientRect() ?? null);
    setDragging(true);
    try {
      articleRef.current?.setPointerCapture(pointerId);
    } catch {
      /* capture unsupported — drag still works via bubbling */
    }
    if (autoScrollFrameRef.current == null) {
      autoScrollFrameRef.current = requestAnimationFrame(autoScrollTick);
    }
  };

  const endDrag = () => {
    clearLongPressTimer();
    if (autoScrollFrameRef.current != null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    lastPointerRef.current = null;
    scrollPanActiveRef.current = false;
    scrollPanAxisRef.current = null;
    scrollPanPointRef.current = null;
    draggingRef.current = false;
    pressOrigin.current = null;
    pointerIdRef.current = null;
    setDropTarget(null);
    setDragging(false);
    setGhostRect(null);
    document.body.style.userSelect = '';
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button / touch only
    if ((e.target as HTMLElement).closest('a,button')) return; // let links/buttons act
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    draggingRef.current = false;
    // Defensive reset — guards against a previous gesture's scroll-pan state
    // surviving if its pointerup/cancel was ever lost (see the window-level
    // safety net below for the dragging-ghost equivalent of this).
    scrollPanActiveRef.current = false;
    scrollPanAxisRef.current = null;
    scrollPanPointRef.current = null;

    if (e.pointerType === 'touch') {
      // touch-action: none means native panning never starts here — no need
      // to preventDefault. If this turns out to be a scroll rather than a
      // hold, handlePointerMove takes over panning by hand.
      if (draggable !== false) {
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          if (pressOrigin.current && pointerIdRef.current === e.pointerId) {
            engageDrag(e.pointerId);
          }
        }, TOUCH_LONG_PRESS_MS);
      }
      return;
    }

    thresholdRef.current = 5;
    // Suppress the browser's native text selection while pressing/dragging — a
    // mouse-drag would otherwise select text across cards (ugly) AND fire
    // pointercancel, killing the drag before the lift animation could run.
    e.preventDefault();
    document.body.style.userSelect = 'none';
    window.getSelection?.()?.removeAllRanges();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressOrigin.current) return;

    if (e.pointerType === 'touch' && !draggingRef.current) {
      // Already proved itself a scroll, not a hold — pan the right container
      // by hand (touch-action: none means the browser never will), locked to
      // whichever axis the finger first committed to.
      if (scrollPanActiveRef.current) {
        const prev = scrollPanPointRef.current;
        scrollPanPointRef.current = { x: e.clientX, y: e.clientY };
        if (prev) {
          const colEl = articleRef.current?.closest('[data-column-id]') as HTMLElement | null;
          const boardEl = (colEl ?? articleRef.current)?.closest('.overflow-x-auto') as HTMLElement | null;
          if (scrollPanAxisRef.current === 'x' && boardEl) boardEl.scrollLeft -= e.clientX - prev.x;
          else if (scrollPanAxisRef.current === 'y' && colEl) colEl.scrollTop -= e.clientY - prev.y;
        }
        return;
      }

      // Still waiting on the long-press timer — a real move this big means
      // the finger is scrolling, not holding. Switch into manual-pan mode for
      // the rest of this gesture instead of letting the (disabled) native
      // pan handle it.
      const dxTotal = e.clientX - pressOrigin.current.x;
      const dyTotal = e.clientY - pressOrigin.current.y;
      const movedFar =
        Math.abs(dxTotal) > TOUCH_SCROLL_CANCEL_PX || Math.abs(dyTotal) > TOUCH_SCROLL_CANCEL_PX;
      if (movedFar) {
        clearLongPressTimer();
        scrollPanActiveRef.current = true;
        scrollPanAxisRef.current = Math.abs(dxTotal) >= Math.abs(dyTotal) ? 'x' : 'y';
        scrollPanPointRef.current = { x: e.clientX, y: e.clientY };
        const colEl = articleRef.current?.closest('[data-column-id]') as HTMLElement | null;
        const boardEl = (colEl ?? articleRef.current)?.closest('.overflow-x-auto') as HTMLElement | null;
        if (scrollPanAxisRef.current === 'x' && boardEl) boardEl.scrollLeft -= dxTotal;
        else if (scrollPanAxisRef.current === 'y' && colEl) colEl.scrollTop -= dyTotal;
      }
      return;
    }

    if (!draggingRef.current) {
      if (draggable === false) return;
      const moved =
        Math.abs(e.clientX - pressOrigin.current.x) > thresholdRef.current ||
        Math.abs(e.clientY - pressOrigin.current.y) > thresholdRef.current;
      if (!moved) return;
      engageDrag(e.pointerId);
    }

    // Mouse text-selection guard; touch already has no native pan to block
    // (touch-action: none), so this is mostly a no-op there.
    e.preventDefault();
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    if (ghostRef.current && pressOrigin.current) {
      const dx = e.clientX - pressOrigin.current.x;
      const dy = e.clientY - pressOrigin.current.y;
      ghostRef.current.style.transform = `translate(${dx}px, ${dy}px) scale(1.03) rotate(2deg)`;
    }
    const hit = dropInfoAt(e.clientX, e.clientY);
    setDropTarget(hit.columnEl);
  };

  const releaseCapture = () => {
    if (pointerIdRef.current != null) {
      try {
        articleRef.current?.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* nothing captured */
      }
    }
  };

  const commitDrop = (clientX: number, clientY: number) => {
    const { columnId, beforeTaskId } = dropInfoAt(clientX, clientY);
    endDrag();
    if (columnId) onMoveTo?.(task.id, columnId, beforeTaskId);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearLongPressTimer();
    const wasDragging = draggingRef.current;
    const wasScrollPanning = scrollPanActiveRef.current;
    const origin = pressOrigin.current;
    releaseCapture();
    if (wasDragging) {
      commitDrop(e.clientX, e.clientY);
      return;
    }
    endDrag();
    if (wasScrollPanning) return; // released after a manual scroll — not a tap
    if (!origin) return;
    if ((e.target as HTMLElement).closest('a,button')) return;
    onEdit(); // pointer never crossed the drag threshold → it was a click/tap
  };

  // Safety net: if the OS/browser ever drops a touch sequence mid-drag —
  // app backgrounded, an edge-swipe gesture stole it, multi-touch confusion —
  // the card's own pointerup/pointercancel may simply never fire, leaving
  // the ghost stuck on screen forever (dragging=true with no way out). These
  // window-level listeners are a dead-man's switch: draggingRef is already
  // false by the time they run in the normal case (the element's own
  // handler runs first during the same bubble phase), so they only do
  // anything when that normal path was skipped entirely.
  useEffect(() => {
    if (!dragging) return;
    const pid = pointerIdRef.current;
    const matchesPointer = (ev: PointerEvent) => pid == null || ev.pointerId === pid;
    const onWindowUp = (ev: PointerEvent) => {
      if (!draggingRef.current || !matchesPointer(ev)) return;
      releaseCapture();
      commitDrop(ev.clientX, ev.clientY);
    };
    const onWindowCancel = (ev: PointerEvent) => {
      if (!draggingRef.current || !matchesPointer(ev)) return;
      releaseCapture();
      endDrag();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && draggingRef.current) {
        releaseCapture();
        endDrag();
      }
    };
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowCancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowCancel);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dragging]);

  const cardBody = (
    <>
      {/* Accent edge — fades in on hover */}
      <span
        aria-hidden
        className="absolute inset-y-[10px] left-0 w-[2px] rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ backgroundColor: accent }}
      />

      {/* Top row: IDs + project badge */}
      <div className="flex flex-wrap items-center gap-[6px]">
        <PriorityBadge priority={task.priority ?? 'medium'} />
        {issueNum != null && (
          <span className="rounded-[5px] border border-white/[0.07] bg-black/40 px-[6px] py-[2px] font-['JetBrains_Mono'] text-[10px] font-bold tracking-[0.3px] text-[#9aa3ad]">
            {isGithub ? '#' : ''}
            {issueNum}
          </span>
        )}
        {task.projectName && (
          <span className="rounded-[5px] border border-white/[0.05] bg-white/[0.02] px-[6px] py-[2px] font-['Inter'] text-[10px] font-medium text-[#6b7280]">
            {task.projectName}
          </span>
        )}
        {task.sessionId && (
          <span className="ml-auto flex items-center gap-[4px] rounded-[5px] bg-[rgba(179,229,2,0.1)] px-[6px] py-[2px] font-['Inter'] text-[10px] font-semibold text-[#b3e502]">
            <span className="relative flex size-[5px]">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b3e502] opacity-60" />
              <span className="relative inline-flex size-[5px] rounded-full bg-[#b3e502]" />
            </span>
            live
          </span>
        )}
      </div>

      {/* Title */}
      <h4 className="font-['Inter'] text-[13.5px] font-semibold leading-[1.4] text-[#f2f3f5] line-clamp-2">
        {task.title}
      </h4>

      {/* Custom project labels */}
      {richLabels.length > 0 && (
        <div className="flex flex-wrap gap-[4px]">
          {richLabels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      )}

      {/* GitHub labels */}
      {ghLabels.length > 0 && (
        <div className="flex flex-wrap gap-[4px]">
          {ghLabels.map((label) => (
            <LabelBadge key={label.name} label={label} />
          ))}
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between pt-[2px]">
        {task.githubIssueUrl ? (
          <a
            href={task.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-[4px] font-['Inter'] text-[11px] font-medium text-[#58a6ff] hover:underline"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Open
          </a>
        ) : (
          <span />
        )}

        {/* Meta counters: comments + links */}
        <div className="ml-auto flex items-center gap-[10px] text-[#6b7280]">
          {(task.commentCount ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-[3px] font-['Inter'] text-[11px]"
              title={`${task.commentCount} comment(s)`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v6A1.5 1.5 0 0 1 12.5 12H6l-3 2.5V12H3.5A1.5 1.5 0 0 1 2 10.5v-6Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              {task.commentCount}
            </span>
          )}
          {(task.linkCount ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-[3px] font-['Inter'] text-[11px]"
              title={`${task.linkCount} linked task(s)`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              {task.linkCount}
            </span>
          )}
        </div>
      </div>
    </>
  );

  // touch-none (touch-action: none) is mandatory here, not optional: without
  // it the browser can commit to its own native pan a couple px into a touch
  // move, racing our long-press timer — and once committed, a later
  // preventDefault can't undo it (this was the "drag never follows my
  // finger" bug). With it permanently off, swipes are scrolled by hand in
  // handlePointerMove (scrollPanActiveRef) once they prove themselves a
  // scroll rather than a hold. shrink-0 keeps cards at their natural size —
  // without it a long column would squash every card instead of scrolling.
  const baseClassName =
    "kb-card group relative isolate flex shrink-0 touch-none select-none flex-col gap-[10px] overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[14px] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md";

  return (
    <>
      <article
        ref={articleRef}
        data-task-id={task.id}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endDrag}
        style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
        className={`${baseClassName} kb-rise transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-[2px] hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b3e502]/40 ${
          dragging ? 'cursor-grabbing opacity-0' : 'cursor-pointer'
        }`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEdit();
        }}
      >
        {cardBody}
      </article>

      {dragging &&
        ghostRect &&
        createPortal(
          <div
            ref={ghostRef}
            aria-hidden
            style={{
              position: 'fixed',
              top: ghostRect.top,
              left: ghostRect.left,
              width: ghostRect.width,
              height: ghostRect.height,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
            className={`${baseClassName} cursor-grabbing opacity-90 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)]`}
          >
            {cardBody}
          </div>,
          document.body,
        )}
    </>
  );
}
