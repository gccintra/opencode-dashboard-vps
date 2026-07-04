import React from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-primary font-medium',
  // Secondary — outline only, transparent fill, fills faintly on hover. Flat.
  default:
    'border border-hairline-strong bg-transparent text-ink-2 hover:bg-white/[0.05] hover:text-ink',
  ghost: 'text-ink-3 hover:bg-white/[0.05] hover:text-ink',
  danger: 'border border-danger/40 bg-transparent text-danger hover:bg-danger/10',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-[28px] px-[10px]',
  md: 'h-[34px] px-[14px]',
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
