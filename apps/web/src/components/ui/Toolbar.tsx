import React from 'react';
import { cx } from './cx';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Content pushed to the right edge. */
  end?: React.ReactNode;
}

export function Toolbar({ end, className, children, ...rest }: ToolbarProps) {
  return (
    <div
      className={cx(
        'flex h-[44px] shrink-0 items-center gap-[8px] border-b border-hairline bg-bg px-[12px]',
        className,
      )}
      {...rest}
    >
      {children}
      {end != null && (
        <div className="ml-auto flex items-center gap-[8px]">{end}</div>
      )}
    </div>
  );
}
