import type { TaskPriority } from '../../lib/api';

/** Visual config per priority level (Multica-inspired: low→amber→red ramp). */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; dot: string; text: string; tint: string; border: string }
> = {
  low: {
    label: 'Low',
    dot: '#6b7280',
    text: '#9aa3ad',
    tint: 'rgba(107,114,128,0.12)',
    border: 'rgba(107,114,128,0.35)',
  },
  medium: {
    label: 'Medium',
    dot: '#f5a623',
    text: '#f5c069',
    tint: 'rgba(245,166,35,0.12)',
    border: 'rgba(245,166,35,0.35)',
  },
  high: {
    label: 'High',
    dot: '#f5564a',
    text: '#f58a82',
    tint: 'rgba(245,86,74,0.13)',
    border: 'rgba(245,86,74,0.4)',
  },
};

export const PRIORITY_ORDER: TaskPriority[] = ['low', 'medium', 'high'];

interface PriorityBadgeProps {
  priority: TaskPriority;
  size?: 'sm' | 'md';
}

/** Compact priority pill with a coloured dot + label. */
export function PriorityBadge({ priority, size = 'sm' }: PriorityBadgeProps) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  const pad = size === 'sm' ? 'px-[6px] py-[2px] text-[10px]' : 'px-[8px] py-[3px] text-[11px]';
  return (
    <span
      className={`inline-flex items-center gap-[4px] rounded-[5px] border font-['Inter'] font-semibold ${pad}`}
      style={{ backgroundColor: meta.tint, borderColor: meta.border, color: meta.text }}
    >
      <span className="size-[5px] shrink-0 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </span>
  );
}

export default PriorityBadge;
