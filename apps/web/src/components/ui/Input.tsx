import React from 'react';
import { cx } from './cx';

// Flat field — a faint translucent fill + hairline border, so it settles onto
// whatever surface it sits on (glass modal or solid page) instead of reading as
// a heavy block. Focus brightens the border to white (amber is signal-only).
const FIELD_CLASSES =
  'w-full rounded-control border border-hairline bg-white/[0.03] px-[11px] text-[13px] text-ink placeholder:text-ink-4 transition-colors duration-150 hover:bg-white/[0.05] focus:border-white/70 focus:bg-white/[0.04] focus:ring-1 focus:ring-white/20 focus:outline-none disabled:opacity-50';

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('h-[34px]', FIELD_CLASSES, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx('py-[6px] leading-[1.5]', FIELD_CLASSES, className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx('h-[34px] appearance-none', FIELD_CLASSES, className)}
      {...rest}
    >
      {/* Callers should render <option className="bg-surface-2"> children so the
          native dropdown stays dark. */}
      {children}
    </select>
  );
}
