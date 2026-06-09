/**
 * XTermTerminal — xterm.js terminal wired to a PTY WebSocket session.
 *
 * Rendering pipeline:
 *   1. Wait for JetBrains Mono (regular + bold) to be loaded by the browser
 *      before calling terminal.open(). This prevents xterm from measuring
 *      character dimensions with a fallback font, which causes misaligned
 *      columns/rows and broken opencode TUI layout.
 *
 *   2. Create Terminal with options: block cursor, lineHeight 1.0,
 *      scrollback disabled (managed by @opentui), no EOL conversion.
 *
 *   3. Load addons: FitAddon, Unicode11Addon (activeVersion='11'),
 *      WebLinksAddon. Unicode11 is critical for correct rendering of
 *      double-width characters and Unicode block elements used by @opentui.
 *
 *   4. Mount in DOM via terminal.open(). Data arriving before open() is
 *      buffered and drained immediately after open so no ANSI sequences leak.
 *
 *   5. Run staggered fit calls (100ms, 500ms, 1500ms, 3000ms) to cover
 *      container layout settling (page load, tab switch, WS connect).
 *
 *   6. Wire WebSocket I/O (pty → terminal.write, terminal.onData → ws.send).
 *
 *   7. A separate useEffect watches socket.status and fires an extra fit
 *      whenever the WebSocket connects/reconnects — ensures the PTY always
 *      knows the true terminal dimensions.
 *
 *   8. ResizeObserver keeps cols/rows synced with parent container dimensions.
 *
 *   9. The xterm container uses absolute positioning (inset-0) inside a
 *      relative parent so it always exactly fills its parent regardless of
 *      flex/grid constraints — this is the most reliable sizing strategy.
 */

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, memo, type RefObject } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useTerminalSocket, type ConnectionError } from '../../hooks/useTerminalSocket';

/* ── Types ── */

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface XTermTerminalProps {
  sessionId: string;
  onResize?: (cols: number, rows: number) => void;
  /** Called when the backend reports a session status change. */
  onStatusChange?: (status: string) => void;
  /** Called whenever the WebSocket connection status changes. */
  onConnectionStatus?: (status: ConnectionStatus) => void;
  /** CTA shown on the 4004 "session not found" error overlay. */
  onCreateNewSession?: () => void;
  className?: string;
  /** Font size in pixels. Defaults to 14. */
  fontSize?: number;
}

/** Handle exposed to parent components via `forwardRef`. */
export interface XTermTerminalHandle {
  /** Manually trigger a WebSocket reconnect (resets the attempt counter). */
  reconnect: () => void;
  /** Force a fit + resize notification — call when the terminal becomes visible. */
  resize: () => void;
}

/* ── Colour theme ── */

const TERMINAL_THEME: ITheme = {
  background: '#1e1e2e',
  foreground: '#f0f0f0',
  cursor: '#aaff00',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(170, 255, 0, 0.25)',
  selectionForeground: '#f0f0f0',
  black: '#111118',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#6272a4',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f0f0f0',
  brightBlack: '#44475a',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
  /* Scrollbar customizada com o tema escuro */
  scrollbarSliderBackground: 'rgba(170, 255, 0, 0.15)',
  scrollbarSliderHoverBackground: 'rgba(170, 255, 0, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(170, 255, 0, 0.45)',
};

/* ── Transient status badge ── */

