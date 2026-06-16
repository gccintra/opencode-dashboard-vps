import { useGlobalClipboard } from '../context/FileClipboardContext';

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9.5 4.5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <circle cx="3.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="3.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5 4.5L11.5 7 5 9.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 4.5L9 6.2M5 9.5L9 7.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function GlobalClipboardToast() {
  const { clipboard, clear } = useGlobalClipboard();

  if (!clipboard) return null;

  return (
    <div
      className="fixed z-40 flex max-w-[280px] items-center gap-2.5 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[#111118] px-3 py-2 shadow-lg
        bottom-[72px] left-1/2 -translate-x-1/2
        sm:bottom-4 sm:left-4 sm:translate-x-0"
      data-testid="global-clipboard-toast"
    >
      <span className="text-[#b3e502]">
        {clipboard.action === 'cut' ? <ScissorsIcon /> : <CopyIcon />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="max-w-[160px] truncate font-['JetBrains_Mono'] text-[12px] text-[#f0f0f0]"
          title={clipboard.fileName}
        >
          {clipboard.fileName}
        </p>
        <p className="font-['Inter'] text-[10px] text-[#9aa3ad]">Right-click a folder to paste</p>
      </div>
      <button
        onClick={clear}
        className="shrink-0 rounded-[3px] p-0.5 text-[#5a626c] transition-colors hover:text-[#9aa3ad]"
        aria-label="Clear clipboard"
        data-testid="clipboard-toast-clear"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2l8 8M10 2l-8 8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
