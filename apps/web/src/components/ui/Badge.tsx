import React from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Renders a small status dot before the label. */
  dot?: boolean;
  /** Uses the mono face — for counts, IDs, and numerals. */
  mono?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-hairline bg-white/[0.06] text-ink-2',
  accent: 'border-accent/25 bg-accent/12 text-accent',
  success: 'border-success/25 bg-success/12 text-success',
  warning: 'border-warning/25 bg-warning/12 text-warning',
  danger: 'border-danger/25 bg-danger/12 text-danger',
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-3',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  mono = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-[5px] rounded-[4px] border px-[5px] py-[1px] text-[11px] leading-[1.5]',
        TONE_CLASSES[tone],
        mono && "font-['JetBrains_Mono']",
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cx('size-[6px] shrink-0 rounded-full', DOT_CLASSES[tone])}
        />
      )}
      {children}
    </span>
  );
}
