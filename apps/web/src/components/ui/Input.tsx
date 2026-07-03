import React from 'react';
import { cx } from './cx';

const FIELD_CLASSES =
  'w-full rounded-control border border-hairline bg-black/20 px-[10px] text-[13px] text-ink placeholder:text-ink-3 transition-colors duration-150 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none disabled:opacity-50';

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('h-[28px]', FIELD_CLASSES, className)} {...rest} />;
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
      className={cx('h-[28px] appearance-none', FIELD_CLASSES, className)}
      {...rest}
    >
      {/* Callers should render <option className="bg-surface-2"> children so the
          native dropdown stays dark. */}
      {children}
    </select>
  );
}
