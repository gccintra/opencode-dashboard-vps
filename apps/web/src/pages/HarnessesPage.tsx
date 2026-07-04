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
import { Button, IconButton, Modal, EmptyState } from '../components/ui';

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
    <article className="flex animate-pulse flex-col gap-[14px] rounded-panel border border-hairline bg-surface p-[16px]">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-[5px]">
          <div className="h-[15px] w-[140px] rounded-[4px] bg-white/[0.06]" />
          <div className="mt-[4px] h-[12px] w-[220px] rounded-[4px] bg-white/[0.04]" />
        </div>
        <div className="size-[28px] rounded-control bg-white/[0.06]" />
      </div>
      <div className="h-[22px] w-[60px] rounded-full bg-white/[0.04]" />
      <div className="h-[14px] w-[80px] rounded-[4px] bg-white/[0.04]" />
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
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete ${harnessName}?`}
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
        This template will be permanently removed.
      </p>
    </Modal>
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="vibrancy sticky top-0 z-20 shrink-0 border-b border-hairline">
        <div className="flex items-center justify-between gap-[10px] py-[10px] pl-[52px] pr-[16px] sm:px-[24px]">
          <h1 className="text-[17px] font-semibold tracking-[-0.2px] text-ink sm:text-[20px]">
            Templates
          </h1>

          <Button variant="primary" onClick={openCreate}>
            <PlusIcon />
            <span className="hidden sm:inline">New Template</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[40px] pt-[20px] sm:px-[24px]">
        {/* Error */}
        {error && (
          <div className="mb-[20px] flex items-center gap-[10px] rounded-control border border-danger/30 bg-danger/10 px-[16px] py-[12px] text-[13px] text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={loadHarnesses} className="shrink-0 underline hover:text-danger/80">
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
          <EmptyState
            className="py-[80px]"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
            title="No templates yet"
            description="Create your first template to bootstrap projects."
            action={
              <Button variant="primary" onClick={openCreate}>
                Create your first template
              </Button>
            }
          />
        )}

        {/* Harness grid */}
        {!loading && !error && harnesses.length > 0 && (
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
            {harnesses.map((harness) => (
              <article
                key={harness.id}
                className="group relative flex flex-col gap-[14px] rounded-panel border border-hairline bg-surface p-[16px] transition-colors duration-150 hover:border-hairline-strong"
              >
                {/* Header row with name + actions */}
                <div className="flex items-start justify-between gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13px] font-semibold tracking-[-0.1px] text-ink">
                      {harness.name}
                    </h3>
                    {harness.description && (
                      <p className="mt-[4px] line-clamp-1 text-[12.5px] text-ink-2">
                        {harness.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-[6px]">
                    <IconButton
                      onClick={() => navigate(`/templates/${encodeURIComponent(harness.id)}`)}
                      className="hover:text-accent"
                      aria-label={`Manage files for ${harness.name}`}
                      title="Manage files"
                    >
                      <FilesIcon />
                    </IconButton>
                    <IconButton
                      onClick={() => openEdit(harness)}
                      aria-label={`Edit ${harness.name}`}
                      title="Edit template"
                    >
                      <GearIcon />
                    </IconButton>
                  </div>
                </div>

                {/* File count badge */}
                {'fileCount' in harness && (
                  <div className="flex items-center gap-[8px]">
                    <span className="inline-block rounded-full border border-accent/25 bg-accent/[0.08] px-[8px] py-[3px] text-[11px] font-medium text-accent">
                      {(harness as HarnessDetail).fileCount} file
                      {(harness as HarnessDetail).fileCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Footer with delete */}
                <div className="flex items-center justify-end pt-[2px]">
                  <button
                    onClick={() => setDeleteTarget(harness)}
                    className="text-[12px] font-medium text-ink-3 transition-colors hover:text-danger"
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
