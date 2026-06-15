import type { TaskLabel } from './KanbanCard';

/**
 * Compute a readable text color (#0a0a0f or #f0f0f0) for a given hex
 * background using a simple luminance check. Accepts #rgb or #rrggbb.
 */
export function labelTextColor(hex: string): string {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (c.length !== 6) return '#f0f0f0';
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0a0a0f' : '#f0f0f0';
}

interface LabelChipProps {
  label: Pick<TaskLabel, 'name' | 'color'>;
  /** Optional remove handler — renders an "x" button when provided. */
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

/** A colored project-label chip used on cards and in the task detail. */
export function LabelChip({ label, onRemove, size = 'sm' }: LabelChipProps) {
  const textColor = labelTextColor(label.color);
  const pad = size === 'md' ? 'px-[8px] py-[3px] text-[11px]' : 'px-[6px] py-[1px] text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-[4px] rounded-[4px] font-['Inter'] font-medium ${pad}`}
      style={{ backgroundColor: label.color, color: textColor }}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove label ${label.name}`}
          className="ml-[1px] inline-flex size-[12px] items-center justify-center rounded-full hover:bg-black/20"
          style={{ color: textColor }}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
            <path
              d="M1 1l6 6M7 1L1 7"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

export default LabelChip;
