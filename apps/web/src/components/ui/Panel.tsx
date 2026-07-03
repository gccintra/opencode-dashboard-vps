import React from 'react';
import { cx } from './cx';

type PanelPadding = 'none' | 'sm' | 'md';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: PanelPadding;
  /** Adds hover border emphasis + focus ring for clickable cards. */
  interactive?: boolean;
}

const PADDING_CLASSES: Record<PanelPadding, string> = {
  none: '',
  sm: 'p-[12px]',
  md: 'p-[16px]',
};

export function Panel({
  padding = 'none',
  interactive = false,
  className,
  ...rest
}: PanelProps) {
  return (
    <div
      className={cx(
        'rounded-panel border border-hairline bg-surface',
        PADDING_CLASSES[padding],
        interactive &&
          'cursor-pointer transition-colors duration-150 hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
        className,
      )}
      {...rest}
    />
  );
}
