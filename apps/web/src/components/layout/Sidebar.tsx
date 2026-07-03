import { useState, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSessions, type SessionItem, type SessionGroup } from '../../hooks/useSessions';
import StatusBadge from '../StatusBadge/StatusBadge';
import { Badge } from '../ui';

/* ── Inline SVG icons ── */

function ProjectsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="6.5" y="1.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="11.5" y="1.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="1.5" y="6.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="6.5" y="6.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="11.5" y="6.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="1.5" y="11.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="6.5" y="11.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
      <rect x="11.5" y="11.5" width="3.5" height="3.5" rx="1" fill="currentColor" />
    </svg>
  );
}

function SessionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path d="M5 13.5h6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="8" y1="11.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6.5" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="11.5" y="2" width="3" height="12" rx="1" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 2h6.5l3.5 3.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function TemplatesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="7" width="5" height="7" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9" y="7" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <path d="M9 12h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/* ── Small action icons ── */

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRightIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
    >
      <path
        d="M3.5 1.5L7 5L3.5 8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <path
        d="M1 1h16M1 7h16M1 13h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── ALF brand mark — Alien Life Form on a lime glass tile ── */

export function AlfLogo({ size = 30 }: { size?: number }) {
  const glyph = Math.round(size * 0.66);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-control bg-accent"
      style={{ width: size, height: size }}
    >
      <svg
        role="img"
        aria-label="ALF code logo"
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* friendly alien head — pointed chin, the Alien Life Form */}
        <path
          d="M12 2.5c4.2 0 6.8 3 6.8 6.9 0 3-1.6 5-3.2 6.5-1.1 1-1.7 1.9-1.7 3.2 0 1.5-.8 2.4-1.9 2.4s-1.9-.9-1.9-2.4c0-1.3-.6-2.2-1.7-3.2C6.8 14.4 5.2 12.4 5.2 9.4 5.2 5.5 7.8 2.5 12 2.5Z"
          fill="#0a0a0f"
        />
        {/* big almond eyes, lime cut-outs */}
        <ellipse cx="9.4" cy="9.6" rx="1.7" ry="2.6" transform="rotate(18 9.4 9.6)" fill="#b3e502" />
        <ellipse cx="14.6" cy="9.6" rx="1.7" ry="2.6" transform="rotate(-18 14.6 9.6)" fill="#b3e502" />
      </svg>
    </span>
  );
}

/* ── Nav item (mac source-list row: selection is a tinted pill, no left bar) ── */

