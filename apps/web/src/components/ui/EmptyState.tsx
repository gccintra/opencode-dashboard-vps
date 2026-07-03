import React from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center px-[24px] py-[48px] text-center',
        className,
      )}
    >
      {icon != null && (
        <div className="mb-[16px] flex size-[48px] items-center justify-center rounded-panel border border-hairline bg-surface text-ink-3">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">
        {title}
      </h3>
      {description != null && (
        <p className="mt-[6px] max-w-[360px] text-[13px] leading-[1.5] text-ink-2">
          {description}
        </p>
      )}
      {action != null && <div className="mt-[16px]">{action}</div>}
    </div>
  );
}
