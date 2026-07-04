import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { apiFetch, type ApiError } from '../lib/api';
import { DirectoryPicker } from '../components/DirectoryPicker';
import {
  Button,
  IconButton,
  Modal,
  Input,
  Textarea,
  Select,
  EmptyState,
  StatusGlyph,
  useCommandPalette,
} from '../components/ui';

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
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete ${projectName}?`}
      maxWidth="max-w-[380px]"
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-[1.5] text-ink-2">
        This will terminate all active sessions.
      </p>
    </Modal>
  );
}

/* ── Project form ── */

interface ProjectFormData {
  name: string;
  directory: string;
  description: string;
  harnessId: string | null;
}

/* Small icons for the modal chrome */

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * New / Edit project modal — Linear "New issue" layout: a breadcrumb header,
 * a borderless big title + description, then the required fields (directory,
 * template) as an attribute region, and a footer with the primary action.
 * Bespoke overlay (not the generic <Modal>) to get the command-palette surface.
 */
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

  // Escape to close (own overlay, so we own the key handling).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isEdit = /edit/i.test(title);
  const submitLabel = loading
    ? isEdit
      ? 'Saving…'
      : 'Creating…'
    : isEdit
      ? 'Save changes'
      : 'Create project';

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

  const labelClass = 'text-[11px] font-semibold uppercase tracking-[0.6px] text-ink-3';
  const optionalTag = (
    <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-ink-4">Optional</span>
  );
  const labelRow = 'mb-[8px] flex items-baseline justify-between gap-[8px]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-[7vh] motion-safe:animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
      data-testid="project-form-scrim"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel rim-light flex max-h-full w-full max-w-[500px] flex-col overflow-hidden rounded-modal motion-safe:animate-[paletteIn_140ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* Header — clean title block, no ornament */}
        <div className="flex shrink-0 items-start justify-between gap-[10px] px-[24px] pb-[18px] pt-[22px]">
          <div className="min-w-0">
            <h3 className="text-[18px] font-semibold tracking-[-0.35px] text-ink">
              {isEdit ? 'Edit project' : 'New project'}
            </h3>
            <p className="mt-[3px] text-[13px] leading-none text-ink-3">
              {isEdit ? 'Update this workspace’s settings.' : 'Point a workspace at a directory on disk.'}
            </p>
          </div>
          <IconButton onClick={onClose} disabled={loading} aria-label="Close" className="-mr-[4px] -mt-[2px]">
            <CloseIcon />
          </IconButton>
        </div>

        {/* Body — generous, well-defined fields */}
        <div className="min-h-0 flex-1 space-y-[20px] overflow-y-auto px-[24px] pb-[4px]">
          {/* Name */}
          <div>
            <div className={labelRow}>
              <label htmlFor="project-name" className={labelClass}>
                Name
              </label>
            </div>
            <Input
              id="project-name"
              type="text"
              aria-label="Name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(''); }}
              placeholder="my-project"
              autoFocus
              autoComplete="off"
              className={`!h-[38px] ${nameError ? 'border-danger/60 focus:border-danger/60 focus:ring-danger/30' : ''}`}
            />
            {nameError && <p className="mt-[6px] text-[12px] text-danger">{nameError}</p>}
          </div>

          {/* Directory — the key navigational field, given room + a helper */}
          <div>
            <div className={labelRow}>
              <label htmlFor="project-directory" className={labelClass}>
                Directory
              </label>
            </div>
            <DirectoryPicker
              value={directory}
              onChange={(path) => { setDirectory(path); setDirError(''); }}
              error={dirError}
              disabled={loading}
              placeholder="/home/user/projects/my-project"
            />
            {!dirError && (
              <p className="mt-[6px] text-[12px] leading-[1.4] text-ink-4">
                Type to autocomplete, or Browse the filesystem.
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <div className={labelRow}>
              <label htmlFor="project-description" className={labelClass}>
                Description
              </label>
              {optionalTag}
            </div>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
              placeholder="What is this project for?"
            />
          </div>

          {/* Template */}
          <div>
            <div className={labelRow}>
              <label htmlFor="project-harness" className={labelClass}>
                Template
              </label>
              {optionalTag}
            </div>
            {harnessesLoading ? (
              <div className="flex h-[34px] items-center rounded-control border border-hairline bg-white/[0.03] px-[11px]">
                <span className="text-[13px] text-ink-3">Loading templates…</span>
              </div>
            ) : (
              <div className="relative">
                <Select
                  id="project-harness"
                  value={harnessId || ''}
                  onChange={(e) => setHarnessId(e.target.value || null)}
                  className="pr-[32px]"
                >
                  <option value="" className="bg-surface-2">
                    No template — empty project
                  </option>
                  {harnesses.map((h) => (
                    <option key={h.id} value={h.id} className="bg-surface-2">
                      {h.name}
                      {h.description ? ` — ${h.description}` : ''}
                    </option>
                  ))}
                </Select>
                <span className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-ink-3">
                  <ChevronIcon />
                </span>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-control border border-danger/30 bg-danger/10 px-[12px] py-[8px] text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-[20px] flex shrink-0 items-center justify-end gap-[10px] border-t border-hairline px-[24px] py-[16px]">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {submitLabel}
          </Button>
        </div>
      </div>
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

/* ── Project row (dense list) ── */

function ProjectRow({
  project,
  stats,
  reduced,
  onOpen,
  onEdit,
  onDelete,
  onSync,
  syncing,
}: {
  project: Project;
  stats: { active: number; waiting: number; finished: number };
  reduced: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync?: (id: string) => void;
  syncing?: boolean;
}) {
  // Any non-finished session counts as "live" — waiting status is never
  // persisted to session metadata, so active already captures every live one.
  const live = stats.active + stats.waiting;
  const repoShort = project.githubRepo?.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.6 }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="row-hover group flex h-[48px] cursor-pointer items-center gap-[12px] border-b border-hairline px-[14px] outline-none last:border-b-0 focus-visible:bg-white/[0.05] sm:px-[16px]"
    >
      {/* Status glyph */}
      <StatusGlyph
        status={live > 0 ? 'active' : 'idle'}
        pulse={live > 0}
        title={live > 0 ? `${live} active session${live !== 1 ? 's' : ''}` : 'idle'}
      />

      {/* Name */}
      <span className="shrink-0 max-w-[38%] truncate text-[13px] font-semibold tracking-[-0.1px] text-ink">
        {project.name}
      </span>

      {/* Path (mono, fills, ellipsis) — hidden on mobile */}
      <span className="mono-meta hidden min-w-0 flex-1 truncate text-[11px] sm:inline" title={project.directory}>
        {project.directory}
      </span>
      <span className="flex-1 sm:hidden" />

      {/* GitHub repo — desktop only */}
      {repoShort && (
        <span
          className="mono-meta hidden shrink-0 max-w-[140px] items-center gap-[4px] truncate text-[11px] md:inline-flex"
          title={project.githubRepo ?? undefined}
        >
          <GitHubIcon />
          <span className="truncate">{repoShort}</span>
        </span>
      )}

      {/* Session count */}
      <span
        className={`mono-meta shrink-0 text-[11px] tabular-nums ${live > 0 ? 'text-accent' : 'text-ink-4'}`}
      >
        {live > 0 ? `${live} live` : 'idle'}
      </span>

      {/* Updated (right, mono, tabular) */}
      <span className="mono-meta hidden w-[64px] shrink-0 text-right text-[11px] tabular-nums sm:inline">
        {relativeTime(project.updatedAt)}
      </span>

      {/* Row actions — appear on hover/focus */}
      <div className="flex shrink-0 items-center gap-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {project.githubRepo && onSync && (
          <IconButton
            onClick={(e) => { stop(e); onSync(project.id); }}
            disabled={syncing}
            title={`Sync from ${project.githubRepo}`}
            aria-label="Sync from GitHub"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className={syncing ? 'animate-spin' : ''}>
              <path d="M12 7a5 5 0 1 1-1.46-3.54M12 2v2.5H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
        <IconButton onClick={(e) => { stop(e); onEdit(); }} aria-label={`Edit ${project.name}`}>
          <GearIcon />
        </IconButton>
        <IconButton
          onClick={(e) => { stop(e); onDelete(); }}
          className="hover:bg-danger/10 hover:text-danger"
          aria-label={`Delete ${project.name}`}
        >
          <TrashIcon />
        </IconButton>
      </div>
    </motion.div>
  );
}

/* ── Skeleton row ── */

function SkeletonRow() {
  return (
    <div className="flex h-[48px] items-center gap-[12px] border-b border-hairline px-[16px] last:border-b-0">
      <div className="size-[10px] shrink-0 rounded-full bg-white/[0.06]" />
      <div className="shimmer h-[13px] w-[120px] rounded-[4px] bg-white/[0.05]" />
      <div className="shimmer h-[11px] flex-1 rounded-[4px] bg-white/[0.03]" />
      <div className="shimmer h-[11px] w-[48px] rounded-[4px] bg-white/[0.04]" />
    </div>
  );
}

/* ── Top stat tiles (Linear-style: big number, small label, light rim) ── */

function StatsStrip({
  projects,
  activeSessions,
  liveProjects,
}: {
  projects: number;
  activeSessions: number;
  liveProjects: number;
}) {
  const tiles = [
    { label: 'Projects', value: projects, glyph: null as null | 'active' | 'idle' },
    { label: 'Active sessions', value: activeSessions, glyph: (activeSessions > 0 ? 'active' : 'idle') as 'active' | 'idle' },
    { label: 'Live projects', value: liveProjects, glyph: (liveProjects > 0 ? 'active' : 'idle') as 'active' | 'idle' },
  ];
  return (
    <div className="mb-[22px] grid grid-cols-3 gap-[10px] sm:gap-[14px]">
      {tiles.map(({ label, value, glyph }) => (
        <div
          key={label}
          className="rim-light flex min-w-0 flex-col gap-[10px] rounded-panel bg-white/[0.02] px-[14px] py-[13px] sm:px-[18px] sm:py-[16px]"
        >
          <div className="flex items-center gap-[7px]">
            {glyph && <StatusGlyph status={glyph} pulse={glyph === 'active'} size="sm" />}
            <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.7px] text-ink-3">
              {label}
            </span>
          </div>
          <span className="text-[26px] font-semibold leading-none tracking-[-1px] text-ink tabular-nums sm:text-[32px]">
            {value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Main page ── */

export default function ProjectsPage() {
  const navigate = useNavigate();
  const cmd = useCommandPalette();
  const reduced = useReducedMotion() ?? false;

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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <header className="vibrancy sticky top-0 z-10 shrink-0 border-b border-hairline">
        <div className="flex items-center justify-between gap-[10px] py-[10px] pl-[52px] pr-[16px] sm:pr-[24px] lg:pl-[24px]">
          <div className="flex items-baseline gap-[9px]">
            <h1 className="text-[17px] font-semibold tracking-[-0.3px] text-ink sm:text-[20px]">
              Projects
            </h1>
            {!loading && !error && projects.length > 0 && (
              <span className="font-['JetBrains_Mono'] text-[12px] text-ink-4 tabular-nums">
                {projects.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-[8px]">
            {/* ⌘K command palette chip — desktop */}
            <button
              onClick={() => cmd.open()}
              className="hidden items-center gap-[6px] rounded-control border border-hairline bg-surface-2/60 px-[10px] py-[6px] text-[12px] text-ink-3 transition-colors hover:border-hairline-strong hover:text-ink-2 md:flex"
              aria-label="Open command palette"
            >
              <SearchIcon />
              <span className="mono-meta text-[11px]">⌘K</span>
            </button>

            {/* Search toggle (mobile) / always visible (sm+) */}
            <div className={`relative ${showSearch || search ? 'flex' : 'hidden sm:flex'}`}>
              <div className="pointer-events-none absolute left-[10px] top-1/2 z-10 -translate-y-1/2 text-ink-3">
                <SearchIcon />
              </div>
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                autoFocus={showSearch}
                onBlur={() => { if (!search) setShowSearch(false); }}
                className="w-[160px] pl-[30px] sm:w-[200px]"
              />
            </div>

            {/* Mobile search icon */}
            {!showSearch && !search && (
              <IconButton
                onClick={() => setShowSearch(true)}
                aria-label="Search"
                className="border border-hairline bg-surface-2 sm:hidden"
              >
                <SearchIcon />
              </IconButton>
            )}

            <Button variant="primary" onClick={handleOpenCreate}>
              <PlusIcon />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[20px] sm:px-[24px]">
        {/* Error */}
        {error && (
          <div className="mb-[20px] rounded-control border border-danger/30 bg-danger/10 px-[16px] py-[12px] text-[13px] text-danger">
            {error}
            <button onClick={fetchProjects} className="ml-[8px] underline hover:text-danger/80">
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

        {/* Loading */}
        {loading && (
          <div className="rim-light overflow-hidden rounded-panel bg-white/[0.015]">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && (
          <EmptyState
            className="py-[80px]"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            }
            title="No projects yet"
            description="Create your first project to start managing opencode sessions."
            action={
              <Button variant="primary" onClick={handleOpenCreate}>
                Create your first project
              </Button>
            }
          />
        )}

        {/* No search results */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[64px] text-center">
            <p className="text-[15px] text-ink-3">
              No projects match &ldquo;{search}&rdquo;
            </p>
            <button
              onClick={() => setSearch('')}
              className="mt-[10px] text-[13px] font-semibold text-ink-2 hover:text-ink hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Project list — framed panel with a header strip */}
        {!loading && !error && filtered.length > 0 && (
          <div className="rim-light overflow-hidden rounded-panel bg-white/[0.015]">
            <div className="flex items-center justify-between border-b border-hairline px-[16px] py-[11px]">
              <div className="flex items-center gap-[8px]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.9px] text-ink-2">
                  All projects
                </h2>
                <span className="rounded-full bg-white/[0.06] px-[7px] py-[1px] font-['JetBrains_Mono'] text-[10.5px] text-ink-3 tabular-nums">
                  {filtered.length}
                </span>
              </div>
              <Button size="sm" onClick={() => setSort(sort === 'newest' ? 'alpha' : 'newest')}>
                {sort === 'newest' ? 'Newest' : 'A–Z'}
                <ChevronIcon />
              </Button>
            </div>
            {filtered.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                stats={projectStats[project.id] || { active: 0, waiting: 0, finished: 0 }}
                reduced={reduced}
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
