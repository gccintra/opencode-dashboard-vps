import { useState, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSessions, type SessionItem, type SessionGroup } from '../../hooks/useSessions';
import StatusBadge from '../StatusBadge/StatusBadge';

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

/* ── Shared nav link style ── */

const navLinkBase =
  "mx-[8px] flex h-[34px] items-center gap-[10px] rounded-[8px] px-[11px] py-[9px] font-['Inter'] text-[13.5px] font-medium tracking-[0.135px]";

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
    rows: Math.floor(availH / fontSize),
  };
}

export default function Sidebar() {
  const { groups, loading, renameSession, closeSession, createSession } = useSessions();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
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
      <div className="flex h-[68px] shrink-0 items-center gap-[10px] border-b border-[rgba(255,255,255,0.08)] px-[16px] pb-[17px] pt-[20px]">
        <span className="font-['JetBrains_Mono'] text-[18px] font-medium leading-[18px] tracking-[-0.5px] text-[#af0]">
          {'> _'}
        </span>
        <div className="flex flex-col">
          <span className="font-['Inter'] text-[14px] font-semibold tracking-[0.14px] text-[#f0f0f0]">
            OpenCode
          </span>
          <span className="font-['JetBrains_Mono'] text-[10px] font-normal uppercase tracking-[0.6px] text-[#445]">
            Dashboard
          </span>
        </div>
      </div>

      {/* ══════ Navigation ══════ */}
      <nav className="flex flex-col py-[8px]">
        {/* Projects */}
        <NavLink
          to="/projects"
          end
          className={({ isActive }) =>
            `${navLinkBase} ${
              isActive
                ? 'relative border border-[rgba(0,0,0,0)] bg-[rgba(170,255,0,0.12)] text-[#f0f0f0]'
                : 'text-[#889]'
            }`
          }
          onClick={() => setMobileOpen(false)}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-[4px] h-[24px] w-[2px] rounded-br-[2px] rounded-tr-[2px] bg-[#af0]" />
              )}
              <span className="flex size-[16px] shrink-0 items-center justify-center">
                <ProjectsIcon />
              </span>
              <span>Projects</span>
            </>
          )}
        </NavLink>

        {/* Sessions */}
        <NavLink
          to="/sessions"
          end
          className={({ isActive }) =>
            `${navLinkBase} ${
              isActive
                ? 'relative border border-[rgba(0,0,0,0)] bg-[rgba(170,255,0,0.12)] text-[#f0f0f0]'
                : 'text-[#889]'
            }`
          }
          onClick={() => setMobileOpen(false)}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-[4px] h-[24px] w-[2px] rounded-br-[2px] rounded-tr-[2px] bg-[#af0]" />
              )}
              <span className="flex size-[16px] shrink-0 items-center justify-center">
                <SessionsIcon />
              </span>
              <span>Sessions</span>
              {totalActive > 0 && (
                <span className="ml-auto rounded-[10px] border border-[rgba(255,170,0,0.2)] bg-[rgba(255,170,0,0.12)] px-[6px] py-[2px] font-['JetBrains_Mono'] text-[10px] font-medium tracking-[0.135px] text-[#fa0]">
                  {totalActive}
                </span>
              )}
            </>
          )}
        </NavLink>
      </nav>

      {/* ══════ Dynamic Session List (commented — not needed for now) ══════ */}
      {/* <div className="flex-1 overflow-y-auto border-t border-[rgba(255,255,255,0.08)]">
        {loading ? (
          <div className="px-[16px] py-[12px] font-['Inter'] text-[11px] text-[#556]">
            Loading sessions…
          </div>
        ) : groups.length === 0 ? (
          <div className="px-[16px] py-[12px] font-['Inter'] text-[11px] text-[#556]">
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
      <div className="border-t border-[rgba(255,255,255,0.08)] px-[8px] pt-[11px]">
        <div className="flex items-center gap-[10px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] px-[11px] py-[9px]">
          <div className="flex size-[28px] shrink-0 items-center justify-center rounded-[14px] bg-[#af0] font-['Inter'] text-[11px] font-bold text-black">
            U
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-['JetBrains_Mono'] text-[11.5px] font-medium text-[#f0f0f0]">
              user@vps
            </span>
            <span className="text-[10.5px] text-[#445]">Single user</span>
          </div>
        </div>
      </div>

      {/* ══════ System Status ══════ */}
      <div className="flex h-[28px] shrink-0 items-center gap-[6px] border-t border-[rgba(255,255,255,0.08)] px-[18px] pb-[7px] pt-[8px]">
        <span
          className="size-[6px] shrink-0 rounded-[3px] bg-[#2d8] opacity-90"
          style={{ boxShadow: '0px 0px 6px 0px rgba(34,221,136,0.6)' }}
        />
        <span className="font-['JetBrains_Mono'] text-[10px] font-normal tracking-[0.4px] text-[#445]">
          daemon online
        </span>
      </div>
    </>
  );

  return (
    <>
      {/* ══════ Mobile hamburger — hidden while sidebar is open (close via overlay) ══════ */}
      {!mobileOpen && (
        <button
          className="fixed left-[12px] top-[7px] z-50 flex size-[36px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] text-[#889] hover:text-[#f0f0f0] lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open sidebar"
          data-testid="hamburger-button"
        >
          <HamburgerIcon />
        </button>
      )}

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
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#0d0d14] transition-transform duration-200 lg:static lg:translate-x-0 ${
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
    <div className="border-b border-[rgba(255,255,255,0.06)]">
      {/* ══ Project header ══ */}
      <div
        className={`flex cursor-pointer items-center gap-[8px] px-[16px] py-[10px] font-['Inter'] text-[12px] font-medium text-[#889] hover:text-[#ccd] transition-colors ${
          isActive ? 'bg-[rgba(170,255,0,0.06)] text-[#af0]' : ''
        }`}
        onClick={onToggle}
        data-testid={`project-section-${group.project.id}`}
      >
        <ChevronRightIcon open={expanded} />
        <span className="flex-1 truncate">{group.project.name}</span>
        <button
          className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-[#556] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#af0] transition-colors"
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
            <div className="px-[24px] py-[4px] font-['Inter'] text-[11px] text-[#556]">
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
      className={`relative group flex cursor-pointer items-center gap-[8px] pl-[36px] pr-[16px] py-[5px] font-['Inter'] text-[12px] text-[#889] hover:bg-[rgba(255,255,255,0.03)] hover:text-[#f0f0f0] transition-colors ${
        isRenaming ? 'bg-[rgba(170,255,0,0.06)]' : ''
      } ${isActive ? 'bg-[rgba(170,255,0,0.06)] text-[#af0]' : ''}`}
      onClick={onNavigate}
      data-testid={`session-row-${session.sessionId}`}
    >
      {isActive && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#af0]" />}

      {/* Status badge */}
      <StatusBadge status={badgeStatus} size="sm" />

      {/* Name or rename input */}
      {isRenaming ? (
        <input
          ref={renameInputRef as React.RefObject<HTMLInputElement>}
          className="flex-1 rounded-[4px] border border-[rgba(170,255,0,0.3)] bg-[#111118] px-[6px] py-[2px] font-['Inter'] text-[12px] text-[#f0f0f0] outline-none"
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
          className="flex size-[16px] shrink-0 items-center justify-center rounded-[3px] text-[#445] opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,50,50,0.15)] hover:text-[#f54] transition-all"
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
          className="absolute right-[8px] top-full z-50 mt-[4px] flex items-center gap-[6px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#16161f] px-[10px] py-[8px] shadow-lg"
          onClick={(e) => e.stopPropagation()}
          data-testid={`confirm-close-${session.sessionId}`}
        >
          <span className="font-['Inter'] text-[11px] text-[#889]">Close?</span>
          <button
            className="rounded-[4px] bg-[#f54] px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-white hover:bg-[#e43] transition-colors"
            onClick={onConfirmClose}
            data-testid={`confirm-close-yes-${session.sessionId}`}
          >
            Yes
          </button>
          <button
            className="rounded-[4px] bg-[rgba(255,255,255,0.08)] px-[8px] py-[2px] font-['Inter'] text-[11px] text-[#889] hover:bg-[rgba(255,255,255,0.12)] transition-colors"
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
