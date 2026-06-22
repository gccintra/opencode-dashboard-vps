import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import { useSessionEvents } from '../hooks/useSessionEvents';

/* ── Types ── */

interface SessionItem {
  sessionId: string;
  projectId: string;
  name: string;
  status: string;
  createdAt: number;
}

interface ProjectBrief {
  id: string;
  name: string;
}

interface SessionGroup {
  project: ProjectBrief;
  sessions: SessionItem[];
}

const DEAD_STATUSES = new Set(['exited', 'killed', 'finished']);

/* ── Helpers ── */

function isValidProjectId(id: unknown): id is string {
  if (!id || typeof id !== 'string' || id === 'undefined' || id === 'null') return false;
  return id.trim().length > 0;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts * 1000;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function estimateDims() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  const fontSize = 13;
  const charW = fontSize * 0.6;
  // global sidebar (240) + inner panel (220) on desktop
  const reserved = w >= 1024 ? 240 + 220 + 48 : 36;
  return {
    cols: Math.max(40, Math.floor((w - reserved) / charW)),
    rows: Math.max(10, Math.floor((h - 120) / fontSize)),
  };
}

/* ── Status config ── */

interface StatusStyle {
  dot: string;
  dotGlow: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  label: string;
  pulse: boolean;
}

function getStatusStyle(status: string): StatusStyle {
  if (status === 'active') {
    return {
      dot: '#22dd88',
      dotGlow: '0 0 6px rgba(34,221,136,0.6)',
      badgeBg: 'rgba(34,221,136,0.1)',
      badgeBorder: 'rgba(34,221,136,0.25)',
      badgeText: '#22dd88',
      label: 'Active',
      pulse: true,
    };
  }
  if (status === 'waiting') {
    return {
      dot: '#ffaa00',
      dotGlow: '0 0 6px rgba(255,170,0,0.5)',
      badgeBg: 'rgba(255,170,0,0.1)',
      badgeBorder: 'rgba(255,170,0,0.25)',
      badgeText: '#ffaa00',
      label: 'Waiting',
      pulse: false,
    };
  }
  return {
    dot: '#445566',
    dotGlow: 'none',
    badgeBg: 'rgba(68,85,102,0.1)',
    badgeBorder: 'rgba(68,85,102,0.2)',
    badgeText: '#9aa3ad',
    label: status,
    pulse: false,
  };
}

/* ── Pencil icon ── */

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M7.5 1.5l2 2L3.5 9.5H1.5V7.5L7.5 1.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Session Card ── */

