import React, { useEffect } from 'react';
import { cx } from './cx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. Defaults to max-w-[420px]. */
  maxWidth?: string;
}

export function Modal({
  open,
  onClose,
  title,
  footer,
  children,
  maxWidth = 'max-w-[420px]',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="ui-modal-scrim"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'mx-4 w-full rounded-modal border border-hairline bg-surface-2 p-[20px] shadow-2xl',
          maxWidth,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <h3 className="mb-[12px] text-[15px] font-semibold tracking-[-0.2px] text-ink">
            {title}
          </h3>
        )}
        {children}
        {footer != null && (
          <div className="mt-[16px] flex justify-end gap-[8px]">{footer}</div>
        )}
      </div>
    </div>
  );
}
