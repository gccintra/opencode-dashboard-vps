import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { FileClipboardProvider } from '../../context/FileClipboardContext';
import GlobalClipboardToast from '../GlobalClipboardToast';

function HamburgerIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <path
        d="M1 1h16M1 7h16M1 13h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AppLayout() {
  return (
    <FileClipboardProvider>
      <div className="app-vignette flex h-dvh">
        <Sidebar />
        {/* The sidebar has NO border of its own — it sits on the app shell. The
            content is a floating framed window (rounded + bordered) with a small
            gap all around, so the border reads around the whole section. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col p-[8px] lg:py-[10px] lg:pl-[4px] lg:pr-[10px]">
          {/* ── Floating menu button — mobile only. No standalone bar: each page
               owns a single sticky header and reserves a left gutter (pl-[52px])
               so this button tucks into it instead of stacking a second bar. ── */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('sidebar:open'))}
            className="absolute left-[16px] top-[16px] z-30 flex size-[32px] shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-white/[0.06] hover:text-ink active:text-ink lg:hidden"
            aria-label="Open menu"
            data-testid="hamburger-button"
          >
            <HamburgerIcon />
          </button>

          {/* ── Page content (framed window) ── */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-hairline bg-bg">
            <Outlet />
          </main>
        </div>
        <GlobalClipboardToast />
      </div>
    </FileClipboardProvider>
  );
}
