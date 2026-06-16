/**
 * StatusBadge — visual indicator for session status.
 *
 * Renders a colored dot with contextual glow/pulse animations:
 *  - Green (#2d8) with glow  → active
 *  - Yellow (#fa0) with pulse → waiting
 *  - Gray (#445)              → finished
 *  - Orange/red (#f54) with ⚠️ → emergency
 *
 * Also manages document title change via Page Visibility API:
 * when a session is 'waiting' and the tab is not focused, the title
 * changes to a notification prefix.
 */

import { useEffect, useState } from 'react';
import './status.css';

export type BadgeStatus = 'active' | 'waiting' | 'finished' | 'emergency';

export interface StatusBadgeProps {
  status: BadgeStatus;
  /** Whether this is an emergency terminal session. */
  emergency?: boolean;
  /** Show the ⚠️ icon for emergency. Default true. */
  showIcon?: boolean;
  /** Size variant. Default 'sm'. */
  size?: 'sm' | 'md' | 'lg';
  /** When true, changes document title when waiting + tab unfocused. */
  notifyOnWaiting?: boolean;
}

const STATUS_COLORS: Record<BadgeStatus, string> = {
  active: '#2d8',
  waiting: '#fa0',
  finished: '#5a626c',
  emergency: '#f54',
};

const SIZE_MAP = {
  sm: { dot: 'size-[6px] rounded-[3px]', icon: 'text-[8px]' },
  md: { dot: 'size-[8px] rounded-[4px]', icon: 'text-[10px]' },
  lg: { dot: 'size-[10px] rounded-[5px]', icon: 'text-[12px]' },
};

export default function StatusBadge({
  status,
  emergency,
  showIcon = true,
  size = 'sm',
  notifyOnWaiting = false,
}: StatusBadgeProps) {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });
  const resolvedStatus: BadgeStatus = emergency ? 'emergency' : status;
  const color = STATUS_COLORS[resolvedStatus];
  const sizeClass = SIZE_MAP[size];

  const isPulse = resolvedStatus === 'waiting';
  const isActive = resolvedStatus === 'active';
  const isEmergency = resolvedStatus === 'emergency';

  // Page Visibility API — track focus
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibility = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Title change on waiting + tab not focused
  useEffect(() => {
    if (!notifyOnWaiting || typeof document === 'undefined') return;

    const originalTitle = document.title;
    if (resolvedStatus === 'waiting' && !isVisible) {
      document.title = '⏳ Aguardando — ALF code';
    } else {
      document.title = originalTitle;
    }

    return () => {
      document.title = originalTitle;
    };
  }, [resolvedStatus, isVisible, notifyOnWaiting]);

  return (
    <span className="relative inline-flex items-center" data-testid="status-badge">
      <span
        className={`inline-block shrink-0 ${sizeClass.dot} ${isPulse ? 'status-badge-pulse' : ''}`}
        style={{
          backgroundColor: color,
          boxShadow: isActive
            ? '0px 0px 5px 0px rgba(34,221,136,0.5)'
            : isEmergency
              ? '0px 0px 5px 0px rgba(255,50,80,0.6)'
              : isPulse
                ? undefined
                : 'none',
        }}
        data-testid={`status-dot-${resolvedStatus}`}
      />
      {isEmergency && showIcon && (
        <span
          className={`ml-[2px] font-['Inter'] ${sizeClass.icon} font-bold text-[#f54] leading-none`}
          aria-label="Emergency session"
          data-testid="emergency-icon"
        >
          {'⚠️'}
        </span>
      )}
    </span>
  );
}
