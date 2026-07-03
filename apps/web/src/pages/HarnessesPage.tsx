import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchHarnesses,
  createHarness,
  updateHarness,
  deleteHarness,
  type HarnessEntry,
  type HarnessDetail,
} from '../lib/api';
import { HarnessFormModal } from '../components/Harnesses/HarnessFormModal';

/* ── Icons ── */

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

function FilesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 2h5l3 3v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M8 2v3h3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8h4M5 10h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/* ── Skeleton card ── */

function SkeletonCard() {
  return (
    <article className="flex animate-pulse flex-col gap-[14px] rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[20px] backdrop-blur-md">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-[5px]">
          <div className="h-[17px] w-[140px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
          <div className="mt-[4px] h-[13px] w-[220px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="size-[30px] rounded-[6px] bg-[rgba(255,255,255,0.06)]" />
      </div>
      <div className="flex items-center gap-[8px]">
        <div className="h-[22px] w-[60px] rounded-full bg-[rgba(255,255,255,0.04)]" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-[14px] w-[80px] rounded-[4px] bg-[rgba(255,255,255,0.04)]" />
      </div>
    </article>
  );
}

/* ── Delete dialog ── */

function DeleteDialog({
  open,
  harnessName,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  harnessName: string;
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
        <h3 className="text-[18px] font-bold text-white">Delete {harnessName}?</h3>
        <p className="mt-[8px] text-[13px] leading-[1.5] text-[#9aa3ad]">
          This template will be permanently removed.
        </p>
        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-[8px] border border-white/[0.07] px-[16px] py-[8px] text-[13px] font-medium text-[#9aa3ad] hover:border-white/[0.14] hover:text-[#e6e8eb] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[8px] bg-red-600 px-[16px] py-[8px] text-[13px] font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ── */

export default function HarnessesPage() {
  const navigate = useNavigate();
  const [harnesses, setHarnesses] = useState<HarnessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<HarnessEntry | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<HarnessEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* ── Fetch harnesses ── */

  const loadHarnesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHarnesses();
      setHarnesses(data);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHarnesses();
  }, [loadHarnesses]);

  /* ── Create handler ── */

  const handleCreate = useCallback(
    async (data: { name: string; description?: string }) => {
      setModalError(null);
      setModalLoading(true);
      try {
        await createHarness(data);
        setModalOpen(false);
        await loadHarnesses();
      } catch (err: unknown) {
        const apiErr = err as { message?: string };
        setModalError(apiErr.message || 'Failed to create template');
      } finally {
        setModalLoading(false);
      }
    },
    [loadHarnesses],
  );

  /* ── Edit handler ── */

  const handleEdit = useCallback(
    async (data: { name: string; description?: string }) => {
      if (!editTarget) return;
      setModalError(null);
      setModalLoading(true);
      try {
        await updateHarness(editTarget.id, data);
        setEditTarget(null);
        setModalOpen(false);
        await loadHarnesses();
      } catch (err: unknown) {
        const apiErr = err as { message?: string };
        setModalError(apiErr.message || 'Failed to update template');
      } finally {
        setModalLoading(false);
      }
    },
    [editTarget, loadHarnesses],
  );

  /* ── Delete handler ── */

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteHarness(deleteTarget.id);
      setDeleteTarget(null);
      await loadHarnesses();
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, loadHarnesses]);

  /* ── Open modal in create mode ── */

  const openCreate = useCallback(() => {
    setModalError(null);
    setModalMode('create');
    setEditTarget(null);
    setModalOpen(true);
  }, []);

  /* ── Open modal in edit mode ── */

  const openEdit = useCallback((harness: HarnessEntry) => {
    setModalError(null);
    setModalMode('edit');
    setEditTarget(harness);
    setModalOpen(true);
  }, []);

  /* ── Close modal ── */

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditTarget(null);
    setModalError(null);
  }, []);

  /* ── Render ── */

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0a0f]">
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

      {/* Header */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md">
        <div className="flex items-center justify-between gap-[10px] pl-[52px] pr-[20px] py-[14px] sm:px-[28px] lg:px-[28px]">
          <h1 className="text-[24px] font-extrabold tracking-[-0.5px] text-white sm:text-[26px]">
            Templates
          </h1>

          <button
            onClick={openCreate}
            className="kb-sheen relative flex h-[34px] shrink-0 items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[14px] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)]"
          >
            <PlusIcon />
            <span className="hidden sm:inline">New Template</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[22px] sm:px-[28px] sm:pt-[28px]">
        {/* Error */}
        {error && (
          <div className="mb-[20px] flex items-center gap-[10px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] text-[13px] text-red-400">
            <span className="flex-1">{error}</span>
            <button onClick={loadHarnesses} className="shrink-0 underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && harnesses.length === 0 && (
          <div className="kb-rise flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="3"
                  stroke="#b3e502"
                  strokeWidth="1.5"
                />
                <path d="M8 12h8M12 8v8" stroke="#b3e502" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="text-[20px] font-bold text-white">No templates yet</h3>
            <p className="mt-[6px] max-w-[340px] text-[13px] leading-relaxed text-[#7a828c]">
              Create your first template to bootstrap projects.
            </p>
            <button
              onClick={openCreate}
              className="kb-sheen relative mt-[22px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516]"
            >
              Create your first template
            </button>
          </div>
        )}

        {/* Harness grid */}
        {!loading && !error && harnesses.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {harnesses.map((harness, i) => (
              <article
                key={harness.id}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                className="kb-rise group relative flex flex-col gap-[14px] overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-[20px] backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-[2px] hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)]"
              >
                {/* Header row with name + edit gear */}
                <div className="flex items-start justify-between gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-semibold text-[#f0f0f0]">
                      {harness.name}
                    </h3>
                    {harness.description && (
                      <p className="mt-[4px] line-clamp-1 text-[13px] text-[#7a828c]">
                        {harness.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-[6px]">
                    <button
                      onClick={() => navigate(`/templates/${encodeURIComponent(harness.id)}`)}
                      className="flex size-[30px] items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] backdrop-blur-md hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#b3e502] transition-colors"
                      aria-label={`Manage files for ${harness.name}`}
                      title="Manage files"
                    >
                      <FilesIcon />
                    </button>
                    <button
                      onClick={() => openEdit(harness)}
                      className="flex size-[30px] items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.03] text-[#5a626c] backdrop-blur-md hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#9aa3ad] transition-colors"
                      aria-label={`Edit ${harness.name}`}
                      title="Edit template"
                    >
                      <GearIcon />
                    </button>
                  </div>
                </div>

                {/* File count badge */}
                {'fileCount' in harness && (
                  <div className="flex items-center gap-[8px]">
                    <span className="inline-block rounded-full bg-[rgba(179,229,2,0.1)] px-[8px] py-[3px] text-[12px] text-[#b3e502]">
                      {(harness as HarnessDetail).fileCount} file
                      {(harness as HarnessDetail).fileCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Footer with delete */}
                <div className="flex items-center justify-between">
                  <div />
                  <button
                    onClick={() => setDeleteTarget(harness)}
                    className="text-[12px] font-medium text-[#5a626c] hover:text-red-400 transition-colors"
                    aria-label={`Delete ${harness.name}`}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <HarnessFormModal
        open={modalOpen}
        title={modalMode === 'create' ? 'New Template' : 'Edit Template'}
        initial={{
          name: editTarget?.name || '',
          description: editTarget?.description || '',
        }}
        onClose={closeModal}
        onSubmit={modalMode === 'create' ? handleCreate : handleEdit}
        error={modalError}
        loading={modalLoading}
      />

      {/* Delete dialog */}
      <DeleteDialog
        open={deleteTarget !== null}
        harnessName={deleteTarget?.name || ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
