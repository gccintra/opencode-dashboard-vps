import type { TaskPriority } from '../../lib/api';

/** Visual config per priority level. Linear-style: neutral grays for low/medium,
   red reserved for high — no amber (keeps the palette indigo + gray + red). */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; dot: string; text: string; tint: string; border: string }
> = {
  low: {
    label: 'Low',
    dot: '#5c6069',
    text: '#8a8f98',
    tint: 'rgba(138,143,152,0.10)',
    border: 'rgba(138,143,152,0.28)',
  },
  medium: {
    label: 'Medium',
    dot: '#9096a1',
    text: '#b3b7be',
    tint: 'rgba(144,150,161,0.12)',
    border: 'rgba(144,150,161,0.32)',
  },
  high: {
    label: 'High',
    dot: '#eb5757',
    text: '#f18a8a',
    tint: 'rgba(235,87,87,0.13)',
    border: 'rgba(235,87,87,0.4)',
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
      className={`inline-flex items-center gap-[4px] rounded-[5px] border font-semibold ${pad}`}
      style={{ backgroundColor: meta.tint, borderColor: meta.border, color: meta.text }}
    >
      <span className="size-[5px] shrink-0 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </span>
  );
}

export default PriorityBadge;