function NavItem({
  to,
  icon,
  label,
  trailing,
  onClick,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `mx-[8px] flex h-[28px] items-center gap-[8px] rounded-control px-[8px] text-[13px] font-medium transition-colors duration-150 ${
          isActive ? 'bg-accent/12 text-ink' : 'text-ink-2 hover:bg-white/[0.04] hover:text-ink'
        }`
      }
      onClick={onClick}
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex size-[16px] shrink-0 items-center justify-center ${
              isActive ? 'text-accent' : ''
            }`}
          >
            {icon}
          </span>
          <span>{label}</span>
          {trailing}
        </>
      )}
    </NavLink>
  );
}

/* ── Sidebar ── */

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);

function estimateSidebarTerminalDims() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const fontSize = w < 640 ? 12 : 13;
  const charW = fontSize * 0.6;
  const availW = Math.max(40, w - 240 - 34);
  const availH = Math.max(10, h - 50 - 42 - 26 - 34);
  return {
    cols: Math.floor(availW / charW),
    rows: Math.floor(availH / (fontSize * 1.2)), // xterm lineHeight:1.2
  };
}

export default function Sidebar() {
  const { groups, loading, renameSession, closeSession, createSession } = useSessions();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Listen for sidebar:open event dispatched by page headers
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener('sidebar:open', handler);
    return () => window.removeEventListener('sidebar:open', handler);
  }, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus the rename input when it appears.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // Close mobile drawer on navigation.
  const handleNavigate = useCallback(
    (to: string) => {
      navigate(to);
      setMobileOpen(false);
    },
    [navigate],
  );

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleRename = useCallback(
    async (sessionId: string) => {
      const name = renameValue.trim();
      if (!name) {
        setRenaming(null);
        return;
      }
      try {
        await renameSession(sessionId, name);
      } catch {
        // Silently fail — the user can retry.
      }
      setRenaming(null);
    },
    [renameValue, renameSession],
  );

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, sessionId: string) => {
      if (e.key === 'Enter') {
        handleRename(sessionId);
      } else if (e.key === 'Escape') {
        setRenaming(null);
      }
    },
    [handleRename],
  );

  const handleClose = useCallback(
    async (sessionId: string) => {
      try {
        await closeSession(sessionId);
      } catch {
        // Silently fail.
      }
      setConfirmClose(null);
    },
    [closeSession],
  );

  const handleCreate = useCallback(
    async (projectId: string) => {
      if (creating.has(projectId)) return;
      setCreating((prev) => new Set(prev).add(projectId));
      try {
        const dims = estimateSidebarTerminalDims();
        const session = await createSession(projectId, dims);
        handleNavigate(`/projects/${projectId}?session=${session.sessionId}`);
      } catch {
        // Silently fail.
      }
      setCreating((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    },
    [creating, createSession, handleNavigate],
  );

  const totalActive = groups
    .flatMap((g) => g.sessions)
    .filter((s) => !DEAD_STATUSES.has(s.status)).length;

  const sidebarContent = (
    <>
      {/* ══════ Banner ══════ */}
      <div className="flex h-[68px] shrink-0 items-center gap-[11px] border-b border-hairline px-[16px] pb-[17px] pt-[20px]">
        <AlfLogo />
        <div className="flex flex-col leading-none">
          <span className="flex items-baseline gap-[4px] text-[15px] font-semibold leading-[18px] tracking-[-0.3px]">
            <span className="text-ink">ALF</span>
            <span className="text-accent">code</span>
          </span>
          <span className="mt-[4px] font-['JetBrains_Mono'] text-[10px] font-normal uppercase tracking-[0.6px] text-ink-3">
            Agent Dashboard
          </span>
        </div>
      </div>

      {/* ══════ Navigation ══════ */}
      <nav className="flex flex-col gap-[2px] py-[8px]">
        <NavItem
          to="/projects"
          icon={<ProjectsIcon />}
          label="Projects"
          onClick={() => setMobileOpen(false)}
        />
        <NavItem
          to="/sessions"
          icon={<SessionsIcon />}
          label="Sessions"
          onClick={() => setMobileOpen(false)}
          trailing={
            totalActive > 0 ? (
              <Badge tone="warning" mono className="ml-auto">
                {totalActive}
              </Badge>
            ) : undefined
          }
        />
        <NavItem
          to="/tasks"
          icon={<TasksIcon />}
          label="Tasks"
          onClick={() => setMobileOpen(false)}
        />
        <NavItem
          to="/files"
          icon={<FilesIcon />}
          label="Files"
          onClick={() => setMobileOpen(false)}
        />
        <NavItem
          to="/templates"
          icon={<TemplatesIcon />}
          label="Templates"
          onClick={() => setMobileOpen(false)}
        />
      </nav>

      {/* ══════ Dynamic Session List (commented — not needed for now) ══════ */}
      {/* <div className="flex-1 overflow-y-auto border-t border-white/[0.07]">
        {loading ? (
          <div className="px-[16px] py-[12px] text-[11px] text-ink-3">
            Loading sessions…
          </div>
        ) : groups.length === 0 ? (
          <div className="px-[16px] py-[12px] text-[11px] text-ink-3">
            No projects yet
          </div>
        ) : (
          groups.map((group) => (
            <ProjectSection
              key={group.project.id}
              group={group}
              activeProjectId={undefined}
              activeSessionId={null}
              expanded={expandedProjects.has(group.project.id)}
              renaming={renaming}
              renameValue={renameValue}
              confirmClose={confirmClose}
              creating={creating.has(group.project.id)}
              renameInputRef={renameInputRef}
              onToggle={() => toggleProject(group.project.id)}
              onNavigate={handleNavigate}
              onStartRename={(id, name) => {
                setRenaming(id);
                setRenameValue(name);
              }}
              onRenameValueChange={setRenameValue}
              onRenameKeyDown={handleRenameKeyDown}
              onRenameSubmit={handleRename}
              onConfirmClose={setConfirmClose}
              onClose={handleClose}
              onCreate={() => handleCreate(group.project.id)}
            />
          ))
        )}
      </div> */}
      <div className="flex-1" />

      {/* ══════ User Profile ══════ */}
      <div className="border-t border-hairline px-[8px] pt-[11px]">
        <div className="flex items-center gap-[10px] rounded-control border border-hairline bg-surface-2 px-[11px] py-[9px]">
          <div className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-black">
            U
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-['JetBrains_Mono'] text-[11.5px] font-medium text-ink">
              user@vps
            </span>
            <span className="text-[10.5px] text-ink-3">Single user</span>
          </div>
        </div>
      </div>

      {/* ══════ System Status ══════ */}
      <div className="flex h-[28px] shrink-0 items-center gap-[6px] border-t border-hairline px-[18px] pb-[7px] pt-[8px]">
        <span className="size-[6px] shrink-0 rounded-full bg-success" />
        <span className="font-['JetBrains_Mono'] text-[10px] font-normal tracking-[0.4px] text-ink-3">
          daemon online
        </span>
      </div>
    </>
  );

  return (
    <>
      {/* ══════ Mobile overlay ══════ */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="sidebar-overlay"
        />
      )}

      {/* ══════ Sidebar panel ══════ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        data-testid="sidebar"
      >
        {sidebarContent}
      </aside>
    </>
  );
}

/* ── Project Section ── */

function ProjectSection({
  group,
  activeProjectId,
  activeSessionId,
  expanded,
  renaming,
  renameValue,
  confirmClose,
  creating,
  renameInputRef,
  onToggle,
  onNavigate,
  onStartRename,
  onRenameValueChange,
  onRenameKeyDown,
  onRenameSubmit,
  onConfirmClose,
  onClose,
  onCreate,
}: {
  group: SessionGroup;
  activeProjectId: string | undefined;
  activeSessionId: string | null;
  expanded: boolean;
  renaming: string | null;
  renameValue: string;
  confirmClose: string | null;
  creating: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onNavigate: (to: string) => void;
  onStartRename: (id: string, name: string) => void;
  onRenameValueChange: (v: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent, id: string) => void;
  onRenameSubmit: (id: string) => void;
  onConfirmClose: (id: string | null) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}) {
  const isActive = activeProjectId === group.project.id;

  return (
    <div className="border-b border-hairline">
      {/* ══ Project header ══ */}
      <div
        className={`flex cursor-pointer items-center gap-[8px] px-[16px] py-[10px] text-[12px] font-medium text-ink-2 hover:text-ink transition-colors ${
          isActive ? 'bg-accent/[0.08] text-accent' : ''
        }`}
        onClick={onToggle}
        data-testid={`project-section-${group.project.id}`}
      >
        <ChevronRightIcon open={expanded} />
        <span className="flex-1 truncate">{group.project.name}</span>
        <button
          className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-white/[0.06] hover:text-accent transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onCreate();
          }}
          disabled={creating}
          aria-label={`New session in ${group.project.name}`}
          data-testid={`create-session-${group.project.id}`}
        >
          <PlusIcon />
        </button>
      </div>

      {/* ══ Session list ══ */}
      {expanded && (
        <div className="pb-[4px]">
          {group.sessions.length === 0 ? (
            <div className="px-[24px] py-[4px] text-[11px] text-ink-3">
              No sessions
            </div>
          ) : (
            group.sessions.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                isActive={session.sessionId === activeSessionId}
                isRenaming={renaming === session.sessionId}
                renameValue={renaming === session.sessionId ? renameValue : ''}
                isConfirming={confirmClose === session.sessionId}
                renameInputRef={renaming === session.sessionId ? renameInputRef : undefined}
                onNavigate={() =>
                  onNavigate(`/projects/${group.project.id}?session=${session.sessionId}`)
                }
                onStartRename={() => onStartRename(session.sessionId, session.name)}
                onRenameValueChange={onRenameValueChange}
                onRenameKeyDown={(e) => onRenameKeyDown(e, session.sessionId)}
                onRenameBlur={() => onRenameSubmit(session.sessionId)}
                onRequestClose={() => onConfirmClose(session.sessionId)}
                onConfirmClose={() => onClose(session.sessionId)}
                onCancelClose={() => onConfirmClose(null)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Session Row ── */

function SessionRow({
  session,
  isRenaming,
  renameValue,
  isConfirming,
  isActive,
  renameInputRef,
  onNavigate,
  onStartRename,
  onRenameValueChange,
  onRenameKeyDown,
  onRenameBlur,
  onRequestClose,
  onConfirmClose,
  onCancelClose,
}: {
  session: SessionItem;
  isRenaming: boolean;
  renameValue: string;
  isConfirming: boolean;
  isActive?: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null> | undefined;
  onNavigate: () => void;
  onStartRename: () => void;
  onRenameValueChange: (v: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameBlur: () => void;
  onRequestClose: () => void;
  onConfirmClose: () => void;
  onCancelClose: () => void;
}) {
  // Map session status to badge status.
  const badgeStatus = (() => {
    if (session.status === 'exited' || session.status === 'killed') return 'finished' as const;
    if (session.status === 'waiting') return 'waiting' as const;
    return 'active' as const;
  })();

  return (
    <div
      className={`relative group flex cursor-pointer items-center gap-[8px] pl-[36px] pr-[16px] py-[5px] text-[12px] text-ink-2 hover:bg-white/[0.04] hover:text-ink transition-colors ${
        isRenaming ? 'bg-accent/[0.08]' : ''
      } ${isActive ? 'bg-accent/[0.08] text-accent' : ''}`}
      onClick={onNavigate}
      data-testid={`session-row-${session.sessionId}`}
    >
      {isActive && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}

      {/* Status badge */}
      <StatusBadge status={badgeStatus} size="sm" />

      {/* Name or rename input */}
      {isRenaming ? (
        <input
          ref={renameInputRef as React.RefObject<HTMLInputElement>}
          className="flex-1 rounded-[4px] border border-accent/30 bg-surface-2 px-[6px] py-[2px] text-[12px] text-ink outline-none"
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
          onClick={(e) => e.stopPropagation()}
          data-testid={`rename-input-${session.sessionId}`}
        />
      ) : (
        <span
          className="flex-1 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          data-testid={`session-name-${session.sessionId}`}
        >
          {session.name}
        </span>
      )}

      {/* Close button */}
      {!isRenaming && (
        <button
          className="flex size-[16px] shrink-0 items-center justify-center rounded-[3px] text-ink-4 opacity-0 group-hover:opacity-100 hover:bg-danger/15 hover:text-danger transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onRequestClose();
          }}
          aria-label={`Close ${session.name}`}
          data-testid={`close-session-${session.sessionId}`}
        >
          <CloseIcon />
        </button>
      )}

      {/* Confirmation dialog */}
      {isConfirming && (
        <div
          className="absolute right-[8px] top-full z-50 mt-[4px] flex items-center gap-[6px] rounded-control border border-hairline bg-surface-3 px-[10px] py-[8px] shadow-lg"
          onClick={(e) => e.stopPropagation()}
          data-testid={`confirm-close-${session.sessionId}`}
        >
          <span className="text-[11px] text-ink-2">Close?</span>
          <button
            className="rounded-[4px] bg-danger px-[8px] py-[2px] text-[11px] font-medium text-white hover:bg-danger/80 transition-colors"
            onClick={onConfirmClose}
            data-testid={`confirm-close-yes-${session.sessionId}`}
          >
            Yes
          </button>
          <button
            className="rounded-[4px] bg-white/[0.08] px-[8px] py-[2px] text-[11px] text-ink-2 hover:bg-white/[0.12] transition-colors"
            onClick={onCancelClose}
            data-testid={`confirm-close-no-${session.sessionId}`}
          >
            No
          </button>
        </div>
      )}
    </div>
  );
}
