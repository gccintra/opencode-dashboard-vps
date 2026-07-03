import { Outlet } from 'react-router-dom';
import Sidebar, { AlfLogo } from './Sidebar';
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
      <div className="flex h-dvh bg-bg">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* ── Mobile top bar — hidden on lg+ (sidebar is static there) ── */}
          <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-hairline bg-bg px-4 lg:hidden">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('sidebar:open'))}
              className="flex size-[32px] shrink-0 items-center justify-center rounded-control text-ink-2 hover:text-ink active:text-ink"
              aria-label="Open menu"
              data-testid="hamburger-button"
            >
              <HamburgerIcon />
            </button>
            <AlfLogo size={26} />
            <span className="flex items-baseline gap-[3px] text-[14px] font-semibold tracking-[-0.3px]">
              <span className="text-ink">ALF</span>
              <span className="text-accent">code</span>
            </span>
          </div>

          {/* ── Page content ── */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">
              <Outlet />
            </div>
          </main>
        </div>
        <GlobalClipboardToast />
      </div>
    </FileClipboardProvider>
  );
}
