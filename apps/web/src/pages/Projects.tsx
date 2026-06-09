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
        className="mx-4 w-full max-w-[400px] rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
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
        className="mx-4 w-full max-w-[380px] rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
          Delete {projectName}?
        </h3>
        <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
          This will terminate all active sessions.
        </p>
        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-[8px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[8px] bg-red-600 px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
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
    "mb-[5px] block font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#445]";
  const inputClass =
    "w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.18)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[420px] rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">{title}</h3>

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
              <span className="font-normal normal-case text-[#556]">(optional)</span>
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
              <span className="font-normal normal-case text-[#556]">(optional)</span>
            </label>
            {harnessesLoading ? (
              <div className="h-[38px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] flex items-center px-[12px]">
                <span className="font-['Inter'] text-[13px] text-[#445]">Loading templates…</span>
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
            className="rounded-[8px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-[8px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Session status dot cluster ── */

function StatusCluster({
  active,
  waiting,
  finished,
}: {
  active: number;
  waiting: number;
  finished: number;
}) {
  return (
    <div className="flex items-center gap-[16px]">
      <div className="flex flex-col items-start gap-[2px]">
        <div className="flex items-center gap-[5px]">
          <span
            className="size-[7px] shrink-0 rounded-full bg-[#22dd88] animate-pulse"
            style={{ boxShadow: active > 0 ? '0 0 6px rgba(34,221,136,0.5)' : 'none', opacity: active > 0 ? 1 : 0.3 }}
          />
          <span
            className="font-['Inter'] text-[14px] font-bold leading-none"
            style={{ color: active > 0 ? '#22dd88' : '#445' }}
          >
            {active}
          </span>
        </div>
        <span className="font-['Inter'] text-[10.5px] font-medium uppercase tracking-[0.4px] text-[#445]">
          Active
        </span>
      </div>

      <div className="h-[28px] w-px shrink-0 bg-[rgba(255,255,255,0.06)]" />

      <div className="flex flex-col items-start gap-[2px]">
        <div className="flex items-center gap-[5px]">
          <span
            className="size-[7px] shrink-0 rounded-full bg-[#ffaa00]"
            style={{ opacity: waiting > 0 ? 1 : 0.3 }}
          />
          <span
            className="font-['Inter'] text-[14px] font-bold leading-none"
            style={{ color: waiting > 0 ? '#ffaa00' : '#445' }}
          >
            {waiting}
          </span>
        </div>
        <span className="font-['Inter'] text-[10.5px] font-medium uppercase tracking-[0.4px] text-[#445]">
          Waiting
        </span>
      </div>

      <div className="h-[28px] w-px shrink-0 bg-[rgba(255,255,255,0.06)]" />

      <div className="flex flex-col items-start gap-[2px]">
        <div className="flex items-center gap-[5px]">
          <span className="size-[7px] shrink-0 rounded-full bg-[#445]" style={{ opacity: 0.5 }} />
          <span className="font-['Inter'] text-[14px] font-bold leading-none text-[#445]">
            {finished}
          </span>
        </div>
        <span className="font-['Inter'] text-[10.5px] font-medium uppercase tracking-[0.4px] text-[#445]">
          Done
        </span>
      </div>
    </div>
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
}: {
  project: Project;
  stats: { active: number; waiting: number; finished: number };
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync?: (id: string) => void;
  syncing?: boolean;
}) {
  const hasLive = stats.active > 0 || stats.waiting > 0;

  return (
    <article
      className="group relative flex flex-col gap-[16px] rounded-[14px] border bg-[#111118] p-[20px] transition-all duration-150 hover:bg-[rgba(255,255,255,0.02)]"
      style={{
        borderColor: stats.active > 0
          ? 'rgba(34,221,136,0.2)'
          : stats.waiting > 0
            ? 'rgba(255,170,0,0.15)'
            : 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Live indicator accent */}
      {hasLive && (
        <span
          className="absolute left-0 top-[14px] h-[28px] w-[3px] rounded-r-full"
          style={{
            backgroundColor: stats.active > 0 ? '#22dd88' : '#ffaa00',
            boxShadow: stats.active > 0
              ? '0 0 8px rgba(34,221,136,0.4)'
              : '0 0 8px rgba(255,170,0,0.3)',
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-[12px]">
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="truncate font-['Inter'] text-[15px] font-semibold tracking-[-0.15px] text-[#f0f0f0] group-hover:text-white transition-colors">
            {project.name}
          </h3>
          <p className="mt-[2px] truncate font-['JetBrains_Mono'] text-[11px] text-[#445]">
            {project.directory}
          </p>
          {project.description && (
            <p className="mt-[4px] line-clamp-1 font-['Inter'] text-[12px] text-[#667]">
              {project.description}
            </p>
          )}
        </button>
        <button
          onClick={onEdit}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-[6px] border border-[rgba(255,255,255,0.08)] text-[#556] hover:border-[rgba(255,255,255,0.18)] hover:text-[#889] transition-colors"
          aria-label={`Edit ${project.name}`}
        >
          <GearIcon />
        </button>
      </div>

      {/* Session status */}
      <div className="rounded-[10px] border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f] px-[16px] py-[12px]">
        <StatusCluster
          active={stats.active}
          waiting={stats.waiting}
          finished={stats.finished}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="font-['JetBrains_Mono'] text-[11px] text-[#445]">
          {relativeTime(project.updatedAt)}
        </span>
        <div className="flex items-center gap-[8px]">
          {project.githubRepo && onSync && (
            <button
              onClick={() => onSync(project.id)}
              disabled={syncing}
              className="font-['Inter'] text-[12px] font-medium text-[#556] hover:text-[#af0] transition-colors disabled:opacity-50"
              title={`Sync from ${project.githubRepo}`}
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <button
            onClick={onDelete}
            className="font-['Inter'] text-[12px] font-medium text-[#445] hover:text-red-400 transition-colors"
            aria-label={`Delete ${project.name}`}
          >
            Delete
          </button>
          <button
            onClick={onOpen}
            className="flex h-[28px] items-center gap-[5px] rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[12px] font-['Inter'] text-[12.5px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#f0f0f0] transition-colors"
          >
            Open
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
              <path
                d="M1 10L10 1M10 1H3.5M10 1v6.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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
    <article className="flex flex-col gap-[16px] rounded-[14px] border border-[rgba(255,255,255,0.07)] bg-[#111118] p-[20px] animate-pulse">
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
  active,
  waiting,
  completed,
}: {
  projects: number;
  active: number;
  waiting: number;
  completed: number;
}) {
  return (
    <div className="mb-[28px] grid grid-cols-2 gap-[10px] sm:grid-cols-4">
      {[
        { label: 'Projects', value: projects, dot: null },
        { label: 'Active', value: active, dot: '#22dd88', glow: 'rgba(34,221,136,0.5)', pulse: true },
        { label: 'Waiting', value: waiting, dot: '#ffaa00', glow: 'rgba(255,170,0,0.4)', pulse: false },
        { label: 'Completed', value: completed, dot: null },
      ].map(({ label, value, dot, glow, pulse }) => (
        <div
          key={label}
          className="flex flex-col gap-[8px] rounded-[12px] border border-[rgba(255,255,255,0.07)] bg-[#111118] px-[18px] py-[16px]"
        >
          <div className="flex items-center gap-[6px]">
            {dot && (
              <span
                className={`size-[6px] shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: dot, boxShadow: glow ? `0 0 6px ${glow}` : undefined }}
              />
            )}
            <span className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#445]">
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

  /* ── Global stats ── */
  const totalActive = Object.values(projectStats).reduce((s, p) => s + p.active, 0);
  const totalWaiting = Object.values(projectStats).reduce((s, p) => s + p.waiting, 0);
  const totalFinished = Object.values(projectStats).reduce((s, p) => s + p.finished, 0);

  /* ── Render ── */

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Header */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0f]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-[10px] pl-[52px] pr-[20px] py-[14px] sm:px-[28px] lg:px-[28px]">
          <h1 className="font-['Inter'] text-[17px] font-semibold tracking-[-0.2px] text-[#f0f0f0]">
            Projects
          </h1>

          <div className="flex items-center gap-[8px]">
            {/* Search toggle (mobile) / always visible (sm+) */}
            <div className={`relative ${showSearch || search ? 'flex' : 'hidden sm:flex'}`}>
              <div className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#445]">
                <SearchIcon />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                autoFocus={showSearch}
                onBlur={() => { if (!search) setShowSearch(false); }}
                className="h-[32px] w-[160px] sm:w-[200px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] pl-[30px] pr-[10px] font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.18)]"
              />
            </div>

            {/* Mobile search icon */}
            {!showSearch && !search && (
              <button
                onClick={() => setShowSearch(true)}
                className="flex size-[32px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] text-[#556] hover:text-[#889] transition-colors sm:hidden"
                aria-label="Search"
              >
                <SearchIcon />
              </button>
            )}

            <button
              onClick={handleOpenCreate}
              className="flex h-[32px] shrink-0 items-center gap-[6px] rounded-[8px] bg-[#af0] px-[14px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
            >
              <PlusIcon />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[22px] sm:px-[28px] sm:pt-[28px]">
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
            active={totalActive}
            waiting={totalWaiting}
            completed={totalFinished}
          />
        )}

        {/* Section toolbar */}
        {!loading && !error && (
          <div className="mb-[18px] flex items-center justify-between">
            <div className="flex items-center gap-[8px]">
              <h2 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.9px] text-[#445]">
                All Projects
              </h2>
              <span className="font-['JetBrains_Mono'] text-[11px] text-[#445]">
                {filtered.length}
              </span>
            </div>
            <button
              onClick={() => setSort(sort === 'newest' ? 'alpha' : 'newest')}
              className="flex items-center gap-[4px] rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors"
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
          <div className="flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[60px] items-center justify-center rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[#111118]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
              </svg>
            </div>
            <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
              No projects yet
            </h3>
            <p className="mt-[6px] max-w-[300px] font-['Inter'] text-[13px] leading-relaxed text-[#889]">
              Create your first project to start managing opencode sessions.
            </p>
            <button
              onClick={handleOpenCreate}
              className="mt-[20px] rounded-[8px] bg-[#af0] px-[20px] py-[10px] font-['Inter'] text-[14px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
            >
              Create your first project
            </button>
          </div>
        )}

        {/* No search results */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[64px] text-center">
            <p className="font-['Inter'] text-[15px] text-[#889]">
              No projects match &ldquo;{search}&rdquo;
            </p>
            <button
              onClick={() => setSearch('')}
              className="mt-[10px] font-['Inter'] text-[13px] text-[#af0] hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Project grid */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
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
