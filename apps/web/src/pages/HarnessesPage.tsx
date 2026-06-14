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
    <article className="flex animate-pulse flex-col gap-[14px] rounded-[14px] border border-[rgba(255,255,255,0.07)] bg-[#111118] p-[20px]">
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
        className="mx-4 w-full max-w-[380px] rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
          Delete {harnessName}?
        </h3>
        <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
          This template will be permanently removed.
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

  const handleCreate = useCallback(async (data: { name: string; description?: string }) => {
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
  }, [loadHarnesses]);

  /* ── Edit handler ── */

  const handleEdit = useCallback(async (data: { name: string; description?: string }) => {
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
  }, [editTarget, loadHarnesses]);

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
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Header */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0f]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-[10px] pl-[52px] pr-[20px] py-[14px] sm:px-[28px] lg:px-[28px]">
          <h1 className="font-['Inter'] text-[17px] font-semibold tracking-[-0.2px] text-[#f0f0f0]">
            Templates
          </h1>

          <button
            onClick={openCreate}
            className="flex h-[32px] shrink-0 items-center gap-[6px] rounded-[8px] bg-[#af0] px-[14px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
          >
            <PlusIcon />
            <span className="hidden sm:inline">New Template</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[22px] sm:px-[28px] sm:pt-[28px]">
        {/* Error */}
        {error && (
          <div className="mb-[20px] flex items-center gap-[10px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[13px] text-red-400">
            <span className="flex-1">{error}</span>
            <button
              onClick={loadHarnesses}
              className="shrink-0 underline hover:text-red-300"
            >
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
          <div className="flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[60px] items-center justify-center rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[#111118]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="#445" strokeWidth="1.5" />
                <path d="M8 12h8M12 8v8" stroke="#445" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
              No templates yet
            </h3>
            <p className="mt-[6px] max-w-[340px] font-['Inter'] text-[13px] leading-relaxed text-[#889]">
              No templates yet. Create your first template to bootstrap projects.
            </p>
            <button
              onClick={openCreate}
              className="mt-[20px] rounded-[8px] bg-[#af0] px-[20px] py-[10px] font-['Inter'] text-[14px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
            >
              Create your first template
            </button>
          </div>
        )}

        {/* Harness grid */}
        {!loading && !error && harnesses.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {harnesses.map((harness) => (
              <article
                key={harness.id}
                className="group relative flex flex-col gap-[14px] rounded-[14px] border border-[rgba(255,255,255,0.07)] bg-[#111118] p-[20px] transition-all duration-150 hover:bg-[rgba(255,255,255,0.02)]"
              >
                {/* Header row with name + edit gear */}
                <div className="flex items-start justify-between gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-['Inter'] text-[15px] font-semibold text-[#f0f0f0]">
                      {harness.name}
                    </h3>
                    {harness.description && (
                      <p className="mt-[4px] line-clamp-1 font-['Inter'] text-[13px] text-[#667]">
                        {harness.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-[6px]">
                    <button
                      onClick={() => navigate(`/templates/${encodeURIComponent(harness.id)}`)}
                      className="flex size-[30px] items-center justify-center rounded-[6px] border border-[rgba(255,255,255,0.08)] text-[#556] hover:border-[rgba(255,255,255,0.18)] hover:text-[#af0] transition-colors"
                      aria-label={`Manage files for ${harness.name}`}
                      title="Manage files"
                    >
                      <FilesIcon />
                    </button>
                    <button
                      onClick={() => openEdit(harness)}
                      className="flex size-[30px] items-center justify-center rounded-[6px] border border-[rgba(255,255,255,0.08)] text-[#556] hover:border-[rgba(255,255,255,0.18)] hover:text-[#889] transition-colors"
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
                    <span className="inline-block rounded-full bg-[rgba(170,255,0,0.1)] px-[8px] py-[3px] font-['Inter'] text-[12px] text-[#af0]">
                      {(harness as HarnessDetail).fileCount} file{(harness as HarnessDetail).fileCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Footer with delete */}
                <div className="flex items-center justify-between">
                  <div />
                  <button
                    onClick={() => setDeleteTarget(harness)}
                    className="font-['Inter'] text-[12px] font-medium text-[#445] hover:text-red-400 transition-colors"
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
