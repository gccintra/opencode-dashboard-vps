import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

/* ── Types ── */

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

/* ── Canvas Card ── */

function CanvasCard({
  canvas,
  onRename,
  onDelete,
  index = 0,
}: {
  canvas: CanvasItem;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  index?: number;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(canvas.name);
    setEditing(true);
  }, [canvas.name]);

  const saveEdit = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== canvas.name) {
      await onRename(canvas.id, trimmed).catch(() => {});
    }
  }, [editValue, canvas.id, canvas.name, onRename]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') void saveEdit();
    if (e.key === 'Escape') setEditing(false);
  }, [saveEdit]);

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="kb-rise group relative isolate flex cursor-pointer flex-col gap-[12px] overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-[16px] backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-[2px] hover:border-[#b3e502]/25 hover:bg-white/[0.05] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)]"
      onClick={() => !editing && !confirmDelete && navigate(`/canvas/${canvas.id}`)}
      data-testid={`canvas-card-${canvas.id}`}
    >
      {/* Accent edge — fades in on hover */}
      <span aria-hidden className="absolute inset-y-[14px] left-0 w-[2px] rounded-r-full bg-[#b3e502] opacity-0 transition-opacity duration-200 group-hover:opacity-70" />
      {/* Name + action buttons row */}
      <div className="flex items-center gap-[8px] min-w-0 pr-[4px]">
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveEdit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(179,229,2,0.3)] rounded-[5px] px-[8px] py-[4px] font-['Inter'] text-[14px] font-semibold text-[#f0f0f0] focus:outline-none"
            data-testid={`canvas-name-input-${canvas.id}`}
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate font-['Inter'] text-[14px] font-semibold text-[#f0f0f0]"
            onDoubleClick={startEdit}
            data-testid={`canvas-name-${canvas.id}`}
          >
            {canvas.name}
          </span>
        )}

        {/* Edit + delete buttons — always visible on mobile, hover-revealed on desktop */}
        {!editing && !confirmDelete && (
          <div className="flex items-center gap-[2px] shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={startEdit}
              className="flex items-center justify-center size-[26px] rounded-[6px] text-[#5a626c] hover:text-[#b3e502] hover:bg-[rgba(179,229,2,0.1)] transition-colors"
              aria-label="Renomear canvas"
              data-testid={`canvas-rename-btn-${canvas.id}`}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="flex items-center justify-center size-[26px] rounded-[6px] text-[#5a626c] hover:text-[#f54] hover:bg-[rgba(255,85,68,0.1)] transition-colors"
              aria-label="Deletar canvas"
              data-testid={`canvas-delete-btn-${canvas.id}`}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1 3h9M4 3V2h3v1M2 3l.8 7h5.4L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Confirm delete inline */}
        {!editing && confirmDelete && (
          <div
            className="flex items-center gap-[6px] shrink-0"
            onClick={(e) => e.stopPropagation()}
            data-testid={`canvas-confirm-delete-${canvas.id}`}
          >
            <span className="font-['Inter'] text-[11px] text-[#9aa3ad]">Deletar?</span>
            <button
              className="rounded-[6px] bg-[#f54] px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-white hover:bg-[#e43] transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(canvas.id); }}
              data-testid={`canvas-confirm-delete-yes-${canvas.id}`}
            >
              Sim
            </button>
            <button
              className="rounded-[6px] bg-[rgba(255,255,255,0.08)] px-[8px] py-[2px] font-['Inter'] text-[11px] text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.12)] transition-colors"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              data-testid={`canvas-confirm-delete-no-${canvas.id}`}
            >
              Não
            </button>
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-[6px]">
        <span className="rounded-[5px] border border-white/[0.07] bg-[rgba(255,255,255,0.04)] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] text-[#9aa3ad]">
          {canvas.cols}×{canvas.rows}
        </span>
        <span className="rounded-[5px] border border-white/[0.07] bg-[rgba(255,255,255,0.04)] px-[7px] py-[3px] font-['Inter'] text-[11px] text-[#667]">
          {canvas.slotCount}/{canvas.totalSlots} sessões
        </span>
      </div>
    </div>
  );
}

/* ── Page ── */

export default function CanvasHubPage() {
  const navigate = useNavigate();
  const [canvases, setCanvases] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchCanvases = useCallback(async () => {
    try {
      const data = await apiFetch<CanvasItem[]>('/api/canvases');
      setCanvases(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError('Erro ao carregar canvas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/canvases', { method: 'POST' });
      navigate(`/canvas/${created.id}`);
    } catch {
      setCreating(false);
    }
  }, [creating, navigate]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await apiFetch(`/api/canvases/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
      setCanvases((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silent
    }
  }, []);

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="kb-aurora" style={{ top: '-180px', left: '-120px', width: 620, height: 620, opacity: 0.5, background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)' }} />
        <div className="kb-aurora" style={{ top: '-220px', left: '38%', width: 680, height: 680, opacity: 0.4, animationDelay: '-7s', background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)' }} />
        <div className="kb-aurora" style={{ top: '-160px', right: '-160px', width: 560, height: 560, opacity: 0.38, animationDelay: '-13s', background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)' }} />
        <div className="kb-grid" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-[12px] border-b border-white/[0.06] bg-[#0a0a0f]/80 px-[20px] py-[14px] backdrop-blur-md sm:px-[28px]">
        <div className="flex min-w-0 items-baseline gap-[12px]">
          <h1 className="font-['Syne'] text-[24px] font-extrabold tracking-[-0.5px] text-white sm:text-[26px]">Canvas</h1>
          {!loading && canvases.length > 0 && (
            <span className="font-['JetBrains_Mono'] text-[12px] font-medium tabular-nums text-[#5a626c]">{canvases.length}</span>
          )}
        </div>

        <button
          onClick={handleCreate}
          disabled={creating}
          className="kb-sheen relative flex shrink-0 items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[14px] py-[8px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)] disabled:opacity-50"
          data-testid="new-canvas-btn"
        >
          {creating ? (
            <svg className="animate-spin size-[12px]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          <span className="hidden sm:inline">Novo Canvas</span>
          <span className="sm:hidden">Novo</span>
        </button>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-[20px] py-[24px] sm:px-[28px]">
        {loading ? (
          <div
            className="grid gap-[16px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[148px] animate-pulse rounded-[14px] border border-white/[0.06] bg-white/[0.03]" />
            ))}
          </div>
        ) : error ? (
          <div className="kb-rise flex flex-col items-center justify-center gap-[12px] py-[60px]">
            <p className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-[14px] py-[10px] font-['Inter'] text-[13px] text-red-400 backdrop-blur-md">
              {error}
            </p>
            <button
              onClick={fetchCanvases}
              className="font-['Inter'] text-[13px] font-semibold text-[#b3e502] hover:underline"
            >
              Tentar novamente
            </button>
          </div>
        ) : canvases.length === 0 ? (
          <div
            className="kb-rise flex flex-col items-center justify-center gap-[20px] py-[80px]"
            data-testid="canvas-empty-state"
          >
            <div className="flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
              <svg width="28" height="28" viewBox="0 0 16 16" fill="none" className="text-[#b3e502]">
                <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                <rect x="8.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                <rect x="1.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
                <rect x="8.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="font-['Syne'] text-[20px] font-bold text-white">Nenhum canvas ainda</h3>
              <p className="mt-[6px] font-['Inter'] text-[13px] text-[#7a828c]">
                Crie um canvas para organizar terminais em layouts visuais
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="kb-sheen relative flex items-center gap-[6px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516] hover:shadow-[0_8px_28px_-6px_rgba(179,229,2,0.7)] disabled:opacity-50"
              data-testid="canvas-empty-new-btn"
            >
              <span className="text-[18px] font-light leading-none">+</span>
              Criar Primeiro Canvas
            </button>
          </div>
        ) : (
          <div
            className="grid gap-[16px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
            data-testid="canvas-grid"
          >
            {canvases.map((canvas, i) => (
              <CanvasCard
                key={canvas.id}
                index={i}
                canvas={canvas}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
