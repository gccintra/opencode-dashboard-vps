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
}: {
  canvas: CanvasItem;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
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
      className="relative flex flex-col gap-[12px] rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[16px] cursor-pointer hover:border-[rgba(170,255,0,0.2)] hover:bg-[rgba(170,255,0,0.03)] transition-colors group"
      onClick={() => !editing && !confirmDelete && navigate(`/canvas/${canvas.id}`)}
      data-testid={`canvas-card-${canvas.id}`}
    >
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
            className="flex-1 min-w-0 bg-[rgba(255,255,255,0.06)] border border-[rgba(170,255,0,0.3)] rounded-[5px] px-[8px] py-[4px] font-['Inter'] text-[14px] font-semibold text-[#f0f0f0] focus:outline-none"
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
              className="flex items-center justify-center size-[26px] rounded-[4px] text-[#445] hover:text-[#af0] hover:bg-[rgba(170,255,0,0.1)] transition-colors"
              aria-label="Renomear canvas"
              data-testid={`canvas-rename-btn-${canvas.id}`}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="flex items-center justify-center size-[26px] rounded-[4px] text-[#445] hover:text-[#f54] hover:bg-[rgba(255,85,68,0.1)] transition-colors"
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
            <span className="font-['Inter'] text-[11px] text-[#889]">Deletar?</span>
            <button
              className="rounded-[4px] bg-[#f54] px-[8px] py-[2px] font-['Inter'] text-[11px] font-medium text-white hover:bg-[#e43] transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(canvas.id); }}
              data-testid={`canvas-confirm-delete-yes-${canvas.id}`}
            >
              Sim
            </button>
            <button
              className="rounded-[4px] bg-[rgba(255,255,255,0.08)] px-[8px] py-[2px] font-['Inter'] text-[11px] text-[#889] hover:bg-[rgba(255,255,255,0.12)] transition-colors"
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
        <span className="rounded-[5px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-[7px] py-[3px] font-['JetBrains_Mono'] text-[11px] text-[#889]">
          {canvas.cols}×{canvas.rows}
        </span>
        <span className="rounded-[5px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-[7px] py-[3px] font-['Inter'] text-[11px] text-[#667]">
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
    <div className="flex flex-1 flex-col min-h-0 bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-[12px] border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[20px] sm:px-[28px] py-[14px]">
        <div className="flex items-center gap-[10px] min-w-0">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="text-[#af0] shrink-0">
            <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="8.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="1.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="8.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          <h1 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">Canvas</h1>
          {!loading && canvases.length > 0 && (
            <span className="font-['Inter'] text-[12px] text-[#445]">{canvases.length} canvas</span>
          )}
        </div>

        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-[6px] rounded-[7px] bg-[#af0] px-[14px] py-[7px] font-['Inter'] text-[13px] font-semibold text-black hover:bg-[#9e0] disabled:opacity-50 transition-colors shrink-0"
          data-testid="new-canvas-btn"
        >
          {creating ? (
            <svg className="animate-spin size-[12px]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          Novo Canvas
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[20px] sm:px-[28px] py-[24px]">
        {loading ? (
          <div className="flex items-center justify-center py-[60px]">
            <svg className="animate-spin size-[28px] text-[#556]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-[60px] gap-[12px]">
            <p className="font-['Inter'] text-[14px] text-[#f54]">{error}</p>
            <button
              onClick={fetchCanvases}
              className="font-['Inter'] text-[13px] text-[#af0] hover:underline"
            >
              Tentar novamente
            </button>
          </div>
        ) : canvases.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-[80px] gap-[20px]"
            data-testid="canvas-empty-state"
          >
            <svg width="48" height="48" viewBox="0 0 16 16" fill="none" className="text-[#334]">
              <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
              <rect x="8.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
              <rect x="1.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
              <rect x="8.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25" />
            </svg>
            <div className="text-center">
              <p className="font-['Inter'] text-[16px] font-semibold text-[#ccd]">Nenhum canvas ainda</p>
              <p className="mt-[6px] font-['Inter'] text-[13px] text-[#556]">
                Crie um canvas para organizar terminais em layouts visuais
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-[6px] rounded-[8px] bg-[#af0] px-[20px] py-[11px] font-['Inter'] text-[14px] font-semibold text-black hover:bg-[#9e0] disabled:opacity-50 transition-colors"
              data-testid="canvas-empty-new-btn"
            >
              <span className="text-[18px] leading-none font-light">+</span>
              Criar Primeiro Canvas
            </button>
          </div>
        ) : (
          <div
            className="grid gap-[16px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
            data-testid="canvas-grid"
          >
            {canvases.map((canvas) => (
              <CanvasCard
                key={canvas.id}
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
