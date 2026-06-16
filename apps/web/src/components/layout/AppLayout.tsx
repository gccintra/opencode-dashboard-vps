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
      <div className="flex h-dvh bg-[#0a0a0f]">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* ── Mobile top bar — hidden on lg+ (sidebar is static there) ── */}
          <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0a0a0f] px-4 lg:hidden">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('sidebar:open'))}
              className="flex size-[32px] shrink-0 items-center justify-center rounded-[6px] text-[#9aa3ad] hover:text-[#f0f0f0] active:text-[#f0f0f0]"
              aria-label="Open menu"
              data-testid="hamburger-button"
            >
              <HamburgerIcon />
            </button>
            <AlfLogo size={26} />
            <span className="flex items-baseline gap-[3px] font-['Syne'] text-[15px] font-extrabold tracking-[-0.5px]">
              <span className="text-[#f2f3f5]">ALF</span>
              <span className="text-[#b3e502]">code</span>
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
