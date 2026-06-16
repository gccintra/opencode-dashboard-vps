import type { TaskLabel } from './KanbanCard';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (c.length !== 6) return null;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
}

/**
 * Translucent `rgba()` tint derived from a label's hex color. Falls back to a
 * neutral white glass tint for invalid input. Used for the glassmorphism chip
 * fill/border.
 */
export function labelTint(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(255,255,255,${alpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

/**
 * Compute a readable text color (#0a0a0f or #f0f0f0) for a given hex
 * background using a simple luminance check. Accepts #rgb or #rrggbb.
 */
export function labelTextColor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#f0f0f0';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#0a0a0f' : '#f0f0f0';
}

/**
 * Parse a GitLab-style scoped label name. `GROUP::value` splits into
 * `{ scope: 'GROUP', value: 'value' }`; a plain name yields `scope: null`.
 * Only the first `::` is treated as the separator.
 */
export function parseScopedLabel(name: string): { scope: string | null; value: string } {
  const idx = name.indexOf('::');
  if (idx === -1) return { scope: null, value: name };
  return { scope: name.slice(0, idx).trim(), value: name.slice(idx + 2).trim() };
}

interface LabelChipProps {
  label: Pick<TaskLabel, 'name' | 'color'>;
  /** Optional remove handler — renders an "x" button when provided. */
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

function RemoveButton({ name, color, onRemove }: { name: string; color: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove label ${name}`}
      className="-mr-[1px] inline-flex size-[13px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
      style={{ color }}
    >
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
        <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * A glassmorphism project-label chip: a translucent tint of the label color
 * with a matching hairline border and color-matched text. Used on cards, in
 * the task detail, and in the label manager.
 */
export function LabelChip({ label, onRemove, size = 'sm' }: LabelChipProps) {
  const pad = size === 'md' ? 'px-[9px] py-[3px] text-[11.5px]' : 'px-[7px] py-[1.5px] text-[10px]';
  const { scope, value } = parseScopedLabel(label.name);

  // Scoped (GitLab-style) label: two-tone pill — darker scope half + lighter value half.
  if (scope) {
    const segPad = size === 'md' ? 'px-[8px] py-[3px] text-[11.5px]' : 'px-[6px] py-[1.5px] text-[10px]';
    return (
      <span
        className="inline-flex max-w-full items-center overflow-hidden rounded-[6px] border font-['Inter'] font-semibold leading-none backdrop-blur-md"
        style={{ borderColor: labelTint(label.color, 0.4), color: label.color }}
        title={label.name}
      >
        <span
          className={`truncate ${segPad}`}
          style={{ backgroundColor: labelTint(label.color, 0.26) }}
        >
          {scope}
        </span>
        <span
          className={`flex items-center gap-[4px] truncate ${segPad}`}
          style={{ backgroundColor: labelTint(label.color, 0.1) }}
        >
          {value}
          {onRemove && <RemoveButton name={label.name} color={label.color} onRemove={onRemove} />}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-[5px] rounded-[6px] border font-['Inter'] font-semibold leading-none backdrop-blur-md ${pad}`}
      style={{
        backgroundColor: labelTint(label.color, 0.12),
        borderColor: labelTint(label.color, 0.34),
        color: label.color,
      }}
    >
      <span className="truncate">{label.name}</span>
      {onRemove && <RemoveButton name={label.name} color={label.color} onRemove={onRemove} />}
    </span>
  );
}

export default LabelChip;
