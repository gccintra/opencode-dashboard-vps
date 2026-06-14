import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchHarnessFiles,
  uploadHarnessFile,
  deleteHarnessFile,
  type HarnessEntry,
  type FileEntry,
} from '../../lib/api';
import HarnessFileTree from './HarnessFileTree';

/* ── Helpers ── */

function flattenFiles(entries: FileEntry[], acc: FileEntry[] = []): FileEntry[] {
  for (const e of entries) {
    if (!e.isDirectory) acc.push(e);
    if (e.children) flattenFiles(e.children, acc);
  }
  return acc;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data URL prefix, keep raw base64
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Icons ── */

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M6 7v4M8 7v4M3 4l.7 7a1 1 0 001 .9h4.6a1 1 0 001-.9L11 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M7 9V2M4 5l3-3 3 3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Confirm delete dialog ── */

function ConfirmDeleteFile({
  path,
  onConfirm,
  onCancel,
  loading,
}: {
  path: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const name = path.split('/').pop() ?? path;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-[360px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="font-['Inter'] text-[15px] font-semibold text-[#f0f0f0]">Delete file?</h4>
        <p className="mt-[6px] font-['JetBrains_Mono'] text-[12px] text-[#889] break-all">{name}</p>
        <div className="mt-[18px] flex justify-end gap-[8px]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[14px] py-[7px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[6px] bg-red-600 px-[14px] py-[7px] font-['Inter'] text-[12px] font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Modal ── */

interface HarnessFilesModalProps {
  open: boolean;
  harness: HarnessEntry | null;
  onClose: () => void;
}

type Tab = 'tree' | 'files';

export function HarnessFilesModal({ open, harness, onClose }: HarnessFilesModalProps) {
  const [tab, setTab] = useState<Tab>('tree');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /* ── Load files ── */

  const loadFiles = useCallback(async () => {
    if (!harness) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHarnessFiles(harness.id);
      setFiles(res.files);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [harness]);

  useEffect(() => {
    if (open && harness) {
      setTab('tree');
      setUploadError(null);
      setUploadSuccess(null);
      loadFiles();
    }
  }, [open, harness, loadFiles]);

  /* ── Upload ── */

  const runUpload = useCallback(
    async (items: Array<{ file: File; path: string }>) => {
      if (!harness || !items.length) return;
      setUploading(true);
      setUploadError(null);
      setUploadSuccess(null);

      let uploaded = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const { file, path } of items) {
        try {
          const content = await fileToBase64(file);
          await uploadHarnessFile(harness.id, path, content);
          uploaded++;
        } catch (err: unknown) {
          const e = err as { message?: string; status?: number };
          // 409 = already exists → skip silently
          if (e.message?.includes('already exists') || (e as { status?: number }).status === 409) {
            skipped++;
          } else {
            errors.push(path);
          }
        }
      }

      await loadFiles();
      setUploading(false);

      if (errors.length > 0) {
        setUploadError(`Failed: ${errors.join(', ')}`);
      } else {
        const parts: string[] = [];
        if (uploaded > 0) parts.push(`Uploaded ${uploaded} file${uploaded !== 1 ? 's' : ''}`);
        if (skipped > 0) parts.push(`${skipped} skipped (already exist)`);
        setUploadSuccess(parts.join(' · '));
      }
    },
    [harness, loadFiles],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const picked = Array.from(e.target.files).map((f) => ({ file: f, path: f.name }));
      e.target.value = '';
      await runUpload(picked);
    },
    [runUpload],
  );

  const handleFolderInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const picked = Array.from(e.target.files).map((f) => {
        // webkitRelativePath = "folderName/sub/file.txt" → strip first component
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
        const slashIdx = rel.indexOf('/');
        const path = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;
        return { file: f, path };
      });
      e.target.value = '';
      await runUpload(picked);
    },
    [runUpload],
  );

  /* ── Delete ── */

  const handleDeleteConfirm = useCallback(async () => {
    if (!harness || !deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteHarnessFile(harness.id, deleteTarget);
      setDeleteTarget(null);
      await loadFiles();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setUploadError(e.message ?? 'Delete failed');
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }, [harness, deleteTarget, loadFiles]);

  if (!open || !harness) return null;

  const flatFiles = flattenFiles(files);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="mx-4 flex w-full max-w-[560px] flex-col rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118]"
          style={{ maxHeight: 'min(90vh, 640px)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.07)] px-[20px] py-[14px]">
            <div className="min-w-0">
              <h3 className="truncate font-['Inter'] text-[15px] font-semibold text-[#f0f0f0]">
                {harness.name}
              </h3>
              <p className="mt-[1px] font-['Inter'] text-[12px] text-[#556]">Files</p>
            </div>
            <button
              onClick={onClose}
              className="ml-3 flex size-[30px] shrink-0 items-center justify-center rounded-[6px] text-[#556] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#889] transition-colors"
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 gap-[2px] border-b border-[rgba(255,255,255,0.07)] px-[16px]">
            {(['tree', 'files'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-[12px] py-[10px] font-['Inter'] text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'border-[#af0] text-[#f0f0f0]'
                    : 'border-transparent text-[#556] hover:text-[#889]'
                }`}
              >
                {t === 'tree' ? 'File Tree' : 'Manage Files'}
              </button>
            ))}
          </div>

          {/* Upload bar (both tabs) */}
          <div className="flex shrink-0 flex-wrap items-center gap-[8px] border-b border-[rgba(255,255,255,0.07)] px-[16px] py-[10px]">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              multiple
              className="hidden"
              onChange={handleFolderInputChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex h-[30px] items-center gap-[6px] rounded-[6px] bg-[#af0] px-[12px] font-['Inter'] text-[12px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-50"
            >
              <UploadIcon />
              {uploading ? 'Uploading…' : 'Upload files'}
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={uploading}
              className="flex h-[30px] items-center gap-[6px] rounded-[6px] border border-[rgba(255,255,255,0.10)] px-[12px] font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.20)] hover:text-[#ccd] transition-colors disabled:opacity-50"
            >
              <UploadIcon />
              Upload folder
            </button>
            {uploadSuccess && (
              <span className="font-['Inter'] text-[12px] text-[#af0]">{uploadSuccess}</span>
            )}
            {uploadError && (
              <span className="font-['Inter'] text-[12px] text-red-400">{uploadError}</span>
            )}
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-[48px]">
                <div className="size-[20px] animate-spin rounded-full border-2 border-[rgba(255,255,255,0.1)] border-t-[#af0]" />
              </div>
            )}
            {error && !loading && (
              <div className="flex flex-col items-center gap-[8px] py-[40px]">
                <p className="font-['Inter'] text-[13px] text-red-400">{error}</p>
                <button
                  onClick={loadFiles}
                  className="font-['Inter'] text-[12px] text-[#af0] underline hover:text-[#9e0]"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && tab === 'tree' && (
              <HarnessFileTree files={files} />
            )}

            {!loading && !error && tab === 'files' && (
              <div className="py-[4px]">
                {flatFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-[48px]">
                    <p className="font-['Inter'] text-[13px] text-[#556]">No files yet</p>
                    <p className="mt-[4px] font-['Inter'] text-[12px] text-[#445]">
                      Upload files using the button above
                    </p>
                  </div>
                ) : (
                  flatFiles.map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center justify-between gap-[12px] border-b border-[rgba(255,255,255,0.04)] px-[16px] py-[10px] last:border-0 hover:bg-[rgba(255,255,255,0.02)]"
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-['JetBrains_Mono'] text-[12px] text-[#ccd]"
                        title={f.path}
                      >
                        {f.path}
                      </span>
                      <button
                        onClick={() => setDeleteTarget(f.path)}
                        className="flex shrink-0 items-center gap-[4px] rounded-[5px] px-[8px] py-[4px] font-['Inter'] text-[11px] text-[#556] hover:bg-red-500/15 hover:text-red-400 transition-colors"
                        aria-label={`Delete ${f.path}`}
                      >
                        <TrashIcon />
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm delete overlay */}
      {deleteTarget && (
        <ConfirmDeleteFile
          path={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteLoading}
        />
      )}
    </>
  );
}
