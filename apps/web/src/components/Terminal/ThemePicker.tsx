import { useState, useRef, useEffect, useCallback } from 'react';
import { TERMINAL_THEMES, type TerminalTheme } from '../../lib/terminalThemes';

interface ThemePickerProps {
  themeId: string;
  onChange: (id: string) => void;
  /** Direction the dropdown opens. Defaults to 'up' (above the trigger). */
  direction?: 'up' | 'down';
}

export function ThemePicker({ themeId, onChange, direction = 'up' }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = TERMINAL_THEMES.find((t) => t.id === themeId) ?? TERMINAL_THEMES[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = useCallback(
    (t: TerminalTheme) => {
      onChange(t.id);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Tema: ${current.name}`}
        className={`flex items-center gap-[5px] rounded-[3px] px-[6px] h-[20px] font-['JetBrains_Mono'] text-[10px] transition-colors select-none ${
          open
            ? 'bg-[rgba(179,229,2,0.15)] text-[rgba(179,229,2,0.9)]'
            : 'text-[rgba(179,229,2,0.45)] hover:text-[rgba(179,229,2,0.8)] hover:bg-[rgba(179,229,2,0.08)]'
        }`}
      >
        {/* Two-dot swatch */}
        <span className="flex items-center gap-[2px]">
          <span
            className="inline-block size-[7px] rounded-full"
            style={{ backgroundColor: current.preview[0], border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <span
            className="inline-block size-[7px] rounded-full"
            style={{ backgroundColor: current.preview[1] }}
          />
        </span>
        <span className="hidden sm:inline">{current.name}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={`absolute ${direction === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'} right-0 z-50 min-w-[170px] overflow-hidden rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[#111118] py-[4px] shadow-2xl`}
          style={{ backdropFilter: 'blur(8px)' }}
        >
          <p className="px-[12px] py-[6px] text-[10px] font-semibold uppercase tracking-[0.8px] text-[#5a626c]">
            Tema do terminal
          </p>
          {TERMINAL_THEMES.map((t) => {
            const isActive = t.id === themeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t)}
                className={`flex w-full items-center gap-[10px] px-[12px] py-[7px] text-left text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[rgba(179,229,2,0.1)] text-[#f0f0f0]'
                    : 'text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#f0f0f0]'
                }`}
              >
                {/* Swatch */}
                <span className="flex shrink-0 items-center gap-[3px]">
                  <span
                    className="inline-block size-[10px] rounded-[2px]"
                    style={{ backgroundColor: t.preview[0], border: '1px solid rgba(255,255,255,0.12)' }}
                  />
                  <span
                    className="inline-block size-[10px] rounded-[2px]"
                    style={{ backgroundColor: t.preview[1] }}
                  />
                </span>
                <span className="flex-1">{t.name}</span>
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#aaff00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