function SessionCard({
  session,
  projectName,
  onClick,
  onRename,
  index = 0,
}: {
  session: SessionItem & { projectId: string; projectName: string };
  projectName: string;
  onClick: () => void;
  onRename: (sessionId: string, name: string) => void;
  index?: number;
}) {
  const s = getStatusStyle(session.status);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(session.name);
      setRenaming(true);
    },
    [session.name],
  );

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session.sessionId, trimmed);
    }
    setRenaming(false);
  }, [renameValue, session.name, session.sessionId, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        setRenaming(false);
      }
    },
    [commitRename],
  );

  return (
    <div
      onClick={() => !renaming && onClick()}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="kb-rise group relative isolate cursor-pointer overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[18px] backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-[2px] hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)]"
    >
      {/* Live accent edge — fades in on hover */}
      <span
        aria-hidden
        className="absolute inset-y-[14px] left-0 w-[2px] rounded-r-full bg-[#b3e502] opacity-0 transition-opacity duration-200 group-hover:opacity-70"
      />
      {/* Top: project label + status badge */}
      <div className="mb-[10px] flex items-center justify-between gap-[8px]">
        <span className="truncate font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.7px] text-[#5a626c] group-hover:text-[#778] transition-colors">
          {projectName}
        </span>
        <span
          className="flex shrink-0 items-center gap-[5px] rounded-full px-[8px] py-[3px] font-['Inter'] text-[11px] font-medium"
          style={{
            backgroundColor: s.badgeBg,
            border: `1px solid ${s.badgeBorder}`,
            color: s.badgeText,
          }}
        >
          <span
            className={`size-[5px] shrink-0 rounded-full ${s.pulse ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: s.dot, boxShadow: s.dotGlow }}
          />
          {s.label}
        </span>
      </div>

      {/* Session name — or inline rename input */}
      {renaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-[6px] border border-[rgba(179,229,2,0.3)] bg-[#0a0a0f] px-[8px] py-[4px] font-['Inter'] text-[15px] font-semibold text-[#f0f0f0] outline-none"
        />
      ) : (
        <div className="flex items-center gap-[6px]">
          <p className="flex-1 truncate font-['Inter'] text-[15px] font-semibold leading-snug text-[#f0f0f0] group-hover:text-white transition-colors">
            {session.name}
          </p>
          {/* Pencil: always visible on mobile (touch), hover on desktop */}
          <button
            onClick={startRename}
            className="flex size-[22px] shrink-0 items-center justify-center rounded-[4px] text-[#5a626c] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.08)] hover:text-[#9aa3ad] transition-all"
            title="Renomear sessão"
          >
            <PencilIcon />
          </button>
        </div>
      )}

      {/* Bottom: time + open */}
      <div className="mt-[12px] flex items-center justify-between">
        <span className="font-['JetBrains_Mono'] text-[11px] text-[#5a626c]">
          {formatTime(session.createdAt)}
        </span>
        {!renaming && (
          <span className="flex h-[26px] items-center gap-[5px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[10px] font-['Inter'] text-[12px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all group-hover:border-[#b3e502]/30 group-hover:text-[#b3e502]">
            Open
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
              <path
                d="M1 10L10 1M10 1H3.5M10 1v6.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Skeleton card ── */

function SkeletonCard() {
  return (
    <div className="h-[116px] animate-pulse rounded-[14px] border border-white/[0.06] bg-white/[0.03]" />
  );
}

/* ── Mobile project pill ── */

function ProjectPill({
  label,
  count,
  hasActive,
  isSelected,
  onClick,
}: {
  label: string;
  count: number;
  hasActive: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-[5px] rounded-full px-[14px] py-[7px] font-['Inter'] text-[13px] font-medium transition-all duration-150 ${
        isSelected
          ? 'bg-[#b3e502] text-[#0a0a0f] shadow-[0_2px_8px_-2px_rgba(179,229,2,0.5)]'
          : 'border border-white/[0.07] bg-white/[0.03] text-[#9aa3ad] backdrop-blur-md hover:border-white/[0.14] hover:text-[#e6e8eb]'
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`rounded-full px-[5px] py-[0.5px] font-['JetBrains_Mono'] text-[10px] font-medium ${
            isSelected ? 'bg-black/20 text-[#0a0a0f]' : hasActive ? 'text-[#22dd88]' : 'text-[#fa0]'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ── Refresh icon ── */

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      fill="none"
      className={spinning ? 'animate-spin' : ''}
    >
      <path
        d="M10.5 6A4.5 4.5 0 1 1 6 1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6 1.5L8 3.5M6 1.5L8 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Plus icon ── */

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Empty state ── */

function EmptyState() {
  const navigate = useNavigate();
  return (
    <div className="kb-rise flex flex-col items-center justify-center py-[80px] text-center">
      <div className="mb-[16px] flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
          <rect
            x="1.5"
            y="2.5"
            width="13"
            height="9"
            rx="1.5"
            stroke="#b3e502"
            strokeWidth="1.25"
          />
          <path d="M5 13.5h6" stroke="#b3e502" strokeWidth="1.25" strokeLinecap="round" />
          <line x1="8" y1="11.5" x2="8" y2="13.5" stroke="#b3e502" strokeWidth="1.25" />
        </svg>
      </div>
      <h3 className="font-['Syne'] text-[20px] font-bold text-white mb-[6px]">
        Nothing running yet
      </h3>
      <p className="max-w-[260px] font-['Inter'] text-[13px] leading-relaxed text-[#5a626c]">
        Open a project and start a session. Run multiple sessions across projects to parallelize
        your work.
      </p>
      <button
        onClick={() => navigate('/projects')}
        className="kb-sheen relative mt-[22px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516]"
      >
        Go to Projects
      </button>
    </div>
  );
}

/* ── Main page ── */

export default function SessionsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);

  // Global session-events channel — replaces the old 15s HTTP poll.
  const { onSessionEvent } = useSessionEvents();

  /* ── Fetch ── */
  const fetchAll = useCallback(async (manual?: boolean) => {
    // Only show full loading skeleton on the first fetch; background polls
    // update data silently so the UI doesn't flash every 15 seconds.
    if (!initialLoadDone.current) setLoading(true);
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const projects = await apiFetch<ProjectBrief[]>('/api/projects');
      const safeProjects: ProjectBrief[] = Array.isArray(projects) ? projects : [];

      const results = await Promise.allSettled(
        safeProjects.flatMap((project) => {
          if (!isValidProjectId(project.id)) return [];
          return [
            (async () => {
              const sessions = await apiFetch<SessionItem[]>(
                `/api/projects/${project.id}/sessions`,
              );
              return {
                project: { id: project.id, name: project.name },
                sessions: Array.isArray(sessions)
                  ? sessions.sort((a, b) => b.createdAt - a.createdAt)
                  : [],
              };
            })(),
          ];
        }),
      );

      const loaded: SessionGroup[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') loaded.push(result.value);
      }
      setGroups(loaded);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to load sessions');
    } finally {
      initialLoadDone.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    // Push-based sync: re-fetch on any server-reported session change (<1s).
    const unsubscribe = onSessionEvent(() => fetchAll());
    // Fallback safety net (deprecated, kept for 1 release) — spec Risk #4.
    const handleChanged = () => fetchAll();
    window.addEventListener('sessions-changed', handleChanged);
    return () => {
      unsubscribe();
      window.removeEventListener('sessions-changed', handleChanged);
    };
  }, [fetchAll, onSessionEvent]);

  /* ── Create session ── */
  const handleCreate = useCallback(
    async (projectId: string) => {
      if (creating) return;
      setCreating(projectId);
      try {
        const dims = estimateDims();
        const session = await apiFetch<{ sessionId: string }>(
          `/api/projects/${projectId}/sessions`,
          {
            method: 'POST',
            body: JSON.stringify({ cols: dims.cols, rows: dims.rows }),
          },
        );
        window.dispatchEvent(new Event('sessions-changed'));
        const projectName = groups.find((g) => g.project.id === projectId)?.project.name ?? '';
        navigate(`/sessions/${projectId}/${session.sessionId}`, {
          state: { projectName },
        });
      } catch {
        // silently fail
      } finally {
        setCreating(null);
      }
    },
    [creating, navigate, groups],
  );

  /* ── Rename session ── */
  const handleRename = useCallback(async (sessionId: string, name: string) => {
    // Optimistic update
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        sessions: g.sessions.map((s) => (s.sessionId === sessionId ? { ...s, name } : s)),
      })),
    );
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
    } catch {
      // next poll will revert if needed
    }
  }, []);

  /* ── Derived data ── */

  const activeGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          sessions: g.sessions.filter((s) => !DEAD_STATUSES.has(s.status)),
        }))
        .filter((g) => g.sessions.length > 0),
    [groups],
  );

  const allActiveSessions = useMemo(
    () =>
      activeGroups.flatMap((g) =>
        g.sessions.map((s) => ({ ...s, projectId: g.project.id, projectName: g.project.name })),
      ),
    [activeGroups],
  );

  const filteredSessions = useMemo(() => {
    if (!selectedProject) return allActiveSessions;
    return allActiveSessions.filter((s) => s.projectId === selectedProject);
  }, [allActiveSessions, selectedProject]);

  const globalActive = useMemo(
    () => allActiveSessions.filter((s) => s.status === 'active').length,
    [allActiveSessions],
  );

  const globalWaiting = useMemo(
    () => allActiveSessions.filter((s) => s.status === 'waiting').length,
    [allActiveSessions],
  );

  const allProjects = useMemo(() => groups.map((g) => g.project), [groups]);

  const selectedProjectName = useMemo(
    () => (selectedProject ? allProjects.find((p) => p.id === selectedProject)?.name : undefined),
    [selectedProject, allProjects],
  );

  /* ── Render ── */

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f] lg:flex-row">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="kb-aurora"
          style={{
            top: '-180px',
            left: '-120px',
            width: 620,
            height: 620,
            opacity: 0.5,
            background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-220px',
            left: '38%',
            width: 680,
            height: 680,
            opacity: 0.4,
            animationDelay: '-7s',
            background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-160px',
            right: '-160px',
            width: 560,
            height: 560,
            opacity: 0.38,
            animationDelay: '-13s',
            background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)',
          }}
        />
        <div className="kb-grid" />
      </div>
      {/* ══════ Desktop left panel ══════ */}
      <aside className="relative z-10 hidden lg:flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0f]">
        {/* Panel header: global counts */}
        <div className="px-[16px] py-[18px] border-b border-white/[0.06]">
          <h2 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
            Projects
          </h2>
          <div className="mt-[10px] flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
            <span className="flex items-center gap-[5px] font-['Inter'] text-[12px] font-medium text-[#22dd88]">
              <span
                className="size-[6px] shrink-0 rounded-full bg-[#22dd88] animate-pulse"
                style={{ boxShadow: '0 0 5px rgba(34,221,136,0.5)' }}
              />
              {globalActive} active
            </span>
            {globalWaiting > 0 && (
              <span className="flex items-center gap-[5px] font-['Inter'] text-[12px] font-medium text-[#fa0]">
                <span className="size-[6px] shrink-0 rounded-full bg-[#fa0]" />
                {globalWaiting} waiting
              </span>
            )}
            {globalActive === 0 && globalWaiting === 0 && (
              <span className="font-['Inter'] text-[12px] text-[#5a626c]">none running</span>
            )}
          </div>
        </div>

        {/* "All Sessions" row */}
        <button
          onClick={() => setSelectedProject(null)}
          className={`flex items-center justify-between px-[14px] py-[10px] font-['Inter'] text-[13px] font-medium transition-colors ${
            selectedProject === null
              ? 'border-l-2 border-[#b3e502] bg-[rgba(179,229,2,0.07)] text-[#f0f0f0]'
              : 'text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.03)] hover:text-[#e6e8eb]'
          }`}
        >
          <span>All Sessions</span>
          <span
            className={`font-['JetBrains_Mono'] text-[11px] ${
              selectedProject === null ? 'text-[#b3e502]' : 'text-[#5a626c]'
            }`}
          >
            {allActiveSessions.length}
          </span>
        </button>

        {/* Project rows */}
        <div className="flex-1 overflow-y-auto py-[4px]">
          {loading ? (
            <div className="space-y-[4px] px-[10px] py-[8px]">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-[36px] animate-pulse rounded-[6px] bg-[rgba(255,255,255,0.04)]"
                />
              ))}
            </div>
          ) : (
            allProjects.map((project) => {
              const group = activeGroups.find((g) => g.project.id === project.id);
              const active = group ? group.sessions.filter((s) => s.status === 'active').length : 0;
              const waiting = group
                ? group.sessions.filter((s) => s.status === 'waiting').length
                : 0;
              const isSelected = selectedProject === project.id;

              return (
                <div key={project.id} className="flex items-stretch">
                  <button
                    onClick={() => setSelectedProject(isSelected ? null : project.id)}
                    className={`flex flex-1 items-center justify-between px-[14px] py-[9px] font-['Inter'] text-[13px] font-medium transition-colors ${
                      isSelected
                        ? 'border-l-2 border-[#b3e502] bg-[rgba(179,229,2,0.07)] text-[#f0f0f0]'
                        : 'text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.03)] hover:text-[#e6e8eb]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
                    <div className="ml-[8px] flex shrink-0 items-center gap-[5px]">
                      {active > 0 && (
                        <span className="flex items-center gap-[3px] font-['JetBrains_Mono'] text-[10px] text-[#22dd88]">
                          <span className="size-[4px] rounded-full bg-[#22dd88] animate-pulse" />
                          {active}
                        </span>
                      )}
                      {waiting > 0 && (
                        <span className="flex items-center gap-[3px] font-['JetBrains_Mono'] text-[10px] text-[#fa0]">
                          <span className="size-[4px] rounded-full bg-[#fa0]" />
                          {waiting}
                        </span>
                      )}
                      {active === 0 && waiting === 0 && (
                        <span className="font-['JetBrains_Mono'] text-[10px] text-[#334]">0</span>
                      )}
                    </div>
                  </button>
                  {/* New session button */}
                  <button
                    onClick={() => handleCreate(project.id)}
                    disabled={creating === project.id}
                    className="flex w-[32px] shrink-0 items-center justify-center text-[#5a626c] hover:bg-[rgba(179,229,2,0.08)] hover:text-[#b3e502] transition-all disabled:opacity-40"
                    title={`New session in ${project.name}`}
                  >
                    {creating === project.id ? (
                      <div className="size-[10px] animate-spin rounded-full border border-[#b3e502] border-t-transparent" />
                    ) : (
                      <PlusIcon />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ══════ Main content ══════ */}
      <div className="relative z-10 flex flex-1 min-w-0 flex-col">
        {/* Sticky header */}
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md px-[16px] py-[13px] sm:px-[24px]">
          <div className="flex items-center justify-between gap-[12px]">
            {/* Title + live counts */}
            <div className="flex items-center gap-[10px] min-w-0">
              <h1 className="shrink-0 font-['Syne'] text-[24px] font-extrabold tracking-[-0.5px] text-white sm:text-[26px]">
                {selectedProjectName ?? 'Sessions'}
              </h1>
              {!loading && (
                <div className="flex items-center gap-[6px]">
                  {globalActive > 0 && (
                    <span
                      className="flex items-center gap-[4px] rounded-full px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-[#22dd88]"
                      style={{
                        backgroundColor: 'rgba(34,221,136,0.08)',
                        border: '1px solid rgba(34,221,136,0.2)',
                      }}
                    >
                      <span className="size-[4px] rounded-full bg-[#22dd88] animate-pulse" />
                      {globalActive}
                    </span>
                  )}
                  {globalWaiting > 0 && (
                    <span
                      className="flex items-center gap-[4px] rounded-full px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-[#fa0]"
                      style={{
                        backgroundColor: 'rgba(255,170,0,0.08)',
                        border: '1px solid rgba(255,170,0,0.2)',
                      }}
                    >
                      <span className="size-[4px] rounded-full bg-[#fa0]" />
                      {globalWaiting}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-[6px] shrink-0">
              {/* Canvas — navigates in the same tab */}
              <button
                onClick={() => navigate('/canvas')}
                className="flex items-center gap-[5px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#9aa3ad] backdrop-blur-md hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb] transition-all"
                title="Abrir canvas"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect
                    x="0.6"
                    y="0.6"
                    width="4.2"
                    height="4.2"
                    rx="0.8"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <rect
                    x="7.2"
                    y="0.6"
                    width="4.2"
                    height="4.2"
                    rx="0.8"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <rect
                    x="0.6"
                    y="7.2"
                    width="4.2"
                    height="4.2"
                    rx="0.8"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <rect
                    x="7.2"
                    y="7.2"
                    width="4.2"
                    height="4.2"
                    rx="0.8"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
                Canvas
              </button>

              <button
                onClick={() => fetchAll(true)}
                disabled={refreshing}
                className="flex size-[32px] shrink-0 items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#9aa3ad] backdrop-blur-md hover:border-white/[0.14] hover:text-[#e6e8eb] transition-all disabled:opacity-40"
                aria-label="Refresh"
              >
                <RefreshIcon spinning={refreshing} />
              </button>
            </div>
          </div>

          {/* Mobile: horizontal project filter pills */}
          {!loading && groups.length > 0 && (
            <div
              className="mt-[12px] flex gap-[7px] overflow-x-auto pb-[2px] lg:hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              <ProjectPill
                label="All"
                count={allActiveSessions.length}
                hasActive={globalActive > 0}
                isSelected={selectedProject === null}
                onClick={() => setSelectedProject(null)}
              />
              {groups.map((g) => {
                const ag = activeGroups.find((a) => a.project.id === g.project.id);
                const count = ag ? ag.sessions.length : 0;
                const hasActive = ag ? ag.sessions.some((s) => s.status === 'active') : false;
                return (
                  <ProjectPill
                    key={g.project.id}
                    label={g.project.name}
                    count={count}
                    hasActive={hasActive}
                    isSelected={selectedProject === g.project.id}
                    onClick={() =>
                      setSelectedProject(selectedProject === g.project.id ? null : g.project.id)
                    }
                  />
                );
              })}
            </div>
          )}
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-[16px] pb-[32px] pt-[20px] sm:px-[24px] sm:pt-[22px]">
          {/* Error */}
          {error && (
            <div className="mb-[16px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[13px] text-red-400">
              {error}
              <button
                onClick={() => fetchAll(true)}
                className="ml-[8px] underline hover:text-red-300"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {/* Loaded */}
          {!loading && !error && (
            <>
              {allActiveSessions.length === 0 ? (
                <EmptyState />
              ) : filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-[64px] text-center">
                  <p className="font-['Inter'] text-[14px] text-[#9aa3ad]">
                    No active sessions in this project
                  </p>
                  <div className="mt-[14px] flex flex-wrap justify-center gap-[10px]">
                    {selectedProject && (
                      <button
                        onClick={() => handleCreate(selectedProject)}
                        disabled={!!creating}
                        className="rounded-[8px] bg-[#b3e502] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#c2f516] transition-colors disabled:opacity-50"
                      >
                        {creating ? 'Starting…' : '+ New Session'}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedProject(null)}
                      className="rounded-[8px] border border-white/[0.07] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] hover:border-white/[0.14] hover:text-[#e6e8eb] transition-colors"
                    >
                      Show all
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
                  {filteredSessions.map((s, i) => (
                    <SessionCard
                      key={s.sessionId}
                      index={i}
                      session={s}
                      projectName={s.projectName}
                      onClick={() =>
                        navigate(`/sessions/${s.projectId}/${s.sessionId}`, {
                          state: { sessionName: s.name, projectName: s.projectName },
                        })
                      }
                      onRename={handleRename}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile FAB: new session when a project is selected */}
        {!loading && selectedProject && (
          <div className="sticky bottom-[20px] flex justify-end px-[20px] lg:hidden">
            <button
              onClick={() => handleCreate(selectedProject)}
              disabled={!!creating}
              className="flex items-center gap-[8px] rounded-full bg-[#b3e502] px-[18px] py-[12px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] hover:bg-[#c2f516] active:scale-[0.97] transition-all disabled:opacity-50"
            >
              {creating ? (
                <div className="size-[14px] animate-spin rounded-full border-2 border-[#0a0a0f] border-t-transparent" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M5 1.5v7M1.5 5h7"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              {creating ? 'Starting…' : 'New Session'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