function StatusBadge({
  status,
  attempt,
  maxAttempts,
}: {
  status: ConnectionStatus;
  attempt?: number;
  maxAttempts?: number;
}) {
  if (status === 'connected' || status === 'error') return null;

  const config: Record<
    'idle' | 'connecting' | 'reconnecting' | 'disconnected',
    { label: string; dot: string }
  > = {
    idle: { label: 'Idle', dot: 'bg-[#44475a]' },
    connecting: { label: 'Connecting…', dot: 'bg-[#f1fa8c]' },
    reconnecting: {
      label: `Reconnecting… (${attempt ?? 0}/${maxAttempts ?? 10})`,
      dot: 'bg-[#f1fa8c] animate-pulse',
    },
    disconnected: { label: 'Disconnected', dot: 'bg-[#44475a]' },
  };

  const entry = config[status as keyof typeof config];
  if (!entry) return null;

  return (
    <div
      data-testid="xterm-status-badge"
      data-status={status}
      className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-md border border-white/10 bg-[#111118] px-2 py-1 text-[11px] font-medium text-[#f0f0f0] shadow-md"
    >
      <span className={`size-1.5 rounded-full ${entry.dot}`} />
      <span>{entry.label}</span>
    </div>
  );
}

/* ── Permanent error overlay ── */

function ErrorOverlay({
  error,
  onCreateNewSession,
  onReload,
}: {
  error: ConnectionError;
  onCreateNewSession?: () => void;
  onReload?: () => void;
}) {
  const code = error.code;
  const isSessionNotFound = code === 4004;
  const isAlreadyConnected = code === 4001;

  const title = isSessionNotFound
    ? 'Session not found'
    : isAlreadyConnected
      ? 'Session in use elsewhere'
      : 'Connection lost';

  const description = isSessionNotFound
    ? 'This session may have been closed or never existed.'
    : isAlreadyConnected
      ? 'Another tab is already connected to this session.'
      : error.message;

  return (
    <div
      data-testid="xterm-error-overlay"
      data-error-code={code ?? 'unknown'}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0a0a0f] p-6 text-center"
    >
      <span className="size-2 rounded-full bg-[#ff5555]" />
      <h2 className="text-base font-semibold text-[#f0f0f0]">{title}</h2>
      <p className="max-w-sm text-sm text-[#889]">{description}</p>
      <div className="mt-1 flex gap-2">
        {isSessionNotFound && onCreateNewSession && (
          <button
            type="button"
            onClick={onCreateNewSession}
            data-testid="xterm-error-create-new-session"
            className="rounded-md border border-[#af0] bg-[#af0] px-4 py-2 text-sm font-semibold text-[#0a0a0f] transition hover:bg-[#9e0]"
          >
            Create new session
          </button>
        )}
        {!isSessionNotFound && !isAlreadyConnected && onReload && (
          <button
            type="button"
            onClick={onReload}
            data-testid="xterm-error-reload"
            className="rounded-md border border-white/20 bg-[#111118] px-4 py-2 text-sm font-medium text-[#f0f0f0] transition hover:bg-[#1a1a23]"
          >
            Reload page
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Loading overlay ── */

function LoadingOverlay() {
  return (
    <div
      data-testid="xterm-loading-overlay"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#1e1e2e]"
    >
      <svg className="animate-spin size-5" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="rgba(170,255,0,0.2)" strokeWidth="2" />
        <path
          d="M21 12a9 9 0 00-9-9"
          stroke="#aaff00"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-['JetBrains_Mono'] text-[11px] text-[rgba(170,255,0,0.4)]">
        Connecting…
      </span>
    </div>
  );
}

/* ── Mobile keyboard FAB ── */

const MOBILE_KEYS: { label: string; seq: string; wide?: boolean }[] = [
  { label: 'ESC',    seq: '\x1b' },
  { label: 'TAB',    seq: '\t' },
  { label: 'Enter',  seq: '\r' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: '↑',      seq: '\x1b[A' },
  { label: '↓',      seq: '\x1b[B' },
  { label: '←',      seq: '\x1b[D' },
  { label: '→',      seq: '\x1b[C' },
  { label: 'Ctrl+Z', seq: '\x1a' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Ctrl+L', seq: '\x0c' },
  { label: 'Ctrl+R', seq: '\x12' },
  { label: 'PgUp',   seq: '\x1b[5~' },
  { label: 'PgDn',   seq: '\x1b[6~' },
  { label: 'Home',   seq: '\x1b[H' },
  { label: 'End',    seq: '\x1b[F' },
];

function MobileKeyboard({
  onKey,
  onCopy,
  onPaste,
  onSelectAll,
}: {
  onKey: (seq: string) => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Use a temporary off-screen <input> to relay text to the terminal.
  // Must be called from an onClick (not onPointerDown+preventDefault) so iOS
  // recognises it as a user-gesture and opens the virtual keyboard.
  const openNativeKeyboard = () => {
    const proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.setAttribute('autocomplete', 'off');
    proxy.setAttribute('autocorrect', 'off');
    proxy.setAttribute('autocapitalize', 'none');
    proxy.setAttribute('spellcheck', 'false');
    Object.assign(proxy.style, {
      position: 'fixed', top: '0', left: '0',
      width: '1px', height: '1px', opacity: '0', pointerEvents: 'none',
    });
    document.body.appendChild(proxy);

    proxy.addEventListener('input', (e) => {
      const ie = e as InputEvent;
      if (ie.inputType === 'deleteContentBackward') {
        onKey('\x7f');
      } else if (ie.inputType === 'insertLineBreak' || ie.inputType === 'insertParagraph') {
        onKey('\r');
      } else if (ie.data) {
        onKey(ie.data);
      }
      proxy.value = '';
    });

    proxy.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')     { onKey('\r');   e.preventDefault(); }
      else if (e.key === 'Tab') { onKey('\t');   e.preventDefault(); }
      else if (e.key === 'Escape') { onKey('\x1b'); }
      else if (e.key === 'Backspace' && !proxy.value) { onKey('\x7f'); }
    });

    proxy.addEventListener('blur', () => {
      setTimeout(() => { if (proxy.parentNode) proxy.parentNode.removeChild(proxy); }, 0);
    });

    proxy.focus();
    setOpen(false);
  };

  if (!isMobile) return null;

  return (
    <>
      {open && (
        <div className="absolute bottom-14 right-2 z-30 rounded-xl border border-white/10 bg-[#111118] p-2 shadow-2xl">
          {/* Text input — must be onClick so iOS opens the keyboard */}
          <button
            type="button"
            onClick={openNativeKeyboard}
            className="mb-2 w-full rounded-md px-2 py-2 text-xs font-semibold text-[#aaff00] bg-[rgba(170,255,0,0.08)] border border-[rgba(170,255,0,0.25)] active:bg-[rgba(170,255,0,0.2)] transition-colors select-none"
          >
            ⌨ Digitar texto
          </button>
          {/* Copy / Paste / Select */}
          <div className="mb-2 grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded-md px-2 py-2 text-xs font-semibold text-[#f1fa8c] bg-[rgba(241,250,140,0.06)] border border-[rgba(241,250,140,0.2)] active:bg-[rgba(241,250,140,0.15)] transition-colors select-none"
            >
              Sel. tudo
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-md px-2 py-2 text-xs font-semibold text-[#8be9fd] bg-[rgba(139,233,253,0.06)] border border-[rgba(139,233,253,0.2)] active:bg-[rgba(139,233,253,0.15)] transition-colors select-none"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={onPaste}
              className="rounded-md px-2 py-2 text-xs font-semibold text-[#8be9fd] bg-[rgba(139,233,253,0.06)] border border-[rgba(139,233,253,0.2)] active:bg-[rgba(139,233,253,0.15)] transition-colors select-none"
            >
              Colar
            </button>
          </div>
          {/* Special keys grid */}
          <div className="grid grid-cols-4 gap-1">
            {MOBILE_KEYS.map((k) => (
              <button
                key={k.label}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onKey(k.seq);
                }}
                className="rounded-md px-2 py-2 text-xs font-mono font-semibold text-[#f0f0f0] bg-[#1e1e2e] border border-white/10 active:bg-[#aaff00] active:text-[#0a0a0f] transition-colors select-none"
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label={open ? 'Fechar teclado' : 'Abrir teclado especial'}
        className={`absolute bottom-2 right-2 z-30 flex size-11 items-center justify-center rounded-full border shadow-lg transition-colors text-lg select-none ${
          open
            ? 'border-[#aaff00] bg-[#aaff00] text-[#0a0a0f]'
            : 'border-white/20 bg-[#111118] text-[#aaff00]'
        }`}
      >
        ⌨
      </button>
    </>
  );
}

/* ── Component ── */

export const XTermTerminal = memo(forwardRef<XTermTerminalHandle, XTermTerminalProps>(
  function XTermTerminal(
    {
      sessionId,
      onResize,
      onStatusChange,
      onConnectionStatus,
      onCreateNewSession,
      className,
      fontSize = 14,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastSentDims = useRef<{ cols: number; rows: number } | null>(null);
    const socket = useTerminalSocket(sessionId);

    const sendKey = useCallback((seq: string) => {
      socket.send(seq);
    }, [socket]);

    // Loading overlay: shown while the socket hasn't connected yet.
    // Reset to true on every session change so switching sessions always
    // shows the spinner instead of a flash of broken/stale terminal content.
    const [showLoader, setShowLoader] = useState(true);
    useEffect(() => { setShowLoader(true); }, [sessionId]);
    useEffect(() => {
      if (socket.status === 'connected') setShowLoader(false);
    }, [socket.status]);

    // Expose reconnect + resize to the parent.
    useImperativeHandle(ref, () => ({
      reconnect: () => socket.reconnect(),
      resize: () => {
        const container = containerRef.current;
        const fit = fitAddonRef.current;
        const term = terminalRef.current;
        if (!container || !fit || !term || container.clientWidth === 0) return;
        try { fit.fit(); } catch { return; }
        try { term.refresh(0, term.rows - 1); } catch { /* disposed */ }
        lastSentDims.current = { cols: term.cols, rows: term.rows };
        onResizeRef.current?.(term.cols, term.rows);
      },
    }), [socket]);

    // Stable callback refs — avoid re-running the mount effect on every render.
    const onResizeRef = useRef(onResize);
    const onStatusChangeRef = useRef(onStatusChange);
    const onConnectionStatusRef = useRef(onConnectionStatus);
    useEffect(() => {
      onResizeRef.current = onResize;
    }, [onResize]);
    useEffect(() => {
      onStatusChangeRef.current = onStatusChange;
    }, [onStatusChange]);
    useEffect(() => {
      onConnectionStatusRef.current = onConnectionStatus;
    }, [onConnectionStatus]);

    // Forward connection status changes to the parent.
    useEffect(() => {
      onConnectionStatusRef.current?.(socket.status);
    }, [socket.status]);

    /* ── Main terminal mount effect ── */
    useEffect(() => {
      let cancelled = false;

      // Cleanup is registered here once async setup completes.
      // The return of the effect sets cancelled=true; if setup hasn't
      // finished yet the cleanup function won't do anything extra.
      let scheduledCleanup: (() => void) | null = null;

      // ── Step 1: Wait for JetBrains Mono to be available.
      // xterm.js measures character width/height at `terminal.open()` time.
      // If the font isn't loaded yet, it falls back to the system monospace,
      // producing wrong column counts and broken opencode TUI layout.
      const FONT_LOAD_TIMEOUT_MS = 3000;
      const fontTimeout = new Promise<void>((resolve) => {
        setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
      });
      Promise.race([
        Promise.all([
          document.fonts.load(`${fontSize}px 'JetBrains Mono'`),
          document.fonts.load(`bold ${fontSize}px 'JetBrains Mono'`),
        ]),
        fontTimeout,
      ])
        .catch(() => {
          /* Font load failure is non-fatal — proceed anyway */
        })
        .then(() => {
          if (cancelled || !containerRef.current) return;

          const container = containerRef.current;

          // ── Step 2: Create terminal instance ──
          const terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize,
            lineHeight: 1.0,
            letterSpacing: 0,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
            fontWeight: '400',
            fontWeightBold: '700',
            theme: TERMINAL_THEME,
            scrollback: 0,
            convertEol: false,
            allowProposedApi: true,
            // false: Option/Alt produces the actual character (e.g. Option+Q = \
            // on Brazilian keyboards). true would intercept Option as Meta and
            // send escape sequences instead, breaking special-char input.
            macOptionIsMeta: false,
            /* ── Visual quality (xterm 6 native) ── */
            drawBoldTextInBrightColors: true,
            customGlyphs: true,
            rescaleOverlappingGlyphs: true,
            minimumContrastRatio: 4.5,
            allowTransparency: false,
            /* Performance: logging disabled in production, info in dev */
            logLevel: import.meta.env.DEV ? 'info' : 'off',
          });

          // ── Step 3: Load addons ──
          const fitAddon = new FitAddon();
          terminal.loadAddon(fitAddon);
          terminal.loadAddon(new WebLinksAddon());

          const unicode11 = new Unicode11Addon();
          terminal.loadAddon(unicode11);
          terminal.unicode.activeVersion = '11';

          // ── WebGL renderer (falls back to Canvas if unavailable) ──
          // WebGL gives pixel-perfect rendering of Unicode block elements
          // (▀ ▄ █ ░ ▒ ▓) used by @opentui for the logo and UI chrome.
          // Canvas/DOM renderers suffer from sub-pixel anti-aliasing that
          // creates horizontal gaps between adjacent block characters.
          try {
            terminal.loadAddon(new WebglAddon());
          } catch {
            // WebGL not supported — Canvas fallback is acceptable.
          }

          // ── Step 4: Start buffering socket data ──
          // The WebSocket may already be connected and receiving PTY output.
          // Buffer data until terminal.open() completes so ANSI sequences
          // don't leak into the DOM as raw text.
          let terminalReady = false;
          const pendingData: (string | Uint8Array)[] = [];
          const unsubscribeData = socket.data((data) => {
            if (terminalReady) {
              terminal.write(data);
            } else {
              pendingData.push(data);
            }
          });

          // ── Step 5: Open terminal in DOM ──
          terminal.open(container);

          // On touch devices, suppress the native virtual keyboard on tap.
          // Users open it explicitly via the MobileKeyboard FAB "Digitar" button.
          if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            const applyInputModeNone = () => {
              const ta = container.querySelector<HTMLTextAreaElement>('textarea');
              if (ta) ta.setAttribute('inputmode', 'none');
            };
            applyInputModeNone();
            // xterm may finish rendering the textarea a tick after open()
            setTimeout(applyInputModeNone, 50);
          }

          // ── Step 6: Fit BEFORE draining buffered data ──
          // For existing sessions the WebSocket may have delivered terminal state
          // into pendingData before terminal.open() was called (the socket hook
          // starts connecting earlier than the terminal setup effect). Writing that
          // content at xterm's default size (80×24) and fitting afterwards leaves
          // the TUI layout corrupted and breaks mouse-click coordinate mapping.
          // Fitting first ensures every byte is written at the correct cols×rows.
          const notifyResizeIfChanged = () => {
            // Skip when container is hidden — fitAddon.fit() would read clientWidth=0
            // and resize the PTY to 0 cols, corrupting the TUI.
            if (container.clientWidth === 0) return;
            try {
              fitAddon.fit();
            } catch {
              return; /* addon disposed */
            }
            // Force a full visual re-render — xterm (especially WebGL renderer)
            // can remain visually stale after being hidden/shown even when
            // cols/rows are unchanged. refresh() repaints every row.
            try { terminal.refresh(0, terminal.rows - 1); } catch { /* disposed */ }
            lastSentDims.current = { cols: terminal.cols, rows: terminal.rows };
            console.log(`[XTermTerminal] resize: ${terminal.cols}x${terminal.rows}`);
            onResizeRef.current?.(terminal.cols, terminal.rows);
          };
          notifyResizeIfChanged();

          // Drain buffered data at the correct terminal size.
          terminalReady = true;
          for (const chunk of pendingData) {
            terminal.write(chunk);
          }

          // Give the terminal keyboard + mouse focus so that xterm captures
          // pointer events (clicks, scroll, Option+key) and key events
          // immediately, without requiring an explicit click on the canvas first.
          terminal.focus();

          // ── Mouse tracking sync ──
          // Button events only (?1002h). Hover tracking (?1003h) is
          // intentionally disabled to avoid mouse-move escape spam in
          // terminal output when not using a TUI app.
          // • ?1002h — button + drag events
          // • ?1006h — SGR extended coordinate encoding
          const syncMouseTracking = () => {
            try {
              // ?1002h — button events only (no mouse-move spam)
              // ?1006h — SGR extended coordinate encoding
              terminal.write('\x1b[?1002h\x1b[?1006h');
            } catch {
              /* disposed */
            }
          };
          if (socket.status === 'connected') {
            syncMouseTracking();
          }

          // ── Touch event support (mobile) ──
          // xterm.js only handles mouse events. On mobile we translate:
          //   • single tap   → mousedown + mouseup on the xterm screen element
          //   • swipe up/dn  → wheel events so xterm/PTY handle scrolling
          const SWIPE_THRESHOLD = 10;
          const LONG_PRESS_MS = 600;
          let touchStartX = 0;
          let touchStartY = 0;
          let lastTouchY = 0;
          let touchMoved = false;
          let longPressTimer: ReturnType<typeof setTimeout> | null = null;

          const onTouchStart = (e: TouchEvent) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            lastTouchY = e.touches[0].clientY;
            touchMoved = false;

            // Long-press → select all visible terminal text so the user can copy it.
            // Setting touchMoved=true prevents the subsequent touchend from also
            // firing a tap (which would send a PTY mouse event and clear selection).
            longPressTimer = setTimeout(() => {
              longPressTimer = null;
              touchMoved = true;
              terminal.selectAll();
            }, LONG_PRESS_MS);
          };

          const onTouchMove = (e: TouchEvent) => {
            if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
            e.preventDefault();
            const touch = e.touches[0];
            const deltaY = lastTouchY - touch.clientY;
            lastTouchY = touch.clientY;
            if (Math.abs(touch.clientY - touchStartY) > SWIPE_THRESHOLD) {
              touchMoved = true;
            }
            const screen = container.querySelector('.xterm-screen') ?? container;
            // clientX/Y are required so xterm can compute the correct terminal
            // cell coordinates and emit the right escape sequence to the PTY.
            screen.dispatchEvent(
              new WheelEvent('wheel', {
                deltaY: deltaY * 3,
                deltaMode: WheelEvent.DOM_DELTA_PIXEL,
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: touch.clientX,
                clientY: touch.clientY,
              }),
            );
          };

          const onTouchEnd = (e: TouchEvent) => {
            if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
            // Prevent the browser from synthesising native mousedown/mouseup/click
            // events for this touch — xterm's click handler would otherwise trigger
            // word-selection. We dispatch our own controlled events instead.
            e.preventDefault();
            if (touchMoved) return;
            const touch = e.changedTouches[0];
            const screen = container.querySelector('.xterm-screen') ?? container;
            for (const type of ['mousedown', 'mouseup'] as const) {
              screen.dispatchEvent(
                new MouseEvent(type, {
                  clientX: touch.clientX,
                  clientY: touch.clientY,
                  screenX: touch.screenX,
                  screenY: touch.screenY,
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                  buttons: type === 'mousedown' ? 1 : 0,
                  view: window,
                }),
              );
            }
          };

          container.addEventListener('touchstart', onTouchStart, { passive: true });
          container.addEventListener('touchmove', onTouchMove, { passive: false });
          container.addEventListener('touchend', onTouchEnd, { passive: false });

          const t1 = setTimeout(notifyResizeIfChanged, 300);
          const t2 = setTimeout(notifyResizeIfChanged, 1000);

          terminalRef.current = terminal;
          fitAddonRef.current = fitAddon;

          // ── Step 7: Wire socket (status + input) ──
          const unsubscribeStatus = socket.onStatus((st) => onStatusChangeRef.current?.(st));
          const onDataDisposable = terminal.onData((data) => socket.send(data));

          // ── Step 8: ResizeObserver (debounced to prevent fit→resize→fit loops) ──
          // Use a time-based debounce (150ms) instead of RAF so intermediate
          // layout sizes during tab switches are never sent to the backend PTY.
          let resizeTimerId: ReturnType<typeof setTimeout> | null = null;
          const debouncedResize = () => {
            if (resizeTimerId !== null) clearTimeout(resizeTimerId);
            resizeTimerId = setTimeout(() => {
              resizeTimerId = null;
              notifyResizeIfChanged();
            }, 150);
          };
          const resizeObserver = new ResizeObserver(debouncedResize);
          resizeObserver.observe(container);

          // ── Step 9: Visibility detection — re-fit + re-render on session switch ──
          //
          // The goal is to replicate exactly what the ResizeObserver does on window
          // resize: call notifyResizeIfChanged() (which runs fit + refresh + onResize).
          //
          // The parent can hide a session in several ways:
          //   • display:none  → container.clientWidth becomes 0 → ResizeObserver fires
          //                     automatically, AND IntersectionObserver fires.
          //   • Tailwind `hidden` / `invisible` / opacity-0 / CSS class toggle
          //     applied to an ANCESTOR (not the container itself) → neither
          //     ResizeObserver nor IntersectionObserver may fire.
          //
          // Strategy: walk up to 8 ancestor levels and attach a MutationObserver to
          // each one. When any ancestor's class or style changes (the typical React
          // show/hide pattern), schedule a fit. Combined with IntersectionObserver
          // this covers every common hiding mechanism.
          let visibilityTimerId: ReturnType<typeof setTimeout> | null = null;

          const scheduleVisibilityFit = () => {
            // Debounce so rapid attribute flips (e.g. React batched updates) collapse
            // into a single fit+refresh, exactly like the ResizeObserver debounce.
            if (visibilityTimerId !== null) clearTimeout(visibilityTimerId);
            visibilityTimerId = setTimeout(() => {
              visibilityTimerId = null;
              // Always run fit+refresh when triggered by a visibility event,
              // regardless of whether dims appear to have changed — xterm's
              // WebGL renderer can stay visually stale even with stable dims.
              notifyResizeIfChanged();
            }, 50);
          };

          // IntersectionObserver: catches display:none toggled at any ancestor depth.
          const intersectionObserver = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) scheduleVisibilityFit();
              }
            },
            { threshold: 0.01 },
          );
          intersectionObserver.observe(container);

          // MutationObserver: catches class/style changes on ancestors (Tailwind
          // `hidden`, `invisible`, custom active-tab classes, inline style toggles).
          // Walking 8 levels covers even deeply nested session panel layouts.
          const mutationObserver = new MutationObserver(scheduleVisibilityFit);
          let ancestor: Element | null = container.parentElement;
          for (let depth = 0; depth < 8 && ancestor; depth++) {
            mutationObserver.observe(ancestor, {
              attributes: true,
              attributeFilter: ['class', 'style'],
              childList: false,
              subtree: false,
            });
            ancestor = ancestor.parentElement;
          }

          // ── Cleanup ──
          scheduledCleanup = () => {
            clearTimeout(t1);
            clearTimeout(t2);
            if (longPressTimer !== null) clearTimeout(longPressTimer);
            if (resizeTimerId !== null) clearTimeout(resizeTimerId);
            if (visibilityTimerId !== null) clearTimeout(visibilityTimerId);
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            mutationObserver.disconnect();
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            unsubscribeData();
            unsubscribeStatus();
            onDataDisposable.dispose();
            terminal.dispose();
            terminalRef.current = null;
            fitAddonRef.current = null;
          };

          // If the effect was already cleaned up before font loaded, run
          // cleanup immediately.
          if (cancelled) scheduledCleanup();
        });

      return () => {
        cancelled = true;
        scheduledCleanup?.();
      };
      // socket.data / socket.send are stable; fontSize excluded (handled below).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // Sync font size change without recreating the terminal.
    useEffect(() => {
      const term = terminalRef.current;
      const fit = fitAddonRef.current;
      if (!term || !fit) return;
      if (term.options.fontSize === fontSize) return;
      term.options.fontSize = fontSize;
      fit.fit();
      // Font size change always changes cols/rows — send to server.
      lastSentDims.current = { cols: term.cols, rows: term.rows };
      onResizeRef.current?.(term.cols, term.rows);
    }, [fontSize]);

    // Fire a fit+refresh+mouse-sync whenever the WebSocket (re)connects so the
    // PTY always knows the true terminal dimensions and mouse tracking is active.
    useEffect(() => {
      if (socket.status !== 'connected') return;
      const fit = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fit || !term) return;
      const t = setTimeout(() => {
        try {
          fit.fit();
        } catch {
          return; /* addon disposed */
        }
        try { term.refresh(0, term.rows - 1); } catch { /* disposed */ }
        // Re-sync mouse tracking: button events only, no hover spam
        try { term.write('\x1b[?1002h\x1b[?1006h'); } catch { /* disposed */ }
        lastSentDims.current = { cols: term.cols, rows: term.rows };
        console.log(`[XTermTerminal] WS reconnect resize: ${term.cols}x${term.rows}`);
        onResizeRef.current?.(term.cols, term.rows);
      }, 100);
      return () => clearTimeout(t);
    }, [socket.status]);

    return (
      // Outer wrapper: relative so the absolute container and overlays are positioned correctly.
      // flex-1 + min-h-0 ensures it fills the available space in a flex column.
      <div className={`relative h-full min-h-0 w-full overflow-hidden ${className ?? ''}`}>
        {/* Loading overlay: covers the terminal until the socket is connected,
            preventing a flash of broken/unsized terminal content on session switch. */}
        {showLoader && socket.status !== 'error' && <LoadingOverlay />}

        {/* Status badge only shown after the initial connection (not during boot). */}
        {!showLoader && (
          <StatusBadge
            status={socket.status}
            attempt={socket.attempt}
            maxAttempts={socket.maxAttempts}
          />
        )}

        {socket.status === 'error' && socket.error && (
          <ErrorOverlay
            error={socket.error}
            onCreateNewSession={onCreateNewSession}
            onReload={() => window.location.reload()}
          />
        )}
        {/* absolute inset-0 guarantees the container always fills its parent
            exactly, regardless of flex/grid context. FitAddon measures this
            element to compute cols/rows. */}
        <div
          ref={containerRef}
          data-testid="xterm-container"
          className="absolute inset-0 [contain:strict]"
        />

        {/* Mobile-only floating keyboard button */}
        <MobileKeyboard
          onKey={sendKey}
          onSelectAll={() => terminalRef.current?.selectAll()}
          onCopy={() => {
            const sel = terminalRef.current?.getSelection() ?? '';
            if (sel) navigator.clipboard.writeText(sel).catch(() => {});
          }}
          onPaste={() => {
            navigator.clipboard.readText().then((text) => {
              if (text) socket.send(text);
            }).catch(() => {});
          }}
        />
      </div>
    );
  },
));
