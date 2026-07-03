import React from 'react';
import { cx } from './cx';

export interface SegmentedControlItem<V extends string = string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<V extends string = string> {
  items: SegmentedControlItem<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<V extends string = string>({
  items,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        'inline-flex items-center gap-[2px] rounded-control border border-hairline bg-black/25 p-[2px]',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cx(
              'inline-flex h-[24px] items-center gap-[5px] rounded-[4px] px-[8px] text-[12px] leading-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
              active
                ? 'bg-surface-3 text-ink shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]'
                : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
