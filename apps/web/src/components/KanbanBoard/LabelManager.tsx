import { useEffect, useState } from 'react';
import {
  createLabel,
  deleteLabel,
  fetchLabels,
  updateLabel,
  type ApiError,
  type Label,
} from '../../lib/api';
import { LabelChip } from './LabelChip';

interface LabelManagerProps {
  projectId: string;
  /** Label ids currently applied to the task. */
  appliedIds: string[];
  /** Toggle a label on/off for the task. */
  onToggle: (labelId: string) => void;
}

const PRESET_COLORS = [
  '#af0',
  '#fa0',
  '#f55',
  '#5af',
  '#a5f',
  '#0db',
  '#f0f',
  '#fd5',
  '#5f5',
  '#889',
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Per-project label manager. Lists project labels, lets the user create new
 * ones (name + color), toggle them on the task, and delete labels entirely.
 */
export function LabelManager({ projectId, appliedIds, onToggle }: LabelManagerProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLabels(projectId)
      .then((data) => {
        if (!cancelled) setLabels(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as ApiError).message || 'Failed to load labels');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setError('Label name is required');
      return;
    }
    if (!HEX_RE.test(newColor)) {
      setError('Color must be a hex value (#rgb or #rrggbb)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createLabel(projectId, { name, color: newColor });
      setLabels((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setCreating(false);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to create label');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = labels;
    setLabels((cur) => cur.filter((l) => l.id !== id));
    try {
      await deleteLabel(id);
    } catch (err) {
      setLabels(prev);
      setError((err as ApiError).message || 'Failed to delete label');
    }
  };

  const handleRecolor = async (label: Label, color: string) => {
    if (!HEX_RE.test(color)) return;
    try {
      const updated = await updateLabel(label.id, { color });
      setLabels((cur) => cur.map((l) => (l.id === label.id ? updated : l)));
    } catch (err) {
      setError((err as ApiError).message || 'Failed to update label');
    }
  };

  return (
    <div className="flex flex-col gap-[10px]">
      {error && (
        <p className="rounded-[6px] border border-red-500/30 bg-red-500/10 px-[10px] py-[6px] font-['Inter'] text-[12px] text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-['Inter'] text-[12px] text-[#556]">Loading labels…</p>
      ) : labels.length === 0 ? (
        <p className="font-['Inter'] text-[12px] text-[#556]">No labels yet for this project.</p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {labels.map((label) => {
            const applied = appliedIds.includes(label.id);
            return (
              <li key={label.id} className="flex items-center gap-[8px]">
                <button
                  type="button"
                  onClick={() => onToggle(label.id)}
                  aria-pressed={applied}
                  aria-label={`${applied ? 'Remove' : 'Apply'} label ${label.name}`}
                  className={`flex flex-1 items-center gap-[8px] rounded-[6px] border px-[8px] py-[5px] text-left transition-colors ${
                    applied
                      ? 'border-[rgba(170,255,0,0.3)] bg-[rgba(170,255,0,0.06)]'
                      : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)]'
                  }`}
                >
                  <span
                    className="size-[12px] shrink-0 rounded-[3px]"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 font-['Inter'] text-[12px] text-[#f0f0f0]">
                    {label.name}
                  </span>
                  {applied && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.5l2.5 2.5 4.5-5"
                        stroke="#af0"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
                <input
                  type="color"
                  value={label.color.length === 4 ? '#000000' : label.color}
                  onChange={(e) => handleRecolor(label, e.target.value)}
                  aria-label={`Change color of ${label.name}`}
                  className="size-[24px] shrink-0 cursor-pointer rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-transparent p-0"
                />
                <button
                  type="button"
                  onClick={() => handleDelete(label.id)}
                  aria-label={`Delete label ${label.name}`}
                  className="shrink-0 rounded-[4px] p-[4px] text-[#445] hover:text-red-400"
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
              </li>
            );
          })}
        </ul>
      )}

      {/* Create new label */}
      {creating ? (
        <div className="flex flex-col gap-[8px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] p-[10px]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Label name"
            autoFocus
            className="w-full rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#111118] px-[10px] py-[7px] font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
          />
          <div className="flex flex-wrap items-center gap-[6px]">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                aria-label={`Pick color ${c}`}
                className={`size-[20px] rounded-[4px] border-2 ${
                  newColor === c ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={newColor.length === 4 ? '#000000' : newColor}
              onChange={(e) => setNewColor(e.target.value)}
              aria-label="Custom color"
              className="size-[24px] cursor-pointer rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-transparent p-0"
            />
            <span className="ml-auto">
              <LabelChip label={{ name: newName || 'preview', color: newColor }} size="md" />
            </span>
          </div>
          <div className="flex justify-end gap-[8px]">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName('');
                setError(null);
              }}
              className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[12px] py-[6px] font-['Inter'] text-[12px] text-[#889] hover:text-[#ccd]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="rounded-[6px] bg-[#af0] px-[12px] py-[6px] font-['Inter'] text-[12px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add label'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-[6px] self-start rounded-[6px] border border-dashed border-[rgba(255,255,255,0.12)] px-[10px] py-[6px] font-['Inter'] text-[12px] text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#ccd]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          New label
        </button>
      )}
    </div>
  );
}

export default LabelManager;
