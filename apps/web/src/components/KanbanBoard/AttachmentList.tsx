import { useEffect, useRef, useState } from 'react';
import {
  deleteTaskAttachment,
  fetchAttachmentBlob,
  uploadTaskAttachment,
  type ApiError,
  type Attachment,
} from '../../lib/api';

interface AttachmentListProps {
  taskId: string;
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A single attachment preview. The serve endpoint is behind `authGuard`
 * (Bearer-only), so the browser cannot load it via a raw `<img src>`/`<a href>`
 * (no way to attach the Authorization header → 401). We fetch the bytes through
 * `fetchAttachmentBlob` (which injects the bearer token) and expose them via an
 * object URL, revoking it on unmount to avoid leaks.
 */
function AttachmentThumb({ taskId, att }: { taskId: string; att: Attachment }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let createdUrl: string | null = null;

    fetchAttachmentBlob(taskId, att.id)
      .then((blob) => {
        if (revoked) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      });

    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [taskId, att.id]);

  const fileIcon = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7Z"
        stroke="#5a626c"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M13 2v7h7" stroke="#5a626c" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );

  if (isImage(att.mime)) {
    return (
      <a
        href={objectUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!objectUrl}
        className="block aspect-[4/3] w-full overflow-hidden bg-[#080810]"
      >
        {objectUrl && !failed ? (
          <img
            src={objectUrl}
            alt={att.filename}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center">{fileIcon}</span>
        )}
      </a>
    );
  }

  return (
    <a
      href={objectUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!objectUrl}
      download={att.filename}
      className="flex aspect-[4/3] w-full items-center justify-center bg-[#080810]"
    >
      {fileIcon}
    </a>
  );
}

/**
 * Attachment uploader + gallery. Supports file picker, paste (Ctrl+V images),
 * image thumbnails (served from the authenticated binary endpoint via object
 * URLs), and delete.
 */
export function AttachmentList({ taskId, attachments, onChange }: AttachmentListProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const next = [...attachments];
      for (const file of list) {
        const created = await uploadTaskAttachment(taskId, file);
        next.push(created);
      }
      onChange(next);
    } catch (err) {
      setError((err as ApiError).message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      upload(files);
    }
  };

  const handleDelete = async (attId: string) => {
    const prev = attachments;
    onChange(attachments.filter((a) => a.id !== attId));
    try {
      await deleteTaskAttachment(taskId, attId);
    } catch (err) {
      onChange(prev);
      setError((err as ApiError).message || 'Delete failed');
    }
  };

  return (
    <div
      className="flex flex-col gap-[10px]"
      onPaste={handlePaste}
      tabIndex={0}
      aria-label="Attachments (paste images here)"
    >
      {error && (
        <p className="rounded-[6px] border border-danger/30 bg-danger/10 px-[10px] py-[6px] text-[12px] text-danger">
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="grid grid-cols-2 gap-[8px] sm:grid-cols-3">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="group relative flex flex-col overflow-hidden rounded-[8px] border border-white/[0.07] bg-bg"
            >
              <AttachmentThumb taskId={taskId} att={att} />
              <div className="flex items-center gap-[4px] px-[6px] py-[4px]">
                <span
                  className="flex-1 truncate text-[10px] text-ink-2"
                  title={att.filename}
                >
                  {att.filename}
                </span>
                <span className="shrink-0 font-['JetBrains_Mono'] text-[9px] text-ink-3">
                  {formatSize(att.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(att.id)}
                aria-label={`Delete attachment ${att.filename}`}
                className="absolute right-[4px] top-[4px] flex size-[20px] items-center justify-center rounded-full bg-black/60 text-ink opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) upload(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center justify-center gap-[6px] rounded-[8px] border border-dashed border-hairline-strong px-[12px] py-[10px] text-[12px] text-ink-2 hover:border-white/[0.14] hover:text-ink disabled:opacity-50"
      >
        {uploading ? (
          'Uploading…'
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 10V3M4 6l3-3 3 3M2.5 11h9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Upload or paste files
          </>
        )}
      </button>
    </div>
  );
}

export default AttachmentList;
