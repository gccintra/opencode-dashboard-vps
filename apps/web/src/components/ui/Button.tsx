import React from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-black hover:bg-accent-hover',
  default:
    'border border-hairline bg-surface-2 text-ink shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] hover:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
  danger:
    'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-[24px] px-[8px]',
  md: 'h-[28px] px-[12px]',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-[6px] rounded-control text-[13px] leading-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    />
  );
}
