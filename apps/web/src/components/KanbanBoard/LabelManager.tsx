import { useEffect, useMemo, useState } from 'react';
import {
  createLabel,
  deleteLabel,
  fetchLabels,
  updateLabel,
  type ApiError,
  type Label,
} from '../../lib/api';
import { LabelChip, parseScopedLabel } from './LabelChip';

interface LabelManagerProps {
  /** Label ids currently applied to the task (empty array in standalone mode). */
  appliedIds: string[];
  /** Toggle a label on/off for the task. */
  onToggle: (labelId: string) => void;
  /** When false, hides the "New label" form. Default: true. */
  allowCreate?: boolean;
}

const PRESET_COLORS = [
  '#5e6ad2',
  '#fa0',
  '#f55',
  '#5af',
  '#a5f',
  '#0db',
  '#f0f',
  '#fd5',
  '#5f5',
  '#9aa3ad',
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Round swatch palette — modern replacement for the native color input. */
function SwatchGrid({ current, onPick }: { current: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-[7px]">
      {PRESET_COLORS.map((c) => {
        const active = current.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            aria-label={`Pick color ${c}`}
            aria-pressed={active}
            className="flex size-[24px] items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              outline: active ? `2px solid ${c}` : '2px solid transparent',
              outlineOffset: 2,
            }}
          >
            {active && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.5l2.5 2.5 4.5-5"
                  stroke="#0a0a0f"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Global label manager. Lists all labels as glass chips, lets the user toggle
 * them on a task, and (when allowCreate=true) create / recolor / delete labels.
 */
export function LabelManager({ appliedIds, onToggle, allowCreate = true }: LabelManagerProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Group labels by GitLab-style scope (GROUP::value). Scoped groups come first
  // (alphabetical); ungrouped labels fall to the end. `groupStart` flags the
  // first label of each group so the list can render a group header.
  const groupedLabels = useMemo(() => {
    const withScope = labels.map((l) => ({ label: l, scope: parseScopedLabel(l.name).scope }));
    withScope.sort((a, b) => {
      if (a.scope === b.scope) return a.label.name.localeCompare(b.label.name);
      if (a.scope === null) return 1;
      if (b.scope === null) return -1;
      return a.scope.localeCompare(b.scope);
    });
    return withScope.map((item, i) => ({
      ...item,
      groupStart: i === 0 || withScope[i - 1].scope !== item.scope,
    }));
  }, [labels]);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLabels()
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
  }, []);

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
      const created = await createLabel({ name, color: newColor });
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
    setPickerFor((p) => (p === id ? null : p));
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
    setPickerFor(null);
    // Optimistic recolor so the chip updates instantly.
    setLabels((cur) => cur.map((l) => (l.id === label.id ? { ...l, color } : l)));
    try {
      const updated = await updateLabel(label.id, { color });
      setLabels((cur) => cur.map((l) => (l.id === label.id ? updated : l)));
    } catch (err) {
      setLabels((cur) => cur.map((l) => (l.id === label.id ? label : l)));
      setError((err as ApiError).message || 'Failed to update label');
    }
  };

  const previewColor = HEX_RE.test(newColor) ? newColor : '#9aa3ad';

  return (
    <div className="flex flex-col gap-[10px]">
      {error && (
        <p className="rounded-[10px] border border-danger/30 bg-danger/10 px-[12px] py-[8px] text-[12px] text-danger backdrop-blur-md">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-[8px]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[44px] animate-pulse rounded-[10px] bg-white/[0.03]" />
          ))}
        </div>
      ) : labels.length === 0 ? (
        <p className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-[12px] py-[14px] text-center text-[12px] text-ink-2">
          No labels yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {groupedLabels.map(({ label, scope, groupStart }) => {
            const applied = appliedIds.includes(label.id);
            const pickerOpen = pickerFor === label.id;
            return (
              <li
                key={label.id}
                className="flex flex-col gap-[8px] rounded-[10px] border border-white/[0.06] bg-white/[0.03] px-[10px] py-[8px] backdrop-blur-md transition-colors hover:border-white/[0.12]"
              >
                {groupStart && scope && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-ink-3">
                    {scope}
                  </span>
                )}
                <div className="flex items-center gap-[8px]">
                  <button
                    type="button"
                    onClick={() => onToggle(label.id)}
                    aria-pressed={applied}
                    aria-label={`${applied ? 'Remove' : 'Apply'} label ${label.name}`}
                    className="group inline-flex min-w-0 items-center gap-[7px] rounded-[8px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <LabelChip label={label} size="md" />
                    {applied && (
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          stroke="#5e6ad2"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>

                  <div className="flex-1" />

                  {allowCreate && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPickerFor((p) => (p === label.id ? null : label.id))}
                        aria-label={`Change color of ${label.name}`}
                        aria-expanded={pickerOpen}
                        className={`flex size-[28px] shrink-0 items-center justify-center rounded-[8px] border bg-white/[0.03] transition-colors ${
                          pickerOpen
                            ? 'border-accent/40 bg-white/[0.06]'
                            : 'border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span
                          className="size-[14px] rounded-full ring-1 ring-inset ring-black/25"
                          style={{ backgroundColor: label.color }}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(label.id)}
                        aria-label={`Delete label ${label.name}`}
                        className="flex size-[28px] shrink-0 items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.03] text-ink-2 transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5.75 6.5v4M8.25 6.5v4M3.75 3.5l.55 8a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9l.55-8"
                            stroke="currentColor"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Inline recolor panel — modern swatch palette, no native picker */}
                {allowCreate && pickerOpen && (
                  <div className="rounded-[9px] border border-white/[0.06] bg-bg/60 p-[10px]">
                    <SwatchGrid current={label.color} onPick={(c) => handleRecolor(label, c)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Create new label (only in full manager mode) */}
      {allowCreate &&
        (creating ? (
          <div className="flex flex-col gap-[12px] rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-[12px] backdrop-blur-md">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Label name"
              autoFocus
              className="w-full rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-[12px] py-[8px] text-[13px] text-ink placeholder:text-ink-3 outline-none backdrop-blur-md transition-colors focus:border-accent/40 focus:bg-white/[0.05]"
            />

            <SwatchGrid current={newColor} onPick={setNewColor} />

            <div className="flex items-center gap-[10px]">
              <input
                type="text"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                aria-label="Custom hex color"
                placeholder="#rrggbb"
                spellCheck={false}
                className="w-[112px] rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[6px] font-['JetBrains_Mono'] text-[12px] text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-accent/40"
              />
              <span className="ml-auto inline-flex min-w-0">
                <LabelChip label={{ name: newName.trim() || 'preview', color: previewColor }} size="md" />
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
                className="rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[14px] py-[7px] text-[12px] font-medium text-ink-2 transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                className="kb-sheen relative overflow-hidden rounded-[9px] bg-accent px-[14px] py-[7px] text-[12px] font-bold text-bg transition-all hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add label'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-[6px] self-start rounded-[9px] border border-dashed border-white/[0.12] bg-white/[0.02] px-[12px] py-[7px] text-[12px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            New label
          </button>
        ))}
    </div>
  );
}

export default LabelManager;
