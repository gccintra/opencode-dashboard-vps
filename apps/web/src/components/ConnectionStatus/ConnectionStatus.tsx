import { useState, useEffect, useCallback } from 'react';

/**
 * Connection status indicator displayed in the top bar.
 *
 * Monitors `navigator.onLine` (browser connectivity) and exposes a hook
 * for other components to report their WebSocket health state.
 *
 * States:
 *  - 🟢 Connected    — browser online, all known sockets healthy
 *  - 🟡 Reconnecting  — browser online but some sockets are down
 *  - 🔴 Offline       — browser entirely offline
 */

export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

const DOT_COLORS: Record<ConnectionState, string> = {
  connected: '#2d8',
  reconnecting: '#fa0',
  offline: '#f54',
};

const DOT_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

/**
 * React hook that returns the current connection status.
 * Listens to browser online/offline events and updates state.
 */
export function useConnectionStatus(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(() =>
    typeof navigator !== 'undefined' && navigator.onLine ? 'connected' : 'offline',
  );

  useEffect(() => {
    const handleOnline = () => setState('connected');
    const handleOffline = () => setState('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return state;
}

/**
 * Visual indicator component for connection status.
 * Renders a colored dot with a label. Clicking toggles a
 * tooltip showing the current state.
 */
export default function ConnectionStatus() {
  const status = useConnectionStatus();
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = useCallback(() => {
    setShowTooltip((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setShowTooltip(false);
  }, []);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-[6px] rounded-[6px] border border-white/[0.07] bg-[#111118] px-[8px] py-[4px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
        onClick={handleToggle}
        aria-label={`Connection status: ${DOT_LABELS[status]}`}
        data-testid="connection-status-button"
      >
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{
            backgroundColor: DOT_COLORS[status],
            boxShadow: `0px 0px 6px 0px ${DOT_COLORS[status]}99`,
          }}
          data-testid="connection-dot"
        />
        <span className="font-['Inter'] text-[11px] text-[#9aa3ad]">{DOT_LABELS[status]}</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <>
          {/* Backdrop to capture outside clicks */}
          <div
            className="fixed inset-0 z-40"
            onClick={handleClose}
            data-testid="connection-tooltip-backdrop"
          />

          {/* Tooltip panel */}
          <div
            className="absolute right-0 top-full z-50 mt-[6px] w-[220px] rounded-[8px] border border-white/[0.07] bg-[#16161f] p-[12px] shadow-lg"
            data-testid="connection-tooltip"
          >
            <div className="flex flex-col gap-[8px]">
              {/* Status header */}
              <div className="flex items-center gap-[8px]">
                <span
                  className="size-[8px] shrink-0 rounded-full"
                  style={{
                    backgroundColor: DOT_COLORS[status],
                    boxShadow: `0px 0px 6px 0px ${DOT_COLORS[status]}99`,
                  }}
                />
                <span className="font-['Inter'] text-[12px] font-medium text-[#f0f0f0]">
                  {DOT_LABELS[status]}
                </span>
              </div>

              {/* Status description */}
              <p className="font-['Inter'] text-[11px] leading-[16px] text-[#5a626c]">
                {status === 'connected' &&
                  'All systems operational. Terminal and agent connections are healthy.'}
                {status === 'reconnecting' &&
                  'Some connections are being restored. This is usually temporary.'}
                {status === 'offline' &&
                  'No internet connection detected. Check your network and try again.'}
              </p>

              {/* Browser info */}
              <div className="border-t border-[rgba(255,255,255,0.06)] pt-[8px]">
                <span className="font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
                  {typeof navigator !== 'undefined' && navigator.onLine
                    ? 'browser: online'
                    : 'browser: offline'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
