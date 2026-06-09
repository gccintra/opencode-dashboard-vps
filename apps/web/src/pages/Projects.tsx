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
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ── Inline SVG Icons ── */

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="#445" strokeWidth="1.2" />
      <path d="M8.5 8.5L12 12" stroke="#445" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="#0a0a0f" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.2" stroke="#889" strokeWidth="1.1" />
      <path
        d="M7 1.3v1.3M7 11.4v1.3M1.3 7h1.3M11.4 7h1.3M2.96 2.96l.92.92M10.12 10.12l.92.92M2.96 11.04l.92-.92M10.12 3.88l.92-.92"
        stroke="#889"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M1 10L10 1M10 1H3.5M10 1v6.5"
        stroke="#889"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="#445"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Modal ── */

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
        className="mx-4 w-full max-w-[400px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Delete Dialog ── */

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
        className="mx-4 w-full max-w-[380px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
          Delete {projectName}?
        </h3>
        <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
          Are you sure? Active sessions will be terminated.
        </p>
        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[6px] bg-red-600 px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Project Form Modal ── */

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
    onSubmit({
      name: name.trim(),
      directory: directory.trim(),
      description: description.trim(),
      harnessId,
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[420px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">{title}</h3>

        <div className="mt-[18px] space-y-[14px]">
          {/* Name */}
          <div>
            <label
              htmlFor="project-name"
              className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
            >
              Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
              className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="my-project"
            />
            {nameError && (
              <p className="mt-[4px] font-['Inter'] text-[12px] text-red-400">{nameError}</p>
            )}
          </div>

          {/* Directory */}
          <div>
            <label
              htmlFor="project-directory"
              className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
            >
              Directory
            </label>
            <DirectoryPicker
              value={directory}
              onChange={(path) => {
                setDirectory(path);
                setDirError('');
              }}
              error={dirError}
              disabled={loading}
              placeholder="/home/user/projects/my-project"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="project-description"
              className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
            >
              Description <span className="text-[#556] font-normal normal-case">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="Optional description"
            />
          </div>
        </div>

        {/* Harness Selector */}
        <div className="mt-[14px]">
          <label
            htmlFor="project-harness"
            className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
          >
            Template <span className="text-[#556] font-normal normal-case">(optional)</span>
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
              className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] outline-none focus:border-[rgba(255,255,255,0.16)] appearance-none"
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

        {error && (
          <p className="mt-[14px] rounded-[6px] border border-red-500/30 bg-red-500/10 px-[12px] py-[8px] font-['Inter'] text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-[6px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Project Card ── */

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
  return (
    <article className="flex flex-col gap-[14px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[21px]">
      {/* Header: name + directory + settings */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex flex-col gap-[4px]">
          <h3 className="truncate font-['Inter'] text-[15px] font-semibold tracking-[-0.15px] text-[#f0f0f0]">
            {project.name}
          </h3>
          <p className="truncate font-['JetBrains_Mono'] text-[11px] font-normal tracking-[0.11px] text-[#445]">
            {project.directory}
          </p>
        </div>
        <button
          onClick={onEdit}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-[4px] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.2)] transition-colors"
          aria-label={`Edit ${project.name}`}
        >
          <GearIcon />
        </button>
      </div>

      {/* Session status bar */}
      <div className="flex items-center gap-[14px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[13px] py-[11px]">
        {/* Active */}
        <div className="flex items-center gap-[6px]">
          <span
            className="size-[7px] shrink-0 rounded-[3.5px] bg-[#2d8]"
            style={{ boxShadow: '0px 0px 5px 0px rgba(34,221,136,0.5)' }}
          />
          <span className="font-['Inter'] text-[12.5px] font-medium text-[#2d8]">
            {stats.active}
          </span>
          <span className="font-['Inter'] text-[12px] font-medium text-[#445]">Active</span>
        </div>
        <div className="h-[12px] w-px shrink-0 bg-[rgba(255,255,255,0.08)]" />
        {/* Waiting */}
        <div className="flex items-center gap-[6px]">
          <span
            className="size-[7px] shrink-0 rounded-[3.5px] bg-[#fa0]"
            style={{ boxShadow: '0px 0px 5px 0px rgba(255,170,0,0.5)' }}
          />
          <span className="font-['Inter'] text-[12.5px] font-medium text-[#fa0]">
            {stats.waiting}
          </span>
          <span className="font-['Inter'] text-[12px] font-medium text-[#445]">Waiting</span>
        </div>
        <div className="h-[12px] w-px shrink-0 bg-[rgba(255,255,255,0.08)]" />
        {/* Finished */}
        <div className="flex items-center gap-[6px]">
          <span className="size-[7px] shrink-0 rounded-[3.5px] bg-[#445]" />
          <span className="font-['Inter'] text-[12.5px] font-medium text-[#445]">
            {stats.finished}
          </span>
          <span className="font-['Inter'] text-[12px] font-medium text-[#445]">Finished</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="font-['JetBrains_Mono'] text-[12px] font-normal tracking-[0.12px] text-[#445]">
          Last active {relativeTime(project.updatedAt)}
        </span>
        <div className="flex items-center gap-[8px]">
          {project.githubRepo && onSync && (
            <button
              onClick={() => onSync(project.id)}
              disabled={syncing}
              className="font-['Inter'] text-[12px] font-medium text-[#556] hover:text-[#af0] transition-colors disabled:opacity-50"
              aria-label={`Sync GitHub issues for ${project.name}`}
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
            className="flex h-[27px] items-center gap-[6px] rounded-[4px] border border-[rgba(255,255,255,0.08)] px-[12px] font-['Inter'] text-[12.5px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#ccd] transition-colors"
          >
            Open
            <ArrowIcon />
          </button>
        </div>
      </div>
    </article>
  );
}

/* ── Skeleton Card ── */

function SkeletonCard() {
  return (
    <article className="flex flex-col gap-[14px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[21px] animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-[4px]">
          <div className="h-[18px] w-[140px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[14px] w-[220px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="size-[28px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
      </div>
      <div className="h-[39px] rounded-[8px] bg-[rgba(255,255,255,0.04)]" />
      <div className="flex items-center justify-between">
        <div className="h-[16px] w-[130px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
        <div className="h-[27px] w-[74px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
      </div>
    </article>
  );
}

/* ── Stats Card ── */

function StatsCard({
  label,
  value,
  colorDot,
  dotShadow,
}: {
  label: string;
  value: number;
  colorDot?: string;
  dotShadow?: string;
}) {
  return (
    <div className="flex flex-col gap-[6px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] px-[19px] py-[17px]">
      <div className="flex items-center gap-[6px]">
        {colorDot && (
          <span
            className="size-[6px] shrink-0 rounded-[3px]"
            style={{ backgroundColor: colorDot, boxShadow: dotShadow }}
          />
        )}
        <span className="font-['Inter'] text-[11.5px] font-medium uppercase tracking-[0.46px] text-[#445]">
          {label}
        </span>
      </div>
      <span className="font-['Inter'] text-[26px] font-bold leading-[26px] tracking-[-0.78px] text-[#f0f0f0]">
        {value}
      </span>
    </div>
  );
}

/* ── Main Projects Page ── */

export default function ProjectsPage() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-project session stats: projectId → { active, waiting, finished }
  const [projectStats, setProjectStats] = useState<
    Record<string, { active: number; waiting: number; finished: number }>
  >({});

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [syncingProject, setSyncingProject] = useState<string | null>(null);

  // Harness state
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [harnessesLoading, setHarnessesLoading] = useState(false);

  /* ── Fetch harnesses when create modal opens ── */
  const fetchHarnesses = useCallback(async () => {
    setHarnessesLoading(true);
    try {
      const data = await apiFetch<Harness[]>('/api/harnesses');
      setHarnesses(data);
    } catch {
      // Silently fail — harness selector just won't show options
      setHarnesses([]);
    } finally {
      setHarnessesLoading(false);
    }
  }, []);

  const handleOpenCreate = useCallback(() => {
    setFormError(null);
    setCreateOpen(true);
    // Fetch harnesses lazily on first open
    if (harnesses.length === 0 && !harnessesLoading) {
      fetchHarnesses();
    }
  }, [harnesses.length, harnessesLoading, fetchHarnesses]);

  /* ── Fetch projects ── */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Project[]>('/api/projects');
      setProjects(data);

      // Fetch stats independently (non-fatal if it fails)
      try {
        const stats =
          await apiFetch<Record<string, { active: number; waiting: number; finished: number }>>(
            '/api/projects/stats',
          );
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

  /* ── Create ── */
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

  /* ── Edit ── */
  const handleEdit = async (data: ProjectFormData) => {
    if (!editTarget) return;
    setFormError(null);
    setFormLoading(true);
    try {
      await apiFetch(`/api/projects/${editTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setEditTarget(null);
      await fetchProjects();
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || 'Failed to update project');
    } finally {
      setFormLoading(false);
    }
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/api/projects/${deleteTarget.id}`, {
        method: 'DELETE',
      });
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

  /* ── GitHub Sync ── */
  const handleSync = useCallback(
    async (projectId: string) => {
      if (syncingProject) return;
      setSyncingProject(projectId);
      try {
        await apiFetch(`/api/projects/${projectId}/github/sync`, { method: 'POST' });
      } catch {
        // Non-fatal — background polling will pick it up
      } finally {
        setSyncingProject(null);
      }
    },
    [syncingProject],
  );

  /* ── Render ── */

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* ══════ Header ══════ */}
      <header className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-[24px] pb-[19px] pt-[18px] sm:px-[32px]">
        <h1 className="font-['Inter'] text-[18px] font-semibold tracking-[-0.18px] text-[#f0f0f0]">
          Projects
        </h1>

        <div className="flex items-center gap-[10px]">
          {/* Search */}
          <div className="relative">
            <div className="absolute left-[10px] top-1/2 -translate-y-1/2">
              <SearchIcon />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="h-[32px] w-[180px] sm:w-[220px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] pl-[32px] pr-[12px] font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
            />
          </div>

          {/* New Project button */}
          <button
            onClick={handleOpenCreate}
            className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-[8px] bg-[#af0] px-[14px] font-['Inter'] text-[13px] font-semibold tracking-[0.13px] text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
          >
            <PlusIcon />
            <span className="hidden sm:inline">New Project</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </header>

      {/* ══════ Content ══════ */}
      <div className="px-[16px] pb-[40px] pt-[20px] sm:px-[32px] sm:pt-[28px]">
        {/* ── Error banner ── */}
        {error && (
          <div className="mb-[20px] rounded-[8px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[14px] text-red-400">
            {error}
            <button onClick={fetchProjects} className="ml-[8px] underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {/* ── Stats Row ── */}
        {!loading && !error && (
          <div className="mb-[28px] grid grid-cols-2 gap-[12px] sm:grid-cols-4">
            <StatsCard label="Projects" value={projects.length} />
            <StatsCard
              label="Active Sessions"
              value={Object.values(projectStats).reduce((sum, s) => sum + s.active, 0)}
              colorDot="#2d8"
              dotShadow="0px 0px 6px 0px rgba(34,221,136,0.5)"
            />
            <StatsCard
              label="Waiting"
              value={Object.values(projectStats).reduce((sum, s) => sum + s.waiting, 0)}
              colorDot="#fa0"
              dotShadow="0px 0px 6px 0px rgba(255,170,0,0.5)"
            />
            <StatsCard
              label="Completed"
              value={Object.values(projectStats).reduce((sum, s) => sum + s.finished, 0)}
            />
          </div>
        )}

        {/* ── Section header ── */}
        {!loading && !error && (
          <div className="mb-[22px] flex items-center justify-between">
            <div className="flex items-center gap-[10px]">
              <h2 className="font-['Inter'] text-[12px] font-semibold uppercase tracking-[0.96px] text-[#445]">
                All Projects
              </h2>
              <span className="font-['JetBrains_Mono'] text-[11px] font-normal text-[#445]">
                {filtered.length} project{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Sort toggle */}
            <button
              onClick={() => setSort(sort === 'newest' ? 'alpha' : 'newest')}
              className="flex items-center gap-[4px] rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors"
            >
              {sort === 'newest' ? 'Newest' : 'A–Z'}
              <ChevronIcon />
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[56px] items-center justify-center rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#445" strokeWidth="1.5" />
              </svg>
            </div>
            <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
              No projects yet
            </h3>
            <p className="mt-[6px] max-w-[300px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
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

        {/* ── No search results ── */}
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

        {/* ── Project cards grid ── */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                stats={projectStats[project.id] || { active: 0, waiting: 0, finished: 0 }}
                onOpen={() => navigate(`/projects/${project.id}`)}
                onEdit={() => {
                  setFormError(null);
                  setEditTarget(project);
                }}
                onDelete={() => setDeleteTarget(project)}
                onSync={handleSync}
                syncing={syncingProject === project.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══════ Modals ══════ */}

      {/* Create Project Modal */}
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

      {/* Edit Project Modal */}
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

      {/* Delete Dialog */}
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
