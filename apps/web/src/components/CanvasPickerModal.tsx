import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api';

interface CanvasItem {
  id: string;
  name: string;
  cols: number;
  rows: number;
  slotCount: number;
  totalSlots: number;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

/* ── Single canvas row: select / rename / delete ── */

function CanvasRow({
  canvas,
  onSelect,
  onRename,
  onDelete,
}: {
  canvas: CanvasItem;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setValue(canvas.name);
      setEditing(true);
    },
    [canvas.name],
  );

  const save = useCallback(() => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== canvas.name) onRename(canvas.id, trimmed);
  }, [value, canvas.id, canvas.name, onRename]);

  return (
    <div
      onClick={() => !editing && !confirmDelete && onSelect(canvas.id)}
      className="group flex cursor-pointer items-center gap-[10px] rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-[12px] py-[10px] transition-all hover:border-[#b3e502]/30 hover:bg-[rgba(179,229,2,0.05)]"
    >
      <span className="shrink-0 size-[8px] rounded-full bg-[rgba(179,229,2,0.5)]" />

      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={save}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-[5px] border border-[rgba(179,229,2,0.3)] bg-[rgba(255,255,255,0.06)] px-[6px] py-[3px] font-['Inter'] text-[13px] font-medium text-[#f0f0f0] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate font-['Inter'] text-[13px] font-medium text-[#e6e8eb] group-hover:text-white">
          {canvas.name}
        </span>
      )}

      {!editing && !confirmDelete && (
        <span className="shrink-0 font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
          {canvas.cols}×{canvas.rows} · {canvas.slotCount}/{canvas.totalSlots}
        </span>
      )}

      {/* Actions */}
      {!editing && !confirmDelete && (
        <div className="flex shrink-0 items-center gap-[2px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button
            onClick={startEdit}
            className="flex size-[24px] items-center justify-center rounded-[5px] text-[#5a626c] hover:bg-[rgba(179,229,2,0.1)] hover:text-[#b3e502] transition-colors"
            aria-label="Renomear canvas"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="flex size-[24px] items-center justify-center rounded-[5px] text-[#5a626c] hover:bg-[rgba(255,85,68,0.1)] hover:text-[#f54] transition-colors"
            aria-label="Deletar canvas"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 3h9M4 3V2h3v1M2 3l.8 7h5.4L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="flex shrink-0 items-center gap-[6px]" onClick={(e) => e.stopPropagation()}>
          <span className="font-['Inter'] text-[11px] text-[#9aa3ad]">Deletar?</span>
          <button
            className="rounded-[5px] bg-[#f54] px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-white hover:bg-[#e43] transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(canvas.id); }}
          >
            Sim
          </button>
          <button
            className="rounded-[5px] bg-[rgba(255,255,255,0.08)] px-[8px] py-[2px] font-['Inter'] text-[11px] text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.12)] transition-colors"
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
          >
            Não
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Modal ── */

export default function CanvasPickerModal({ open, onClose, onSelect }: Props) {
  const [canvases, setCanvases] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchCanvases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CanvasItem[]>('/api/canvases');
      setCanvases(Array.isArray(data) ? data : []);
    } catch {
      setCanvases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchCanvases();
  }, [open, fetchCanvases]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleRename = useCallback(async (id: string, name: string) => {
    setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await apiFetch(`/api/canvases/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    } catch {
      fetchCanvases();
    }
  }, [fetchCanvases]);

  const handleDelete = useCallback(async (id: string) => {
    setCanvases((prev) => prev.filter((c) => c.id !== id));
    try {
      await apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
    } catch {
      fetchCanvases();
    }
  }, [fetchCanvases]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/canvases', { method: 'POST' });
      onSelect(created.id);
    } catch {
      setCreating(false);
    }
  }, [creating, onSelect]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full flex-col overflow-hidden rounded-t-[16px] border border-white/[0.08] bg-[#111118] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.8)] sm:max-h-[480px] sm:w-[400px] sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile grab handle */}
        <div className="flex shrink-0 justify-center pt-[10px] pb-[4px] sm:hidden">
          <span className="h-[4px] w-[36px] rounded-full bg-white/[0.15]" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-[18px] py-[14px]">
          <h3 className="font-['Syne'] text-[17px] font-bold text-white">Canvas</h3>
          <div className="flex items-center gap-[8px]">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-[5px] rounded-[8px] bg-[#b3e502] px-[10px] py-[5px] font-['Inter'] text-[12px] font-bold text-[#0a0a0f] transition-all hover:bg-[#c2f516] disabled:opacity-50"
            >
              {creating ? (
                <div className="size-[10px] animate-spin rounded-full border-[1.5px] border-[#0a0a0f] border-t-transparent" />
              ) : (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
              Novo
            </button>
            <button
              onClick={onClose}
              className="flex size-[26px] items-center justify-center rounded-[6px] text-[#5a626c] hover:bg-white/[0.06] hover:text-[#9aa3ad] transition-colors"
              aria-label="Fechar"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex flex-col gap-[6px] overflow-y-auto p-[12px]">
          {loading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="h-[42px] animate-pulse rounded-[10px] border border-white/[0.06] bg-white/[0.03]" />
            ))
          ) : canvases.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-[10px] py-[36px] text-center">
              <p className="font-['Inter'] text-[13px] text-[#5a626c]">Nenhum canvas ainda</p>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="rounded-[9px] bg-[#b3e502] px-[16px] py-[9px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] transition-all hover:bg-[#c2f516] disabled:opacity-50"
              >
                Criar primeiro canvas
              </button>
            </div>
          ) : (
            canvases.map((c) => (
              <CanvasRow
                key={c.id}
                canvas={c}
                onSelect={onSelect}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))
          )}
          <div className="h-[env(safe-area-inset-bottom,0px)] sm:hidden" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
