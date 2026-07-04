import { useState, useEffect, type ReactNode } from 'react';
import { ThemePicker } from './ThemePicker';
import { VpsStatsWidget } from '../VpsStatsWidget';
import type { ConnectionStatus } from './XTermTerminal';

/* ── Shared font-size bounds for every terminal screen ── */
export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 13;
export const FONT_SIZE_DEFAULT_MOBILE = 12;

function formatUptime(startMs: number): string {
  const sec = Math.floor((Date.now() - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/**
 * Standard bottom bar shared across ALL terminal screens
 * (Session, Canvas, Project Session, Project Canvas).
 *
 * Left:  connection state · CPU/RAM (VpsStatsWidget)
 * Right: uptime · theme picker · zoom controls · inline keyboard (mobile)
 *
 * The floating keyboard FAB is gone everywhere — the only special-keyboard
 * entry point is the inline `mobileKeyboard` slot in this bar.
 */
export function TerminalStatusBar({
  connectionStatus,
  sessionCreatedAt,
  sessionName,
  fontSize,
  defaultFontSize,
  themeId,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onThemeChange,
  mobileKeyboard,
  layoutControls,
}: {
  connectionStatus?: ConnectionStatus;
  sessionCreatedAt?: number | null;
  sessionName?: string;
  fontSize: number;
  defaultFontSize: number;
  themeId: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onThemeChange: (id: string) => void;
  mobileKeyboard?: ReactNode;
  layoutControls?: ReactNode;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!sessionCreatedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [sessionCreatedAt]);

  const isConnected = connectionStatus === 'connected';

  const startMs = sessionCreatedAt
    ? sessionCreatedAt > 1e12
      ? sessionCreatedAt
      : sessionCreatedAt * 1000
    : null;

  const isDefault = fontSize === defaultFontSize;

  return (
    <div className="flex shrink-0 items-center justify-between gap-[8px] border-t border-hairline bg-surface px-[12px] py-[5px] sm:px-[20px]">
      {/* Left: connection · session name · CPU/RAM */}
      <div className="flex min-w-0 items-center gap-[10px]">
        {connectionStatus && connectionStatus !== 'idle' && (
          <span className="flex shrink-0 items-center gap-[6px]">
            <span
              className={`size-[6px] rounded-full ${isConnected ? 'bg-success' : 'bg-ink-4'}`}
              style={isConnected ? { boxShadow: '0 0 5px rgba(76,183,130,0.55)' } : undefined}
            />
            <span className="mono-meta hidden text-[11px] text-ink-2 sm:inline">
              {isConnected ? 'Connected' : connectionStatus}
            </span>
          </span>
        )}
        {sessionName && (
          <span className="mono-meta hidden min-w-0 truncate text-[11px] text-ink-4 sm:inline">
            {sessionName}
          </span>
        )}
        {/* CPU/RAM — hidden on mobile to avoid bottom-bar overflow */}
        <span className="hidden sm:inline-flex">
          <VpsStatsWidget />
        </span>
      </div>

      {/* Right: uptime · theme · zoom · keyboard */}
      <div className="flex shrink-0 items-center gap-[8px]">
        {startMs && (
          <span className="mono-meta hidden text-[11px] text-ink-3 sm:block" key={tick}>
            uptime {formatUptime(startMs)}
          </span>
        )}

        {layoutControls}

        <ThemePicker themeId={themeId} onChange={onThemeChange} />

        <div className="h-[14px] w-px bg-hairline" />

        {/* Zoom controls */}
        <div className="flex items-center gap-[2px]">
          <button
            onClick={onZoomOut}
            disabled={fontSize <= FONT_SIZE_MIN}
            title="Diminuir fonte (Ctrl+-)"
            className="flex h-[20px] w-[20px] select-none items-center justify-center rounded-[3px] text-[11px] font-semibold text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            A<span className="relative top-[1px] text-[8px] leading-none">-</span>
          </button>

          <button
            onClick={onZoomReset}
            title={`Fonte: ${fontSize}px — clique para resetar (Ctrl+0)`}
            className={`flex h-[20px] min-w-[28px] select-none items-center justify-center rounded-[3px] px-[4px] font-['JetBrains_Mono'] text-[10px] transition-colors ${
              isDefault
                ? 'text-ink-4 hover:bg-white/[0.06] hover:text-ink-2'
                : 'bg-accent/12 text-accent hover:bg-accent/18'
            }`}
          >
            {fontSize}px
          </button>

          <button
            onClick={onZoomIn}
            disabled={fontSize >= FONT_SIZE_MAX}
            title="Aumentar fonte (Ctrl++)"
            className="flex h-[20px] w-[20px] select-none items-center justify-center rounded-[3px] text-[11px] font-semibold text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            A<span className="relative top-[1px] text-[8px] leading-none">+</span>
          </button>
        </div>

        {mobileKeyboard && (
          <>
            <div className="h-[14px] w-px bg-hairline" />
            {mobileKeyboard}
          </>
        )}
      </div>
    </div>
  );
}
