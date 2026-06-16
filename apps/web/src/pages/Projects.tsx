import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import { DirectoryPicker } from '../components/DirectoryPicker';

/* ── Types ── */

interface Project {
  id: string;
  name: string;
  directory: string;
  description: string | null;
  harnessId: string | null;
  githubRepo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Harness {
  id: string;
  name: string;
  description: string;
}

type SortMode = 'newest' | 'alpha';

/* ── Helpers ── */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ── Icons ── */

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8.5 8.5L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M7 1.3v1.3M7 11.4v1.3M1.3 7h1.3M11.4 7h1.3M2.96 2.96l.92.92M10.12 10.12l.92.92M2.96 11.04l.92-.92M10.12 3.88l.92-.92"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Modal wrapper ── */

function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[400px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Delete dialog ── */

function DeleteDialog({
  open,
  projectName,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-[380px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Syne'] text-[18px] font-bold text-white">
          Delete {projectName}?
        </h3>
        <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#9aa3ad]">
          This will terminate all active sessions.
        </p>
        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex h-[34px] items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[16px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[9px] bg-red-600 px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Project form ── */

interface ProjectFormData {
  name: string;
  directory: string;
  description: string;
  harnessId: string | null;
}

function ProjectFormModal({
  open,
  title,
  initial,
  harnesses,
  harnessesLoading,
  onClose,
  onSubmit,
  error,
  loading,
}: {
  open: boolean;
  title: string;
  initial: ProjectFormData;
  harnesses: Harness[];
  harnessesLoading: boolean;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => void;
  error: string | null;
  loading: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [directory, setDirectory] = useState(initial.directory);
  const [description, setDescription] = useState(initial.description);
  const [harnessId, setHarnessId] = useState<string | null>(initial.harnessId);
  const [nameError, setNameError] = useState('');
  const [dirError, setDirError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setDirectory(initial.directory);
      setDescription(initial.description);
      setHarnessId(initial.harnessId);
      setNameError('');
      setDirError('');
    }
  }, [open, initial]);

  const handleSubmit = () => {
    let valid = true;
    if (!name.trim()) {
      setNameError('Name is required');
      valid = false;
    } else {
      setNameError('');
    }
    if (!directory.trim()) {
      setDirError('Directory is required');
      valid = false;
    } else {
      setDirError('');
    }
    if (!valid) return;
    onSubmit({ name: name.trim(), directory: directory.trim(), description: description.trim(), harnessId });
  };

  if (!open) return null;

  const labelClass =
    "mb-[5px] block font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]";
  const inputClass =
    "w-full rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none backdrop-blur-md transition-colors focus:border-[#b3e502]/40 focus:bg-white/[0.05]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[420px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Syne'] text-[18px] font-bold text-white">{title}</h3>

        <div className="mt-[18px] space-y-[14px]">
          <div>
            <label htmlFor="project-name" className={labelClass}>
              Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(''); }}
              className={inputClass}
              placeholder="my-project"
            />
            {nameError && (
              <p className="mt-[4px] font-['Inter'] text-[12px] text-red-400">{nameError}</p>
            )}
          </div>

          <div>
            <label htmlFor="project-directory" className={labelClass}>
              Directory
            </label>
            <DirectoryPicker
              value={directory}
              onChange={(path) => { setDirectory(path); setDirError(''); }}
              error={dirError}
              disabled={loading}
              placeholder="/home/user/projects/my-project"
            />
          </div>

          <div>
            <label htmlFor="project-description" className={labelClass}>
              Description{' '}
              <span className="font-normal normal-case text-[#5a626c]">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
              placeholder="Optional description"
            />
          </div>

          <div>
            <label htmlFor="project-harness" className={labelClass}>
              Template{' '}
              <span className="font-normal normal-case text-[#5a626c]">(optional)</span>
            </label>
            {harnessesLoading ? (
              <div className="h-[38px] rounded-[8px] border border-white/[0.07] bg-[#0a0a0f] flex items-center px-[12px]">
                <span className="font-['Inter'] text-[13px] text-[#5a626c]">Loading templates…</span>
              </div>
            ) : (
              <select
                id="project-harness"
                value={harnessId || ''}
                onChange={(e) => setHarnessId(e.target.value || null)}
                className={`${inputClass} appearance-none`}
              >
                <option value="">None — empty project</option>
                {harnesses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.description ? ` — ${h.description}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-[14px] rounded-[8px] border border-red-500/30 bg-red-500/10 px-[12px] py-[8px] font-['Inter'] text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex h-[34px] items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[16px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="kb-sheen relative flex h-[34px] items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[16px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)] disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Live sessions indicator ── */

function LiveBadge({ live }: { live: number }) {
  if (live > 0) {
    return (
      <div className="flex items-center gap-[8px] rounded-[12px] border border-[#b3e502]/25 bg-[rgba(179,229,2,0.08)] px-[14px] py-[11px]">
        <span className="relative flex size-[6px] shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b3e502] opacity-60" />
          <span className="relative inline-flex size-[6px] rounded-full bg-[#b3e502]" />
        </span>
        <span className="font-['Inter'] text-[13px] font-semibold text-[#b3e502]">
          {live} active session{live !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[8px] rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-[14px] py-[11px]">
      <span className="size-[6px] shrink-0 rounded-full bg-[#5a626c]" />
      <span className="font-['Inter'] text-[13px] font-medium text-[#5a626c]">No active sessions</span>
    </div>
  );
}

/* ── Small icons ── */

function GitHubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 3.5h9M5.5 3.5V2.6a.6.6 0 0 1 .6-.6h1.8a.6.6 0 0 1 .6.6v.9M3.7 3.5l.5 7.4a.8.8 0 0 0 .8.7h4a.8.8 0 0 0 .8-.7l.5-7.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Project card ── */

function ProjectCard({
  project,
  stats,
  onOpen,
  onEdit,
  onDelete,
  onSync,
  syncing,
  index = 0,
}: {
  project: Project;
  stats: { active: number; waiting: number; finished: number };
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync?: (id: string) => void;
  syncing?: boolean;
  index?: number;
}) {
  // Any non-finished session counts as "live" — waiting status is never
  // persisted to session metadata, so active already captures every live one.
  const live = stats.active + stats.waiting;
  const repoShort = project.githubRepo?.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');

  return (
    <article
      style={{
        animationDelay: `${Math.min(index, 8) * 45}ms`,
        borderColor: live > 0 ? 'rgba(179,229,2,0.2)' : 'rgba(255,255,255,0.06)',
      }}
      className="kb-rise group relative isolate flex flex-col gap-[14px] overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[18px] backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-[2px] hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)] focus-within:border-[#b3e502]/30"
    >
      {/* Live accent edge — fades in on hover, solid when live */}
      <span
        aria-hidden
        className={`absolute inset-y-[14px] left-0 w-[2px] rounded-r-full bg-[#b3e502] transition-opacity duration-200 ${
          live > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
        }`}
        style={live > 0 ? { boxShadow: '0 0 8px rgba(179,229,2,0.4)' } : undefined}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-[12px]">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left outline-none">
          <h3 className="truncate font-['Inter'] text-[15px] font-semibold tracking-[-0.15px] text-[#f0f0f0] transition-colors group-hover:text-white">
            {project.name}
          </h3>
          <p className="mt-[3px] flex items-center gap-[5px] font-['JetBrains_Mono'] text-[11px] text-[#5a626c]">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="shrink-0">
              <path d="M1.5 4.2c0-.6.4-1 1-1h2.2l1 1.3h4.8c.6 0 1 .4 1 1v4.3c0 .6-.4 1-1 1H2.5c-.6 0-1-.4-1-1V4.2Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{project.directory}</span>
          </p>
        </button>
        <button
          onClick={onEdit}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#9aa3ad]"
          aria-label={`Edit ${project.name}`}
        >
          <GearIcon />
        </button>
      </div>

      {/* Description */}
      {project.description && (
        <p className="line-clamp-2 font-['Inter'] text-[12.5px] leading-[1.5] text-[#7a828c]">
          {project.description}
        </p>
      )}

      {/* Live sessions */}
      <LiveBadge live={live} />

      {/* Footer */}
      <div className="flex items-center justify-between gap-[8px] pt-[2px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          {repoShort && (
            <span
              className="inline-flex max-w-[150px] items-center gap-[4px] rounded-[6px] border border-white/[0.06] bg-white/[0.02] px-[7px] py-[3px] font-['Inter'] text-[11px] font-medium text-[#7a828c]"
              title={project.githubRepo ?? undefined}
            >
              <span className="shrink-0 text-[#58a6ff]"><GitHubIcon /></span>
              <span className="truncate">{repoShort}</span>
            </span>
          )}
          <span className="shrink-0 font-['JetBrains_Mono'] text-[11px] text-[#5a626c]">
            {relativeTime(project.updatedAt)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-[6px]">
          {project.githubRepo && onSync && (
            <button
              onClick={() => onSync(project.id)}
              disabled={syncing}
              className="flex size-[30px] items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#b3e502] disabled:opacity-50"
              title={`Sync from ${project.githubRepo}`}
              aria-label="Sync from GitHub"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className={syncing ? 'animate-spin' : ''}>
                <path d="M12 7a5 5 0 1 1-1.46-3.54M12 2v2.5H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex size-[30px] items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
            aria-label={`Delete ${project.name}`}
          >
            <TrashIcon />
          </button>
          <button
            onClick={onOpen}
            className="kb-sheen relative flex h-[30px] items-center gap-[5px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[14px] font-['Inter'] text-[12.5px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-6px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_20px_-6px_rgba(179,229,2,0.65)]"
          >
            Open
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
              <path d="M1 10L10 1M10 1H3.5M10 1v6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}

/* ── Skeleton card ── */

function SkeletonCard() {
  return (
    <article className="flex flex-col gap-[16px] rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[20px] animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-[5px]">
          <div className="h-[17px] w-[140px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[13px] w-[220px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="size-[30px] rounded-[6px] bg-[rgba(255,255,255,0.06)]" />
      </div>
      <div className="h-[58px] rounded-[10px] bg-[rgba(255,255,255,0.04)]" />
      <div className="flex items-center justify-between">
        <div className="h-[14px] w-[110px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
        <div className="h-[28px] w-[72px] rounded-[6px] bg-[rgba(255,255,255,0.06)]" />
      </div>
    </article>
  );
}

/* ── Top stats strip ── */

function StatsStrip({
  projects,
  activeSessions,
  liveProjects,
}: {
  projects: number;
  activeSessions: number;
  liveProjects: number;
}) {
  return (
    <div className="mb-[28px] grid grid-cols-3 gap-[10px]">
      {[
        { label: 'Projects', value: projects, dot: null as string | null, glow: undefined as string | undefined, pulse: false },
        { label: 'Active Sessions', value: activeSessions, dot: '#b3e502', glow: 'rgba(179,229,2,0.5)', pulse: true },
        { label: 'Live Projects', value: liveProjects, dot: activeSessions > 0 ? '#b3e502' : null, glow: 'rgba(179,229,2,0.4)', pulse: false },
      ].map(({ label, value, dot, glow, pulse }, i) => (
        <div
          key={label}
          style={{ animationDelay: `${i * 45}ms` }}
          className="kb-rise flex flex-col gap-[8px] rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-[18px] py-[16px] backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center gap-[6px]">
            {dot && (
              <span
                className={`size-[6px] shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: dot, boxShadow: glow ? `0 0 6px ${glow}` : undefined }}
              />
            )}
            <span className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
              {label}
            </span>
          </div>
          <span className="font-['Inter'] text-[28px] font-bold leading-none tracking-[-0.8px] text-[#f0f0f0]">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Main page ── */

export default function ProjectsPage() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<
    Record<string, { active: number; waiting: number; finished: number }>
  >({});

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [showSearch, setShowSearch] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [syncingProject, setSyncingProject] = useState<string | null>(null);

  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [harnessesLoading, setHarnessesLoading] = useState(false);

  /* ── Fetch harnesses ── */
  const fetchHarnesses = useCallback(async () => {
    setHarnessesLoading(true);
    try {
      const data = await apiFetch<Harness[]>('/api/harnesses');
      setHarnesses(data);
    } catch {
      setHarnesses([]);
    } finally {
      setHarnessesLoading(false);
    }
  }, []);

  const handleOpenCreate = useCallback(() => {
    setFormError(null);
    setCreateOpen(true);
    if (harnesses.length === 0 && !harnessesLoading) fetchHarnesses();
  }, [harnesses.length, harnessesLoading, fetchHarnesses]);

  /* ── Fetch projects ── */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Project[]>('/api/projects');
      setProjects(data);
      try {
        const stats = await apiFetch<
          Record<string, { active: number; waiting: number; finished: number }>
        >('/api/projects/stats');
        setProjectStats(stats);
      } catch {
        setProjectStats({});
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  /* ── Silent stats poll ── keeps live-session counts fresh without
     flashing skeletons. Also refreshes when the tab regains focus
     (e.g. coming back from a project where a session was spawned). */
  useEffect(() => {
    let cancelled = false;
    const refreshStats = async () => {
      try {
        const stats = await apiFetch<
          Record<string, { active: number; waiting: number; finished: number }>
        >('/api/projects/stats');
        if (!cancelled) setProjectStats(stats);
      } catch {
        /* non-fatal — keep last known counts */
      }
    };
    const interval = setInterval(refreshStats, 10_000);
    const onFocus = () => refreshStats();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  /* ── Filtered & sorted ── */
  const filtered = useMemo(() => {
    let list = Array.isArray(projects) ? [...projects] : [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (sort === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [projects, search, sort]);

  /* ── CRUD handlers ── */
  const handleCreate = async (data: ProjectFormData) => {
    setFormError(null);
    setFormLoading(true);
    try {
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          directory: data.directory,
          description: data.description || undefined,
          harnessId: data.harnessId || undefined,
        }),
      });
      setCreateOpen(false);
      await fetchProjects();
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || 'Failed to create project');
    } finally {
      setFormLoading(false);
    }
  };

  const handleEdit = async (data: ProjectFormData) => {
    if (!editTarget) return;
    setFormError(null);
    setFormLoading(true);
    try {
      await apiFetch(`/api/projects/${editTarget.id}`, { method: 'PUT', body: JSON.stringify(data) });
      setEditTarget(null);
      await fetchProjects();
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || 'Failed to update project');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/api/projects/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await fetchProjects();
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || 'Failed to delete project');
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSync = useCallback(
    async (projectId: string) => {
      if (syncingProject) return;
      setSyncingProject(projectId);
      try {
        await apiFetch(`/api/projects/${projectId}/github/sync`, { method: 'POST' });
      } catch {
        // non-fatal
      } finally {
        setSyncingProject(null);
      }
    },
    [syncingProject],
  );

  /* ── Global stats — only live sessions are meaningful here ── */
  const totalActiveSessions = Object.values(projectStats).reduce((s, p) => s + p.active + p.waiting, 0);
  const liveProjects = Object.values(projectStats).filter((p) => p.active + p.waiting > 0).length;

  /* ── Render ── */

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="kb-aurora" style={{ top: '-180px', left: '-120px', width: 620, height: 620, opacity: 0.5, background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)' }} />
        <div className="kb-aurora" style={{ top: '-220px', left: '38%', width: 680, height: 680, opacity: 0.4, animationDelay: '-7s', background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)' }} />
        <div className="kb-aurora" style={{ top: '-160px', right: '-160px', width: 560, height: 560, opacity: 0.38, animationDelay: '-13s', background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)' }} />
        <div className="kb-grid" />
      </div>
      {/* Header */}
      <header className="relative z-10 sticky top-0 shrink-0 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md">
        <div className="flex items-center justify-between gap-[10px] pl-[52px] pr-[20px] py-[14px] sm:px-[28px] lg:px-[28px]">
          <h1 className="font-['Syne'] text-[24px] font-extrabold tracking-[-0.5px] text-white sm:text-[26px]">
            Projects
          </h1>

          <div className="flex items-center gap-[8px]">
            {/* Search toggle (mobile) / always visible (sm+) */}
            <div className={`relative ${showSearch || search ? 'flex' : 'hidden sm:flex'}`}>
              <div className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#5a626c]">
                <SearchIcon />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                autoFocus={showSearch}
                onBlur={() => { if (!search) setShowSearch(false); }}
                className="h-[36px] w-[160px] sm:w-[200px] rounded-[10px] border border-white/[0.07] bg-white/[0.03] pl-[30px] pr-[10px] font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none backdrop-blur-md transition-colors focus:border-[#b3e502]/40 focus:bg-white/[0.05]"
              />
            </div>

            {/* Mobile search icon */}
            {!showSearch && !search && (
              <button
                onClick={() => setShowSearch(true)}
                className="flex size-[32px] items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#9aa3ad] sm:hidden"
                aria-label="Search"
              >
                <SearchIcon />
              </button>
            )}

            <button
              onClick={handleOpenCreate}
              className="kb-sheen relative flex h-[34px] shrink-0 items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[14px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)]"
            >
              <PlusIcon />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[22px] sm:px-[28px] sm:pt-[28px]">
        {/* Error */}
        {error && (
          <div className="mb-[20px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[13px] text-red-400">
            {error}
            <button onClick={fetchProjects} className="ml-[8px] underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {/* Stats strip */}
        {!loading && !error && (
          <StatsStrip
            projects={projects.length}
            activeSessions={totalActiveSessions}
            liveProjects={liveProjects}
          />
        )}

        {/* Section toolbar */}
        {!loading && !error && (
          <div className="mb-[18px] flex items-center justify-between">
            <div className="flex items-center gap-[8px]">
              <h2 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.9px] text-[#5a626c]">
                All Projects
              </h2>
              <span className="font-['JetBrains_Mono'] text-[11px] text-[#5a626c]">
                {filtered.length}
              </span>
            </div>
            <button
              onClick={() => setSort(sort === 'newest' ? 'alpha' : 'newest')}
              className="flex items-center gap-[4px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#9aa3ad] backdrop-blur-md hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb] transition-all"
            >
              {sort === 'newest' ? 'Newest' : 'A–Z'}
              <ChevronIcon />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && (
          <div className="kb-rise flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#b3e502" strokeWidth="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#b3e502" strokeWidth="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#b3e502" strokeWidth="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#b3e502" strokeWidth="1.5" />
              </svg>
            </div>
            <h3 className="font-['Syne'] text-[20px] font-bold text-white mb-[6px]">
              No projects yet
            </h3>
            <p className="max-w-[300px] font-['Inter'] text-[13px] leading-relaxed text-[#5a626c]">
              Create your first project to start managing opencode sessions.
            </p>
            <button
              onClick={handleOpenCreate}
              className="kb-sheen relative mt-[22px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516]"
            >
              Create your first project
            </button>
          </div>
        )}

        {/* No search results */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[64px] text-center">
            <p className="font-['Inter'] text-[15px] text-[#5a626c]">
              No projects match &ldquo;{search}&rdquo;
            </p>
            <button
              onClick={() => setSearch('')}
              className="mt-[10px] font-['Inter'] text-[13px] font-semibold text-[#b3e502] hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Project grid */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project, i) => (
              <ProjectCard
                key={project.id}
                index={i}
                project={project}
                stats={projectStats[project.id] || { active: 0, waiting: 0, finished: 0 }}
                onOpen={() => navigate(`/projects/${project.id}`)}
                onEdit={() => { setFormError(null); setEditTarget(project); }}
                onDelete={() => setDeleteTarget(project)}
                onSync={handleSync}
                syncing={syncingProject === project.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <ProjectFormModal
        open={createOpen}
        title="New Project"
        initial={{ name: '', directory: '', description: '', harnessId: null }}
        harnesses={harnesses}
        harnessesLoading={harnessesLoading}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        error={formError}
        loading={formLoading}
      />

      <ProjectFormModal
        open={editTarget !== null}
        title="Edit Project"
        initial={{
          name: editTarget?.name || '',
          directory: editTarget?.directory || '',
          description: editTarget?.description || '',
          harnessId: null,
        }}
        harnesses={harnesses}
        harnessesLoading={harnessesLoading}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
        error={formError}
        loading={formLoading}
      />

      <DeleteDialog
        open={deleteTarget !== null}
        projectName={deleteTarget?.name || ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
