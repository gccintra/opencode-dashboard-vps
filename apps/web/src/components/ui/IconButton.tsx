import React from 'react';
import { cx } from './cx';

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required, icon-only buttons have no visible label. */
  'aria-label': string;
  size?: 'sm' | 'md';
}

export function IconButton({
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors duration-150',
        'hover:bg-white/[0.06] hover:text-ink',
        'focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'size-[24px]' : 'size-[28px]',
        className,
      )}
      {...rest}
    />
  );
}
