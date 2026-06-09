import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';

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

type FilterMode = 'all' | 'active' | 'waiting';

interface FilterTab {
  mode: FilterMode;
  label: string;
  matches: (s: SessionItem) => boolean;
}

const FILTER_TABS: FilterTab[] = [
  { mode: 'all', label: 'All', matches: (s) => !DEAD_STATUSES.has(s.status) },
  { mode: 'active', label: 'Active', matches: (s) => s.status === 'active' },
  { mode: 'waiting', label: 'Waiting', matches: (s) => s.status === 'waiting' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#af0', text: '#0a0a0f', label: 'Active' },
  waiting: { bg: '#fa0', text: '#0a0a0f', label: 'Waiting' },
  exited: { bg: '#556', text: '#f0f0f0', label: 'Exited' },
  killed: { bg: '#556', text: '#f0f0f0', label: 'Killed' },
};

/* ── Helpers ── */

/**
 * Validate that a project id is usable for API calls. Skips falsy,
 * non-string, empty-string, and the literal strings "undefined"/"null"
 * that can leak from JSON serialization bugs or corrupted responses.
 */
function isValidProjectId(id: unknown): id is string {
  if (!id || typeof id !== 'string' || id === 'undefined' || id === 'null') {
    return false;
  }
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

/* ── Page ── */

export default function SessionsPage() {
  const navigate = useNavigate();

  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projects = await apiFetch<ProjectBrief[]>('/api/projects');
      const safeProjects: ProjectBrief[] = Array.isArray(projects) ? projects : [];

      const results = await Promise.allSettled(
        safeProjects.flatMap((project) => {
          if (!isValidProjectId(project.id)) {
            console.warn('[SessionsPage] skipping project with invalid id:', project);
            return [];
          }
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
        if (result.status === 'fulfilled') {
          loaded.push(result.value);
        }
      }
      setGroups(loaded);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();

    // Poll every 15 s to pick up status changes (sessions exiting, etc.).
    const interval = setInterval(fetchAll, 15_000);

    // Refresh immediately when ProjectDetail creates/closes a session.
    const handleChanged = () => {
      fetchAll();
    };
    window.addEventListener('sessions-changed', handleChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('sessions-changed', handleChanged);
    };
  }, [fetchAll]);

  const allSessions = useMemo(
    () =>
      groups.flatMap((g) =>
        g.sessions
          .filter((s) => !DEAD_STATUSES.has(s.status))
          .map((s) => ({ ...s, projectName: g.project.name })),
      ),
    [groups],
  );

  const filteredSessions = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.mode === filter) || FILTER_TABS[0];
    return allSessions.filter(tab.matches);
  }, [allSessions, filter]);

  const counts = useMemo(() => {
    const c: Record<FilterMode, number> = { all: 0, active: 0, waiting: 0 };
    for (const s of allSessions) {
      if (!DEAD_STATUSES.has(s.status)) {
        c.all++;
        if (s.status === 'active') c.active++;
        if (s.status === 'waiting') c.waiting++;
      }
    }
    return c;
  }, [allSessions]);

  const matchingTab = FILTER_TABS.find((t) => t.mode === filter) || FILTER_TABS[0];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* ══════ Header ══════ */}
      <header className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-[24px] pb-[19px] pt-[18px] sm:px-[32px]">
        <h1 className="font-['Inter'] text-[18px] font-semibold tracking-[-0.18px] text-[#f0f0f0]">
          Sessions
        </h1>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-[6px] rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[12px] py-[6px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Refresh sessions"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={loading ? 'animate-spin' : ''}
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
          Refresh
        </button>
      </header>

      {/* ══════ Content ══════ */}
      <div className="px-[16px] pb-[40px] pt-[20px] sm:px-[32px] sm:pt-[28px]">
        {/* ── Error ── */}
        {error && (
          <div className="mb-[20px] rounded-[8px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[14px] text-red-400">
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-[80px]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#af0] border-t-transparent" />
          </div>
        )}

        {/* ── Loaded content ── */}
        {!loading && !error && (
          <>
            {/* Filter bar */}
            <div className="mb-[22px] inline-flex items-center gap-[4px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[4px] overflow-x-auto max-w-full">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.mode}
                  onClick={() => setFilter(tab.mode)}
                  className={`flex shrink-0 items-center gap-[6px] rounded-[6px] px-[14px] py-[7px] font-['Inter'] text-[13px] font-medium transition-colors ${
                    filter === tab.mode
                      ? 'bg-[#af0] text-[#0a0a0f]'
                      : 'text-[#889] hover:text-[#ccd]'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`font-['JetBrains_Mono'] text-[11px] ${
                      filter === tab.mode ? 'text-[#0a0a0f]/60' : 'text-[#445]'
                    }`}
                  >
                    {counts[tab.mode]}
                  </span>
                </button>
              ))}
            </div>

            {/* No sessions at all */}
            {allSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-[80px] text-center">
                <div className="mb-[16px] flex size-[56px] items-center justify-center rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118]">
                  <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
                    <rect
                      x="1.5"
                      y="2.5"
                      width="13"
                      height="9"
                      rx="1.5"
                      stroke="#445"
                      strokeWidth="1.25"
                    />
                    <path d="M5 13.5h6" stroke="#445" strokeWidth="1.25" strokeLinecap="round" />
                    <line x1="8" y1="11.5" x2="8" y2="13.5" stroke="#445" strokeWidth="1.25" />
                  </svg>
                </div>
                <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
                  No sessions yet
                </h3>
                <p className="mt-[6px] max-w-[300px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
                  Start a session from a project to see it here.
                </p>
              </div>
            ) : /* No results for current filter */
            filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-[64px] text-center">
                <p className="font-['Inter'] text-[15px] text-[#889]">
                  No {matchingTab.label.toLowerCase()} sessions
                </p>
              </div>
            ) : (
              /* Session list grouped by project */
              <div className="space-y-[20px]">
                {groups
                  .filter((g) => g.sessions.some(matchingTab.matches))
                  .map((group) => {
                    const visible = group.sessions.filter(matchingTab.matches);
                    return (
                      <section key={group.project.id}>
                        {/* Project group header */}
                        <div className="mb-[10px] flex items-center gap-[8px]">
                          <h2 className="font-['Inter'] text-[12px] font-semibold uppercase tracking-[0.96px] text-[#445]">
                            {group.project.name}
                          </h2>
                          <span className="font-['JetBrains_Mono'] text-[11px] font-normal text-[#445]">
                            {visible.length} session{visible.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Session rows */}
                        <div className="rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] overflow-hidden">
                          {visible.map((session, idx) => {
                            const info = STATUS_COLORS[session.status] || {
                              bg: '#556',
                              text: '#f0f0f0',
                              label: session.status,
                            };
                            return (
                              <div
                                key={session.sessionId}
                                onClick={() =>
                                  navigate(
                                    `/projects/${session.projectId}?session=${session.sessionId}`,
                                  )
                                }
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    navigate(
                                      `/projects/${session.projectId}?session=${session.sessionId}`,
                                    );
                                  }
                                }}
                                className={`flex items-center gap-[12px] px-[16px] py-[12px] cursor-pointer hover:bg-[rgba(255,255,255,0.03)] transition-colors ${
                                  idx < visible.length - 1
                                    ? 'border-b border-[rgba(255,255,255,0.05)]'
                                    : ''
                                }`}
                              >
                                {/* Status dot */}
                                <span
                                  className="size-[7px] shrink-0 rounded-[3.5px]"
                                  style={{ backgroundColor: info.bg }}
                                />

                                {/* Session name */}
                                <span className="min-w-0 flex-1 truncate font-['Inter'] text-[14px] font-medium text-[#f0f0f0]">
                                  {session.name}
                                </span>

                                {/* Status badge */}
                                <span
                                  className="shrink-0 rounded-[4px] px-[8px] py-[3px] font-['Inter'] text-[11px] font-medium"
                                  style={{
                                    backgroundColor: info.bg,
                                    color: info.text,
                                  }}
                                >
                                  {info.label}
                                </span>

                                {/* Relative time (hidden on mobile) */}
                                <span className="shrink-0 font-['JetBrains_Mono'] text-[11px] text-[#445] hidden sm:inline">
                                  {formatTime(session.createdAt)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
