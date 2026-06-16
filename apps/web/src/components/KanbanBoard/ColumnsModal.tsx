import { useEffect, useState } from 'react';
import {
  fetchKanbanColumns,
  createKanbanColumn,
  updateKanbanColumn,
  deleteKanbanColumn,
  type KanbanColumn,
  type KanbanCategory,
} from '../../lib/api';

interface ColumnsModalProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const CATEGORIES: { id: KanbanCategory; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: '#6b7280' },
  { id: 'unstarted', label: 'Unstarted', color: '#3b82f6' },
  { id: 'started', label: 'Started', color: '#f59e0b' },
  { id: 'completed', label: 'Completed', color: '#22c55e' },
  { id: 'canceled', label: 'Canceled', color: '#ef4444' },
];

const PRESET_COLORS = [
  '#6b7280', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#22c55e', '#14b8a6', '#ef4444', '#f97316', '#b3e502',
];

interface EditState {
  id: string;
  name: string;
  color: string;
}

interface AddState {
  category: KanbanCategory;
  name: string;
  color: string;
}

export function ColumnsModal({ open, onClose, onChanged }: ColumnsModalProps) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adding, setAdding] = useState<AddState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKanbanColumns();
      setColumns(data);
    } catch {
      setError('Failed to load columns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  if (!open) return null;

  const byCategory = (cat: KanbanCategory) => columns.filter((c) => c.category === cat);

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await updateKanbanColumn(editing.id, { name: editing.name, color: editing.color });
      await load();
      setEditing(null);
      onChanged();
    } catch (e) {
      setError((e as { message?: string }).message || 'Failed to update column');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!adding || !adding.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createKanbanColumn({ name: adding.name.trim(), category: adding.category, color: adding.color });
      await load();
      setAdding(null);
      onChanged();
    } catch (e) {
      setError((e as { message?: string }).message || 'Failed to create column');
    } finally {
      setSaving(false);
    }
  };

  // Swap a column's sort_order with its neighbour in the same category.
  const handleReorder = async (cols: KanbanColumn[], index: number, dir: -1 | 1) => {
    const neighbour = cols[index + dir];
    const current = cols[index];
    if (!neighbour || !current) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        updateKanbanColumn(current.id, { sortOrder: neighbour.sortOrder }),
        updateKanbanColumn(neighbour.id, { sortOrder: current.sortOrder }),
      ]);
      await load();
      onChanged();
    } catch (e) {
      setError((e as { message?: string }).message || 'Failed to reorder column');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (col: KanbanColumn) => {
    setSaving(true);
    setError(null);
    try {
      await deleteKanbanColumn(col.id);
      await load();
      onChanged();
    } catch (e) {
      setError((e as { message?: string }).message || 'Failed to delete column');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-rise mx-4 flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#111118] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-[20px] py-[14px]">
          <h2 className="font-['Syne'] text-[17px] font-bold tracking-[-0.2px] text-white">Kanban Columns</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-[5px] text-[#9aa3ad] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="kb-scroll flex-1 overflow-y-auto px-[20px] py-[16px]">
          {error && (
            <p className="mb-[12px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[14px] py-[10px] font-['Inter'] text-[13px] text-red-400 backdrop-blur-md">
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex flex-col gap-[8px]">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[40px] animate-pulse rounded-[10px] bg-white/[0.03]" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-[20px]">
              {CATEGORIES.map((cat) => {
                const cols = byCategory(cat.id);
                const isAddingHere = adding?.category === cat.id;

                return (
                  <div key={cat.id}>
                    {/* Category header */}
                    <div className="mb-[8px] flex items-center gap-[6px]">
                      <span
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
                        {cat.label}
                      </span>
                    </div>

                    {/* Columns in this category */}
                    <div className="ml-[13px] flex flex-col gap-[4px]">
                      {cols.map((col, idx) => {
                        const isEditing = editing?.id === col.id;
                        return (
                          <div
                            key={col.id}
                            className="flex items-center gap-[8px] rounded-[9px] border border-white/[0.06] bg-white/[0.02] px-[10px] py-[7px]"
                          >
                            {isEditing ? (
                              <>
                                {/* Color picker */}
                                <div className="flex gap-[3px]">
                                  {PRESET_COLORS.map((c) => (
                                    <button
                                      key={c}
                                      onClick={() => setEditing((e) => e ? { ...e, color: c } : e)}
                                      className="size-[14px] rounded-full transition-transform hover:scale-110"
                                      style={{
                                        backgroundColor: c,
                                        outline: editing.color === c ? `2px solid ${c}` : 'none',
                                        outlineOffset: '2px',
                                      }}
                                    />
                                  ))}
                                </div>
                                <input
                                  autoFocus
                                  value={editing.name}
                                  onChange={(e) => setEditing((s) => s ? { ...s, name: e.target.value } : s)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit();
                                    if (e.key === 'Escape') setEditing(null);
                                  }}
                                  className="flex-1 bg-transparent font-['Inter'] text-[13px] text-[#f0f0f0] outline-none"
                                />
                                <button
                                  onClick={handleSaveEdit}
                                  disabled={saving}
                                  className="rounded-[6px] bg-[#b3e502] px-[8px] py-[2px] font-['Inter'] text-[11px] font-bold text-[#0a0a0f] shadow-[0_2px_8px_-2px_rgba(179,229,2,0.5)] transition-colors hover:bg-[#c2f516] disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditing(null)}
                                  className="font-['Inter'] text-[11px] text-[#7a828c] transition-colors hover:text-[#9aa3ad]"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <span
                                  className="size-[10px] shrink-0 rounded-full"
                                  style={{ backgroundColor: col.color }}
                                />
                                <span className="flex-1 font-['Inter'] text-[13px] text-[#e6e8eb]">
                                  {col.name}
                                </span>
                                {col.taskCount != null && col.taskCount > 0 && (
                                  <span className="font-['JetBrains_Mono'] text-[11px] text-[#5a626c] tabular-nums">
                                    {col.taskCount} tasks
                                  </span>
                                )}
                                {/* Reorder within category */}
                                <button
                                  onClick={() => handleReorder(cols, idx, -1)}
                                  disabled={saving || idx === 0}
                                  className="rounded-[5px] p-[3px] text-[#5a626c] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb] disabled:opacity-30 disabled:hover:bg-transparent"
                                  title="Move up"
                                  aria-label="Move column up"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M6 3.5v5M3.5 6L6 3.5 8.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleReorder(cols, idx, 1)}
                                  disabled={saving || idx === cols.length - 1}
                                  className="rounded-[5px] p-[3px] text-[#5a626c] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb] disabled:opacity-30 disabled:hover:bg-transparent"
                                  title="Move down"
                                  aria-label="Move column down"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M6 8.5v-5M3.5 6L6 8.5 8.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() =>
                                    setEditing({ id: col.id, name: col.name, color: col.color })
                                  }
                                  className="rounded-[5px] p-[3px] text-[#5a626c] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb]"
                                  title="Edit column"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDelete(col)}
                                  disabled={saving}
                                  className="rounded-[5px] p-[3px] text-[#5a626c] transition-colors hover:bg-white/[0.06] hover:text-red-400 disabled:opacity-40"
                                  title={
                                    col.taskCount && col.taskCount > 0
                                      ? `${col.taskCount} tasks — move them first`
                                      : 'Delete column'
                                  }
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path
                                      d="M2 3h8M4.5 3V2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5 5.5v3M7 5.5v3M3.5 3l.5 7a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l.5-7"
                                      stroke="currentColor"
                                      strokeWidth="1"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {/* Add column inline */}
                      {isAddingHere ? (
                        <div className="flex items-center gap-[8px] rounded-[9px] border border-[#b3e502]/30 bg-[rgba(179,229,2,0.06)] px-[10px] py-[7px]">
                          <div className="flex gap-[3px]">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c}
                                onClick={() => setAdding((a) => a ? { ...a, color: c } : a)}
                                className="size-[14px] rounded-full transition-transform hover:scale-110"
                                style={{
                                  backgroundColor: c,
                                  outline: adding.color === c ? `2px solid ${c}` : 'none',
                                  outlineOffset: '2px',
                                }}
                              />
                            ))}
                          </div>
                          <input
                            autoFocus
                            value={adding.name}
                            placeholder="Column name…"
                            onChange={(e) => setAdding((a) => a ? { ...a, name: e.target.value } : a)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAdd();
                              if (e.key === 'Escape') setAdding(null);
                            }}
                            className="flex-1 bg-transparent font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none"
                          />
                          <button
                            onClick={handleAdd}
                            disabled={saving || !adding.name.trim()}
                            className="rounded-[6px] bg-[#b3e502] px-[8px] py-[2px] font-['Inter'] text-[11px] font-bold text-[#0a0a0f] shadow-[0_2px_8px_-2px_rgba(179,229,2,0.5)] transition-colors hover:bg-[#c2f516] disabled:opacity-50"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAdding(null)}
                            className="font-['Inter'] text-[11px] text-[#7a828c] transition-colors hover:text-[#9aa3ad]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setAdding({ category: cat.id, name: '', color: cat.color })
                          }
                          className="flex items-center gap-[6px] rounded-[9px] px-[10px] py-[6px] font-['Inter'] text-[12px] text-[#5a626c] transition-colors hover:bg-white/[0.03] hover:text-[#9aa3ad]"
                        >
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                          Add column
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
