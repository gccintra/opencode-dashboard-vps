/**
 * XTermTerminal — xterm.js terminal wired to a PTY WebSocket session.
 *
 * Rendering pipeline:
 *   1. Wait for JetBrains Mono (regular + bold) to be loaded by the browser
 *      before calling terminal.open(). This prevents xterm from measuring
 *      character dimensions with a fallback font, which causes misaligned
 *      columns/rows and broken opencode TUI layout.
 *
 *   2. Create Terminal with options: block cursor, lineHeight 1.2,
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

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  memo,
} from 'react';
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
  /** xterm.js colour theme. Hot-swapped without recreating the terminal. */
  theme?: ITheme;
}

/** Handle exposed to parent components via `forwardRef`. */
export interface XTermTerminalHandle {
  /** Manually trigger a WebSocket reconnect (resets the attempt counter). */
  reconnect: () => void;
  /** Force a fit + resize notification — call when the terminal becomes visible. */
  resize: () => void;
  /** Focus the terminal textarea — brings up the keyboard on mobile. */
  focus: () => void;
  /** Open the native mobile keyboard via a proxy input and forward typed text to the terminal. */
  openKeyboard: () => void;
  /** Send a raw key sequence to the terminal's PTY. */
  sendKey: (seq: string) => void;
  /** Select all text in the terminal. */
  selectAll: () => void;
  /** Get the current text selection. */
  getSelection: () => string;
  /** Return current terminal cols/rows, or null if terminal not yet initialised. */
  getDims: () => { cols: number; rows: number } | null;
}

/* ── Colour theme ── */

const TERMINAL_THEME: ITheme = {
  background: '#1e1e2e',
  foreground: '#f0f0f0',
  cursor: '#aaff00',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(179,229,2, 0.25)',
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
  scrollbarSliderBackground: 'rgba(179,229,2, 0.15)',
  scrollbarSliderHoverBackground: 'rgba(179,229,2, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(179,229,2, 0.45)',
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
      <p className="max-w-sm text-sm text-[#9aa3ad]">{description}</p>
      <div className="mt-1 flex gap-2">
        {isSessionNotFound && onCreateNewSession && (
          <button
            type="button"
            onClick={onCreateNewSession}
            data-testid="xterm-error-create-new-session"
            className="rounded-md border border-[#b3e502] bg-[#b3e502] px-4 py-2 text-sm font-semibold text-[#0a0a0f] transition hover:bg-[#c2f516]"
          >
            Create new session
          </button>
        )}
        {!isSessionNotFound && !isAlreadyConnected && onReload && (
          <button
            type="button"
            onClick={onReload}
            data-testid="xterm-error-reload"
            className="rounded-md border border-white/20 bg-[#111118] px-4 py-2 text-sm font-medium text-[#f0f0f0] transition hover:bg-[#0a0a0f]"
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
        <circle cx="12" cy="12" r="9" stroke="rgba(179,229,2,0.2)" strokeWidth="2" />
        <path d="M21 12a9 9 0 00-9-9" stroke="#aaff00" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="font-['JetBrains_Mono'] text-[11px] text-[rgba(179,229,2,0.4)]">
        Connecting…
      </span>
    </div>
  );
}

/* ── Mobile keyboard FAB ── */

const MOBILE_KEYS: { label: string; seq: string; wide?: boolean }[] = [
  { label: 'ESC', seq: '\x1b' },
  { label: 'TAB', seq: '\t' },
  { label: 'Enter', seq: '\r' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: 'Ctrl+Z', seq: '\x1a' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Ctrl+L', seq: '\x0c' },
  { label: 'Ctrl+R', seq: '\x12' },
  { label: 'PgUp', seq: '\x1b[5~' },
  { label: 'PgDn', seq: '\x1b[6~' },
  { label: 'Home', seq: '\x1b[H' },
  { label: 'End', seq: '\x1b[F' },
];

export function MobileKeyboard({
  onKey,
  onCopy,
  onPaste,
  onSelectAll,
  onUpload,
  inline = false,
}: {
  onKey: (seq: string) => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onUpload?: (file: File) => void;
  /** When true, renders as an inline button (for footer bars). Popup opens upward via absolute positioning relative to the wrapper. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
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
      if (e.key === 'Enter') {
        onKey('\r');
        e.preventDefault();
      } else if (e.key === 'Tab') {
        onKey('\t');
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onKey('\x1b');
      } else if (e.key === 'Backspace' && !proxy.value) {
        onKey('\x7f');
      }
    });

    proxy.addEventListener('blur', () => {
      setTimeout(() => {
        if (proxy.parentNode) proxy.parentNode.removeChild(proxy);
      }, 0);
    });

    proxy.focus();
    setOpen(false);
  };

  if (!isMobile) return null;

  const panel = open && (
    <div
      className={`${inline ? 'absolute bottom-full right-0 mb-[6px] min-w-[280px]' : 'absolute bottom-14 right-2 min-w-[280px]'} z-30 rounded-xl border border-white/10 bg-[#111118] p-3 shadow-2xl`}
    >
      {/* Text input — must be onClick so iOS opens the keyboard */}
      <button
        type="button"
        onClick={openNativeKeyboard}
        className="mb-2 w-full rounded-md px-3 py-[10px] text-sm font-semibold text-[#aaff00] bg-[rgba(170,255,0,0.08)] border border-[rgba(170,255,0,0.25)] active:bg-[rgba(170,255,0,0.2)] transition-colors select-none"
      >
        ⌨ Digitar texto
      </button>
      {/* File upload — opens native file picker; path sent to PTY after server upload */}
      <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-[10px] text-sm font-semibold text-[#bd93f9] bg-[rgba(189,147,249,0.06)] border border-[rgba(189,147,249,0.25)] active:bg-[rgba(189,147,249,0.15)] transition-colors select-none">
        📎 Enviar arquivo
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUpload?.(file);
              e.target.value = '';
              setOpen(false);
            }
          }}
        />
      </label>
      {/* Copy / Paste / Select */}
      <div className="mb-3 grid grid-cols-3 gap-[6px]">
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-md px-2 py-[10px] text-sm font-semibold text-[#f1fa8c] bg-[rgba(241,250,140,0.06)] border border-[rgba(241,250,140,0.2)] active:bg-[rgba(241,250,140,0.15)] transition-colors select-none"
        >
          Sel. tudo
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md px-2 py-[10px] text-sm font-semibold text-[#8be9fd] bg-[rgba(139,233,253,0.06)] border border-[rgba(139,233,253,0.2)] active:bg-[rgba(139,233,253,0.15)] transition-colors select-none"
        >
          Copiar
        </button>
        <button
          type="button"
          onClick={onPaste}
          className="rounded-md px-2 py-[10px] text-sm font-semibold text-[#8be9fd] bg-[rgba(139,233,253,0.06)] border border-[rgba(139,233,253,0.2)] active:bg-[rgba(139,233,253,0.15)] transition-colors select-none"
        >
          Colar
        </button>
      </div>
      {/* Special keys grid */}
      <div className="grid grid-cols-4 gap-[6px]">
        {MOBILE_KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onKey(k.seq);
            }}
            className="rounded-md px-2 py-[10px] text-sm font-mono font-semibold text-[#f0f0f0] bg-[#1e1e2e] border border-white/10 active:bg-[#aaff00] active:text-[#0a0a0f] transition-colors select-none"
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="relative shrink-0">
        {panel}
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            setOpen((v) => !v);
          }}
          aria-label={open ? 'Fechar teclado' : 'Abrir teclado especial'}
          className={`flex items-center justify-center h-[20px] w-[20px] rounded-[3px] text-sm transition-colors select-none ${
            open
              ? 'text-[#b3e502] bg-[rgba(179,229,2,0.15)]'
              : 'text-[rgba(179,229,2,0.5)] hover:text-[rgba(179,229,2,0.9)] hover:bg-[rgba(179,229,2,0.1)]'
          }`}
        >
          ⌨
        </button>
      </div>
    );
  }

  return (
    <>
      {panel}
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
            : 'border-white/20 bg-[#111118] text-[#b3e502]'
        }`}
      >
        ⌨
      </button>
    </>
  );
}

/* ── Clipboard helper ── */

function _execCommandCopy(text: string, onDone?: () => void): void {
  const el = document.createElement('textarea');
  // normalize('NFC') ensures canonical Unicode form (avoids corruption on some platforms)
  el.value = String(text).normalize('NFC');
  Object.assign(el.style, {
    position: 'fixed',
    left: '-9999px',
    top: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    fontSize: '12pt',
  });
  document.body.appendChild(el);
  // Restore focus after copy so xterm keeps receiving keystrokes.
  const prevActive = document.activeElement as HTMLElement | null;
  el.focus({ preventScroll: true });
  el.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    /* ignore */
  }
  document.body.removeChild(el);
  if (prevActive && prevActive !== document.body) {
    prevActive.focus({ preventScroll: true });
  }
  if (ok) onDone?.();
}

/**
 * Copy text to clipboard.
 *
 * Primary: navigator.clipboard.writeText — native Unicode support, avoids
 * known execCommand issues with non-ASCII on iOS Safari (accented chars,
 * Unicode block elements). Falls back to execCommand if the Clipboard API
 * is unavailable or fails (document not focused, permission denied).
 */
function writeClipboard(text: string, onDone?: () => void): void {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(onDone)
      .catch(() => {
        _execCommandCopy(text, onDone);
      });
    return;
  }
  _execCommandCopy(text, onDone);
}

/* ── Context menu ── */

/* ── Copied toast ── */

function CopiedToast() {
  return (
    <div className="pointer-events-none absolute top-[10px] left-1/2 z-30 -translate-x-1/2 rounded-[6px] border border-[rgba(179,229,2,0.25)] bg-[#111118] px-[12px] py-[6px] font-['Inter'] text-[12px] font-medium text-[#b3e502] shadow-lg">
      Copiado!
    </div>
  );
}

/* ── Component ── */

export const XTermTerminal = memo(
  forwardRef<XTermTerminalHandle, XTermTerminalProps>(function XTermTerminal(
    {
      sessionId,
      onResize,
      onStatusChange,
      onConnectionStatus,
      onCreateNewSession,
      className,
      fontSize = 14,
      theme,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastSentDims = useRef<{ cols: number; rows: number } | null>(null);
    const socket = useTerminalSocket(sessionId);

    const sendKey = useCallback(
      (seq: string) => {
        socket.send(seq);
      },
      [socket],
    );

    // Brief "Copiado!" feedback toast
    const [showCopied, setShowCopied] = useState(false);

    const flashCopied = useCallback(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 1500);
    }, []);

    // Clipboard image upload feedback
    const [imageUploadStatus, setImageUploadStatus] = useState<'idle' | 'uploading' | 'error'>(
      'idle',
    );
    const flashImageUpload = useCallback((ok: boolean) => {
      setImageUploadStatus(ok ? 'idle' : 'error');
      if (!ok) setTimeout(() => setImageUploadStatus('idle'), 2000);
    }, []);

    // Shared helper: upload a File to /tmp via upload-temp, then send the path to the PTY.
    const uploadFileAndSend = useCallback(async (file: File) => {
      setImageUploadStatus('uploading');
      const token = localStorage.getItem('auth_token');
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/files/upload-temp', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (res.ok) {
          const data = await res.json() as { path: string };
          socket.send(data.path);
          setImageUploadStatus('idle');
        } else {
          flashImageUpload(false);
        }
      } catch {
        flashImageUpload(false);
      }
    }, [socket, flashImageUpload]);

    // Image-aware paste for mobile keyboard button. Uses navigator.clipboard.read()
    // (requires user gesture — onClick qualifies) to detect images; falls back to
    // readText() for plain text.
    const handleMobilePaste = useCallback(() => {
      (async () => {
        try {
          if (navigator.clipboard?.read) {
            const clipItems = await navigator.clipboard.read();
            for (const clipItem of clipItems) {
              const imageType = clipItem.types.find((t) => t.startsWith('image/'));
              if (imageType) {
                const blob = await clipItem.getType(imageType);
                const ext =
                  imageType === 'image/png' ? '.png'
                  : imageType === 'image/jpeg' ? '.jpg'
                  : imageType === 'image/webp' ? '.webp'
                  : imageType === 'image/gif' ? '.gif'
                  : '.png';
                await uploadFileAndSend(new File([blob], `paste${ext}`, { type: imageType }));
                return;
              }
            }
          }
        } catch { /* clipboard.read not available or permission denied */ }
        // No image found — fall back to plain text
        navigator.clipboard.readText().then((text) => {
          if (text) socket.send(text);
        }).catch(() => {});
      })();
    }, [socket, uploadFileAndSend]);

    // Loading overlay: shown until xterm.js is fully initialised (font loaded +
    // terminal.open() + flushBuffer() complete). Reset on every session change.
    const [terminalReady, setTerminalReady] = useState(false);
    useEffect(() => {
      setTerminalReady(false);
    }, [sessionId]);

    // Expose reconnect + resize + focus to the parent.
    useImperativeHandle(
      ref,
      () => ({
        reconnect: () => socket.reconnect(),
        resize: () => {
          const container = containerRef.current;
          const fit = fitAddonRef.current;
          const term = terminalRef.current;
          if (!container || !fit || !term || container.clientWidth === 0) return;
          try {
            fit.fit();
          } catch {
            return;
          }
          try {
            term.refresh(0, term.rows - 1);
          } catch {
            /* disposed */
          }
          lastSentDims.current = { cols: term.cols, rows: term.rows };
          onResizeRef.current?.(term.cols, term.rows);
          // Second SIGWINCH after the debounce window clears. If opencode was
          // busy during the first one (e.g., rendering its startup screen), the
          // second guarantees a re-render at the correct viewport dimensions.
          setTimeout(() => {
            const f = fitAddonRef.current;
            const t = terminalRef.current;
            if (!f || !t) return;
            try { f.fit(); } catch { return; }
            lastSentDims.current = { cols: t.cols, rows: t.rows };
            onResizeRef.current?.(t.cols, t.rows);
          }, 400);
        },
        focus: () => {
          const term = terminalRef.current;
          if (term) {
            term.focus();
            return;
          }
          const ta = containerRef.current?.querySelector<HTMLTextAreaElement>('textarea');
          ta?.focus({ preventScroll: true });
        },
        openKeyboard: () => {
          const proxy = document.createElement('input');
          proxy.type = 'text';
          proxy.setAttribute('autocomplete', 'off');
          proxy.setAttribute('autocorrect', 'off');
          proxy.setAttribute('autocapitalize', 'none');
          proxy.setAttribute('spellcheck', 'false');
          Object.assign(proxy.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '1px',
            height: '1px',
            opacity: '0',
            pointerEvents: 'none',
          });
          document.body.appendChild(proxy);
          proxy.addEventListener('input', (e) => {
            const ie = e as InputEvent;
            if (ie.inputType === 'deleteContentBackward') sendKey('\x7f');
            else if (ie.inputType === 'insertLineBreak' || ie.inputType === 'insertParagraph')
              sendKey('\r');
            else if (ie.data) sendKey(ie.data);
            proxy.value = '';
          });
          proxy.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              sendKey('\r');
              e.preventDefault();
            } else if (e.key === 'Tab') {
              sendKey('\t');
              e.preventDefault();
            } else if (e.key === 'Escape') {
              sendKey('\x1b');
            } else if (e.key === 'Backspace' && !proxy.value) {
              sendKey('\x7f');
            }
          });
          proxy.addEventListener('blur', () => {
            setTimeout(() => {
              if (proxy.parentNode) proxy.parentNode.removeChild(proxy);
            }, 0);
          });
          proxy.focus();
        },
        sendKey,
        selectAll: () => terminalRef.current?.selectAll(),
        getSelection: () => terminalRef.current?.getSelection() ?? '',
        getDims: () => {
          const term = terminalRef.current;
          if (!term) return null;
          return { cols: term.cols, rows: term.rows };
        },
      }),
      [socket, sendKey],
    );

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

      // ── Pre-step: Subscribe to socket data BEFORE font loading ──
      // The WebSocket connects immediately and the server sends the session
      // buffer as soon as the WS opens (buffer replay). If we subscribe
      // inside the font-load .then(), data arriving during font loading
      // (up to 3s) is silently dropped — causing a blank terminal on first
      // load that only recovers after a manual resize/reconnect.
      // Subscribing here captures all data into pendingData; it is drained
      // into the terminal after terminal.open() and fit() complete.
      let terminalReady = false;
      const pendingData: (string | Uint8Array)[] = [];
      // Track whether the first post-flush data chunk has been rendered so we
      // can force an explicit refresh() on it. xterm's internal rAF repaint can
      // lag on cold WebGL startup; a synchronous refresh() here guarantees the
      // buffer-replay data is visible without waiting for a keypress or resize.
      let firstLiveWrite = true;
      const unsubscribeData = socket.data((data) => {
        if (terminalReady && terminalRef.current) {
          terminalRef.current.write(data);
          if (firstLiveWrite) {
            firstLiveWrite = false;
            try { terminalRef.current.refresh(0, terminalRef.current.rows - 1); } catch { /* disposed */ }
          }
        } else {
          pendingData.push(data);
        }
      });

      // ── Step 1: Wait for JetBrains Mono to be available.
      // xterm.js measures character width/height at `terminal.open()` time.
      // If the font isn't loaded yet, it falls back to the system monospace,
      // producing wrong column counts and broken opencode TUI layout.
      // Must be generous: xterm measures char width at open() time, so opening
      // before JetBrains Mono loads (slow mobile cold start) uses the wider
      // fallback font → fewer cols → empty vertical strip on the right.
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
            lineHeight: 1.2,
            letterSpacing: 0,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
            fontWeight: '400',
            fontWeightBold: '700',
            theme: theme ?? TERMINAL_THEME,
            // 0 is correct for TUI apps (opencode/Claude Code use the alternate
            // screen + manage their own scroll). It also makes FitAddon use
            // scrollbarWidth=0, so cols fill the full container width — a non-zero
            // scrollback makes FitAddon subtract a scrollbar gutter, leaving an
            // empty vertical strip on the right.
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
            minimumContrastRatio: 1,
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

          // ── Step 4: Open terminal in DOM ──
          // pendingData is already accumulating (subscribed before font load).
          terminal.open(container);

          // ── WebGL renderer (must load AFTER terminal.open()) ──
          // WebGL gives pixel-perfect rendering of Unicode block elements
          // (▀ ▄ █ ░ ▒ ▓) used by @opentui for the logo and UI chrome.
          // IMPORTANT: WebglAddon must be loaded after terminal.open() so the
          // WebGL context is created with the correct DOM dimensions and
          // devicePixelRatio. Loading before open() causes the canvas to be
          // initialized at wrong resolution → pixelated blocks on resize.
          let webglWarmupTimer: ReturnType<typeof setTimeout> | null = null;
          try {
            terminal.loadAddon(new WebglAddon());
            // WebGL shaders compile asynchronously (~300ms cold-start). Any
            // terminal.write() during this window is queued but never painted
            // until the next user interaction triggers a repaint. Force an
            // explicit refresh at 350ms so the TUI appears without needing a
            // keypress from the user.
            webglWarmupTimer = setTimeout(() => {
              try { terminal.refresh(0, terminal.rows - 1); } catch { /* disposed */ }
            }, 350);
          } catch {
            // WebGL not supported — Canvas fallback is acceptable.
          }

          // ── OSC 52 clipboard handler ──
          // TUI apps (opencode, Claude Code) use OSC 52 to write to the terminal
          // clipboard: \x1b]52;c;<base64text>\x07. xterm.js receives the sequence
          // but does NOT forward it to the browser clipboard by default. We register
          // a handler here so that any OSC 52 write from the PTY reaches the user's
          // system clipboard via the Clipboard API.
          terminal.parser.registerOscHandler(52, (data) => {
            const semi = data.indexOf(';');
            if (semi === -1) return false;
            const b64 = data.slice(semi + 1);
            if (!b64 || b64 === '?') return false; // ignore read-requests
            try {
              // atob() returns a binary (latin1) string. Decode as UTF-8 so
              // accented chars and Unicode block elements are preserved.
              const binary = atob(b64);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              const text = new TextDecoder('utf-8').decode(bytes);
              if (text) writeClipboard(text, flashCopied);
            } catch {
              /* ignore malformed base64 */
            }
            return true; // consumed — don't let xterm process it further
          });

          // ── Copy/paste wiring ──
          //
          // IMPORTANT: With mouse tracking enabled (?1002h), normal drag sends
          // mouse events to the PTY app, not xterm selection. To select text
          // while tracking is active the user must hold Shift while dragging.
          //
          // Key bindings (intercepted before xterm processes them):
          //   Ctrl+C  with selection → copy (don't send \x03 interrupt)
          //   Ctrl+C  without selection → normal interrupt (passes through)
          //   Ctrl+Shift+C → copy selection
          //   Ctrl+Shift+V → paste from clipboard
          terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (e.type !== 'keydown') return true;
            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return true;

            // Ctrl+Shift+C — copy (always)
            if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
              const sel = terminal.getSelection();
              if (sel) writeClipboard(sel, flashCopied);
              return false;
            }

            // Ctrl+V — let the browser fire its native paste event; onNativePaste
            // (document-level capture below) intercepts it before xterm's textarea
            // listener and handles both images and plain text.
            if (!e.shiftKey && (e.key === 'v' || e.key === 'V')) {
              return false;
            }

            // Ctrl+Shift+V — text-only paste. Ctrl+Shift+V does NOT fire a native
            // paste event in Chrome/Firefox, so we must read the clipboard explicitly
            // here. e.preventDefault() suppresses any browser paste fallback to avoid
            // a second path if some browsers DO fire paste for Ctrl+Shift+V.
            if (e.shiftKey && (e.key === 'V' || e.key === 'v')) {
              e.preventDefault();
              navigator.clipboard.readText().then((text) => {
                if (text) socket.send(text);
              }).catch(() => {});
              return false;
            }

            // Ctrl+C — copy if there's a selection, otherwise pass through as interrupt
            if (!e.shiftKey && (e.key === 'c' || e.key === 'C')) {
              const sel = terminal.getSelection();
              if (sel) {
                writeClipboard(sel, flashCopied);
                return false; // don't also send \x03
              }
              // no selection → let xterm send the interrupt
            }

            return true;
          });

          // Auto-copy on mouseup — fires synchronously inside a user-gesture
          // event handler, so execCommand/Clipboard API both work on all
          // browsers (Chrome, Firefox, Safari). xterm finalises its selection
          // on mouseup, so getSelection() is accurate here. Works for both
          // normal drag (when mouse tracking is off) and Shift+drag (the only
          // way to select text while a TUI app has ?1002h mouse tracking on,
          // e.g. Claude Code / opencode).
          // isTrusted=false means this mouseup was dispatched synthetically (e.g. by
          // our touch→mouse translation code). We only auto-copy on real user events;
          // touch drag selection is handled explicitly in onTouchEnd.
          const onMouseUp = (e: MouseEvent) => {
            if (!e.isTrusted) return;
            const sel = terminal.getSelection();
            if (sel) writeClipboard(sel, flashCopied);
          };
          container.addEventListener('mouseup', onMouseUp);

          // Auto-copy on selection change — covers edge cases where selection
          // is created without a mouseup (e.g. keyboard-driven selection,
          // programmatic select). Uses async Clipboard API which works on
          // Chrome when the page is focused (clipboard-write is auto-granted).
          let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null;
          const selectionDisposable = terminal.onSelectionChange(() => {
            if (selectionCopyTimer !== null) clearTimeout(selectionCopyTimer);
            selectionCopyTimer = setTimeout(() => {
              selectionCopyTimer = null;
              const sel = terminal.getSelection();
              if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
            }, 300);
          });

          // Right-click / long-press handler.
          // No popup — selection + copy happens automatically:
          //   • If there's already a selection, copy it immediately.
          //   • Otherwise dispatch a dblclick to select the word under the pointer,
          //     wait one frame for xterm to finalise it, then copy.
          //   • If the finger is still down (touchActive), enter drag-to-extend mode
          //     so subsequent touchmove events extend the selection.
          let touchActive = false;
          const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            if (longPressTimer !== null) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }

            const existing = terminal.getSelection();
            if (existing && !touchActive) {
              writeClipboard(existing, flashCopied);
              return;
            }

            // Haptic feedback so the user knows the long-press was recognised.
            if (touchActive && 'vibrate' in navigator) {
              try {
                navigator.vibrate(50);
              } catch {
                /* ignore */
              }
            }

            // selectWordAtPoint runs synchronously inside a contextmenu event
            // (user-gesture context), so writeClipboard via execCommand works.
            const sel = selectWordAtPoint(e.clientX, e.clientY);
            if (touchActive) {
              touchMoved = true;
              isSelectionDrag = true;
              if (sel) writeClipboard(sel, flashCopied);
            } else if (sel) {
              writeClipboard(sel, flashCopied);
            }
          };
          container.addEventListener('contextmenu', onContextMenu);

          // Native copy event — catches browser-level Ctrl+C / Edit→Copy when
          // the xterm textarea has focus, and forwards xterm's selection instead
          // of whatever the browser thinks is selected (which is nothing, since
          // xterm uses canvas, not DOM text nodes).
          const onNativeCopy = (e: ClipboardEvent) => {
            const active = document.activeElement;
            if (!container.contains(active)) return;
            const sel = terminal.getSelection();
            if (!sel) return;
            e.preventDefault();
            e.clipboardData?.setData('text/plain', sel);
            flashCopied();
          };
          document.addEventListener('copy', onNativeCopy);

          // Paste event handler — intercepts ALL paste events (Ctrl+V, Ctrl+Shift+V,
          // context-menu paste) when the xterm terminal has focus.
          //
          // WHY document-level capture + stopImmediatePropagation:
          // xterm.js v6 registers paste listeners on both its internal textarea AND
          // its wrapper element (both bubble phase). A container-level capture with
          // stopPropagation() should theoretically block them, but in practice some
          // browsers deliver the paste event to xterm before our handler can stop it
          // (e.g. if activeElement check fails or there's a capture-phase race).
          // Attaching at document capture phase is the earliest possible interception
          // point; stopImmediatePropagation() kills ALL subsequent handlers globally,
          // guaranteeing xterm never sees the event.
          //
          // Focus guard: track via focusin/focusout on the container (bubbles from
          // any child including xterm's hidden textarea). More reliable than
          // document.activeElement which can be transiently null during key events.
          let xtermFocused = false;
          const onContainerFocusIn = () => { xtermFocused = true; };
          const onContainerFocusOut = () => { xtermFocused = false; };
          container.addEventListener('focusin', onContainerFocusIn);
          container.addEventListener('focusout', onContainerFocusOut);

          const onNativePaste = (e: ClipboardEvent) => {
            if (!xtermFocused) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            (async () => {
              // Image check via DataTransferItemList (no clipboard-read permission needed)
              const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
              const imageItem = items.find((it) => it.type.startsWith('image/'));
              if (imageItem) {
                const blob = imageItem.getAsFile();
                if (blob) {
                  setImageUploadStatus('uploading');
                  const token = localStorage.getItem('auth_token');
                  const form = new FormData();
                  const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : blob.type === 'image/gif' ? '.gif' : '.png';
                  form.append('file', new File([blob], `paste${ext}`, { type: blob.type }));
                  try {
                    const res = await fetch('/api/files/upload-temp', {
                      method: 'POST',
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                      body: form,
                    });
                    if (res.ok) {
                      const data = await res.json() as { path: string };
                      socket.send(data.path);
                      setImageUploadStatus('idle');
                    } else {
                      flashImageUpload(false);
                    }
                  } catch {
                    flashImageUpload(false);
                  }
                  return;
                }
              }
              // Text fallback
              const text = e.clipboardData?.getData('text/plain');
              if (text) socket.send(text);
            })();
          };
          document.addEventListener('paste', onNativePaste, true); // document-level capture

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

          // ── Step 4b: Fit + deferred buffer drain ──
          // Set refs now so external callers (resize(), focus()) work immediately
          // even though the buffer hasn't been drained yet.
          terminalRef.current = terminal;
          fitAddonRef.current = fitAddon;

          const notifyResizeIfChanged = () => {
            if (container.clientWidth === 0) return;
            try {
              fitAddon.fit();
            } catch {
              return; /* addon disposed */
            }
            const { cols, rows } = terminal;
            try {
              terminal.refresh(0, rows - 1);
            } catch {
              /* disposed */
            }
            if (lastSentDims.current?.cols === cols && lastSentDims.current?.rows === rows) return;
            lastSentDims.current = { cols, rows };
            onResizeRef.current?.(cols, rows);
          };

          // Buffer flush: drains pendingData AFTER a successful fit so the TUI
          // is rendered at the correct cols×rows, not at xterm's default 80×24.
          // Idempotent — safe to call multiple times.
          let bufferFlushed = false;
          const flushBuffer = () => {
            if (bufferFlushed) return;
            bufferFlushed = true;
            terminalReady = true;
            for (const chunk of pendingData) {
              terminal.write(chunk);
            }
            // Force a repaint unconditionally. xterm's internal rAF-based render
            // can miss the first paint when the WebGL renderer is initialising its
            // shaders (cold page load). An explicit refresh() here guarantees the
            // content appears without waiting for the next external trigger.
            try {
              terminal.refresh(0, terminal.rows - 1);
            } catch {
              /* disposed */
            }
            // Send a resize to the PTY after terminal init. This ensures OpenCode
            // (and any other TUI app) receives a SIGWINCH at the true terminal
            // dimensions and re-renders, covering cases where the initial SIGWINCH
            // (from notifyResizeIfChanged above) arrived while the app was still
            // initialising and was silently ignored.
            const { cols, rows } = terminal;
            if (cols > 0 && rows > 0) {
              lastSentDims.current = { cols, rows };
              onResizeRef.current?.(cols, rows);
            }
            // Give the terminal focus after the content is rendered.
            terminal.focus();
            // Delay overlay removal to cover the SIGWINCH round-trip + opencode
            // re-render. The buffer is drained at this point but opencode may still
            // be processing the SIGWINCH and re-painting at the correct dimensions.
            // 600ms covers the prod round-trip (~50-200ms) + opencode re-render
            // (~100-300ms) with margin, preventing the brief broken-layout flash.
            setTimeout(() => {
              requestAnimationFrame(() => {
                if (!cancelled) {
                  // Force final repaint right before overlay drops so WebGL content
                  // is guaranteed visible — even if the 350ms warmup fired during
                  // shader cold-start and the GPU needed extra time.
                  try { terminal.refresh(0, terminal.rows - 1); } catch { /* disposed */ }
                  setTerminalReady(true);
                }
              });
            }, 600);
          };

          // Immediate fit attempt. If the container is already visible, drain
          // the buffer right away at the correct size.
          notifyResizeIfChanged();
          if (container.clientWidth > 0) {
            flushBuffer();
          }
          // If container is hidden (clientWidth=0), flushBuffer() is deferred
          // to the first poll step that finds a non-zero container width.

          // ── Mouse tracking sync ──
          // Enable button+drag tracking (?1002h) + SGR coords (?1006h) so that
          // TUI apps (opencode, Claude Code) receive mouse clicks and drags.
          // TUI apps send these sequences themselves at startup; we also send them
          // here to cover reconnects where the PTY's startup output is no longer
          // in the circular buffer.
          // With ?1002h active, normal drag sends events to the PTY — to select
          // text the user must hold Shift while dragging (Shift bypasses tracking).
          // Copying is handled via OSC 52 (TUI auto-copy), Shift+drag, Ctrl+C,
          // or the right-click context menu.
          if (socket.status === 'connected') {
            try {
              terminal.write('\x1b[?1002h\x1b[?1006h');
            } catch {
              /* disposed */
            }
          }

          // ── Touch event support (mobile) ──
          // xterm.js only handles mouse events. On mobile we translate:
          //   • single tap   → mousedown + mouseup on the xterm screen element
          //   • swipe up/dn  → wheel events so xterm/PTY handle scrolling
          const SWIPE_THRESHOLD = 10;
          // Long-press is cancelled only if the finger moves more than this many pixels.
          // Using the same threshold as SWIPE_THRESHOLD so a deliberate hold isn't
          // disrupted by the micro-jitter that always occurs on touch screens.
          const LONG_PRESS_CANCEL_THRESHOLD = 10;
          let touchStartX = 0;
          let touchStartY = 0;
          let lastTouchY = 0;
          let touchMoved = false;
          let isSelectionDrag = false; // true while extending selection by dragging
          let longPressTimer: ReturnType<typeof setTimeout> | null = null;

          // Converts client (pixel) coordinates to terminal cell {col, row}.
          // Used by both word selection and drag extension.
          const clientToCell = (clientX: number, clientY: number): { col: number; row: number } => {
            let cellW = 0,
              cellH = 0;
            try {
              const dims = (terminal as any)._core?._renderService?.dimensions?.css?.cell;
              if (dims?.width > 0) {
                cellW = dims.width;
                cellH = dims.height;
              }
            } catch {
              /* ignore */
            }
            if (!cellW) {
              cellW = fontSize * 0.6;
              cellH = fontSize * (terminal.options.lineHeight ?? 1.0);
            }
            const rect = container.getBoundingClientRect();
            return {
              col: Math.max(0, Math.floor((clientX - rect.left) / cellW)),
              row:
                Math.max(0, Math.floor((clientY - rect.top) / cellH)) +
                terminal.buffer.active.viewportY,
            };
          };

          // Anchor of the initial long-press word selection.
          // Used by extendSelectionToPoint to know which direction to grow.
          let dragAnchorStart: { col: number; row: number } | null = null;
          let dragAnchorEnd: { col: number; row: number } | null = null;

          // Select the word at the given client coordinates using xterm's public API.
          // Synthetic mouse events (dblclick/mousedown) are unreliable because ?1002h
          // tracking forwards them to the PTY. Instead: pixel → cell, walk buffer for
          // word boundaries, call terminal.select() — tracking-agnostic.
          const selectWordAtPoint = (clientX: number, clientY: number): string => {
            const { col, row } = clientToCell(clientX, clientY);
            const line = terminal.buffer.active.getLine(row);
            if (!line) return '';

            const isWordChar = (ch: string) => !!ch && !/[\s\x00]/.test(ch);
            let sc = col;
            while (sc > 0 && isWordChar(line.getCell(sc - 1)?.getChars() ?? '')) sc--;
            let ec = col;
            while (ec < line.length && isWordChar(line.getCell(ec)?.getChars() ?? '')) ec++;

            if (ec <= sc) return '';
            dragAnchorStart = { col: sc, row };
            dragAnchorEnd = { col: ec - 1, row }; // inclusive end
            terminal.select(sc, row, ec - sc);
            return terminal.getSelection();
          };

          // Extend the selection from the anchor word to the current finger position.
          // Called on every touchmove while isSelectionDrag is true.
          const extendSelectionToPoint = (clientX: number, clientY: number) => {
            if (!dragAnchorStart) return;
            const { col, row } = clientToCell(clientX, clientY);
            const aStart = dragAnchorStart;
            const aEnd = dragAnchorEnd ?? aStart;
            const afterAnchor = row > aEnd.row || (row === aEnd.row && col >= aEnd.col);
            if (afterAnchor) {
              // Dragging forward: anchor start → current
              const len = (row - aStart.row) * terminal.cols + (col - aStart.col) + 1;
              terminal.select(aStart.col, aStart.row, Math.max(1, len));
            } else {
              // Dragging backward: current → anchor end
              const len = (aEnd.row - row) * terminal.cols + (aEnd.col - col) + 1;
              terminal.select(col, row, Math.max(1, len));
            }
          };

          const onTouchStart = (e: TouchEvent) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            lastTouchY = e.touches[0].clientY;
            touchMoved = false;
            isSelectionDrag = false;
            touchActive = true;
            dragAnchorStart = null;
            dragAnchorEnd = null;

            // Fallback long-press timer for browsers that don't fire `contextmenu`
            // on long-press (some WebViews / iOS configurations). The primary path
            // is onContextMenu which fires first on most mobile browsers (~500 ms).
            // NOTE: setTimeout callbacks are not a user-gesture context, so we
            // can only select the word here; clipboard write requires the Clipboard
            // API with clipboard-write permission (auto-granted on trusted HTTPS pages).
            longPressTimer = setTimeout(() => {
              longPressTimer = null;
              if (isSelectionDrag) return; // contextmenu already handled this
              touchMoved = true;
              isSelectionDrag = true;
              // Haptic feedback so the user knows the long-press was recognised.
              if ('vibrate' in navigator) {
                try {
                  navigator.vibrate(50);
                } catch {
                  /* ignore */
                }
              }
              const sel = selectWordAtPoint(touchStartX, touchStartY);
              if (sel)
                navigator.clipboard
                  ?.writeText(sel)
                  .then(flashCopied)
                  .catch(() => {});
            }, 500);
          };

          const onTouchMove = (e: TouchEvent) => {
            // Cancel the long-press timer only when the finger has moved beyond the
            // threshold. On touch screens, micro-jitter of 1–3 px is normal during a
            // hold gesture, so cancelling on any movement would prevent selection.
            if (longPressTimer !== null) {
              const touch0 = e.touches[0];
              const dx = touch0.clientX - touchStartX;
              const dy = touch0.clientY - touchStartY;
              if (dx * dx + dy * dy > LONG_PRESS_CANCEL_THRESHOLD * LONG_PRESS_CANCEL_THRESHOLD) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
            }
            e.preventDefault();
            const touch = e.touches[0];
            const deltaY = lastTouchY - touch.clientY;
            lastTouchY = touch.clientY;
            if (Math.abs(touch.clientY - touchStartY) > SWIPE_THRESHOLD) {
              touchMoved = true;
            }

            if (isSelectionDrag) {
              // Extend selection via terminal.select() — no synthetic mouse events.
              // Synthetic shift+mousedown events are still intercepted by ?1002h tracking.
              extendSelectionToPoint(touch.clientX, touch.clientY);
              return; // don't scroll while in selection-drag mode
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
            if (longPressTimer !== null) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            touchActive = false;
            // Prevent the browser from synthesising native mousedown/mouseup/click
            // events for this touch — xterm's click handler would otherwise trigger
            // word-selection. We dispatch our own controlled events instead.
            e.preventDefault();

            if (isSelectionDrag) {
              // Drag-to-select ended — copy whatever is now selected.
              isSelectionDrag = false;
              const sel = terminal.getSelection();
              if (sel) writeClipboard(sel, flashCopied);
              return;
            }

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

          // Polling fit: retries every 100 ms until the container has real
          // dimensions (max 50 attempts = 5 s).  Handles terminals that mount
          // while their parent is display:none (e.g. collapsed CanvasMobile
          // slot, canvas panel not yet shown) where a one-shot timeout would
          // read clientWidth=0 and silently do nothing.
          let pollAttempt = 0;
          let pollTimerId: ReturnType<typeof setTimeout> | null = null;

          const doPollStep = () => {
            pollTimerId = null;
            if (cancelled) return;
            notifyResizeIfChanged();
            if (container.clientWidth > 0) {
              // Container is now visible — drain the buffer at the correct size.
              flushBuffer();
            } else if (pollAttempt++ < 50) {
              // Still hidden — keep retrying.
              pollTimerId = setTimeout(doPollStep, 100);
            }
          };

          const startPollFit = () => {
            if (pollTimerId !== null) {
              clearTimeout(pollTimerId);
              pollTimerId = null;
            }
            pollAttempt = 0;
            pollTimerId = setTimeout(doPollStep, 100);
          };

          startPollFit();

          // ── Step 5: Wire socket status + terminal input ──
          // Data subscription was already wired before font loading.
          const MOUSE_RESET = '\x1b[?1000l\x1b[?1002l\x1b[?1003l';
          let prevStatus = '';
          let firstStatusReceived = false;
          const statusTimers: ReturnType<typeof setTimeout>[] = [];
          const clearStatusTimers = () => {
            for (const t of statusTimers) clearTimeout(t);
            statusTimers.length = 0;
          };
          const doRepaint = (sendSigwinch: boolean) => {
            const fit = fitAddonRef.current;
            const term = terminalRef.current;
            if (!fit || !term || term.element?.clientWidth === 0) return;
            try {
              fit.fit();
            } catch {
              return;
            }
            try {
              term.refresh(0, term.rows - 1);
            } catch {
              /* disposed */
            }
            if (sendSigwinch) onResizeRef.current?.(term.cols, term.rows);
          };
          const unsubscribeStatus = socket.onStatus((st) => {
            onStatusChangeRef.current?.(st);
            // Fire fit+refresh+SIGWINCH when status becomes 'active' from any non-active
            // state. This covers:
            //   'waiting' → 'active': user ran a command from bash
            //   ''        → 'active': new session; opencode started before first status poll
            if (st === 'active' && prevStatus !== 'active') {
              clearStatusTimers();
              // 150ms: fast refresh to cover cases where opencode has already rendered
              statusTimers.push(setTimeout(() => doRepaint(false), 150));
              // 1000ms: refresh + SIGWINCH after opencode has had time to initialize
              statusTimers.push(setTimeout(() => doRepaint(true), 1000));
            }
            // On the very first status event, always send SIGWINCH so the TUI
            // redraws at the correct terminal dimensions. This covers sessions
            // already at the prompt ('waiting') where the 'active' path above
            // never fires — buffer replay shows stale content at the old PTY
            // size, so opencode must re-render to fill the current viewport.
            if (!firstStatusReceived) {
              firstStatusReceived = true;
              if (st !== 'active') {
                statusTimers.push(setTimeout(() => doRepaint(true), 500));
              }
            }
            prevStatus = st;
            // Disable mouse tracking when the PTY session ends so clicks
            // revert to normal text-selection instead of forwarding to a dead process.
            if (st === 'finished' || st === 'exited' || st === 'killed') {
              try {
                terminal.write(MOUSE_RESET);
              } catch {
                /* disposed */
              }
            }
          });
          const unsubscribeExit = socket.onExit(() => {
            try {
              terminal.write(MOUSE_RESET);
            } catch {
              /* disposed */
            }
          });
          const onDataDisposable = terminal.onData((data) => socket.send(data));

          // ── Step 6: ResizeObserver (debounced to prevent fit→resize→fit loops) ──
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

          // Re-fit when the mobile virtual keyboard opens/closes.
          // visualViewport.resize fires before the CSS layout reflects the new
          // height, so the ResizeObserver alone may miss the first keyboard event.
          window.visualViewport?.addEventListener('resize', debouncedResize);

          // Re-fit when the page becomes visible again — covers browser tab switching,
          // window minimize/restore, and WebGL context loss/restore where the RAF loop
          // may have been paused and doesn't auto-resume painting.
          const onVisibilityChange = () => {
            if (!document.hidden) scheduleVisibilityFit();
          };
          document.addEventListener('visibilitychange', onVisibilityChange);

          // ── Step 7: Visibility detection — re-fit + re-render on session switch ──
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
            // into one poll cycle start. 300ms covers CSS transitions on parent
            // containers (e.g. MobileSlot collapses with a 200ms transition).
            if (visibilityTimerId !== null) clearTimeout(visibilityTimerId);
            visibilityTimerId = setTimeout(() => {
              visibilityTimerId = null;
              // Restart the polling cycle so we keep retrying until the
              // container becomes visible (handles display:none toggling on any
              // ancestor, and CSS transitions that briefly give wrong dims).
              startPollFit();
            }, 300);
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
          // unsubscribeData is handled at effect level (registered before font load).
          scheduledCleanup = () => {
            if (pollTimerId !== null) clearTimeout(pollTimerId);
            if (longPressTimer !== null) clearTimeout(longPressTimer);
            if (resizeTimerId !== null) clearTimeout(resizeTimerId);
            if (visibilityTimerId !== null) clearTimeout(visibilityTimerId);
            if (selectionCopyTimer !== null) clearTimeout(selectionCopyTimer);
            if (webglWarmupTimer !== null) clearTimeout(webglWarmupTimer);
            selectionDisposable.dispose();
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            mutationObserver.disconnect();
            window.visualViewport?.removeEventListener('resize', debouncedResize);
            container.removeEventListener('mouseup', onMouseUp);
            container.removeEventListener('contextmenu', onContextMenu);
            document.removeEventListener('copy', onNativeCopy);
            document.removeEventListener('paste', onNativePaste, true);
            container.removeEventListener('focusin', onContainerFocusIn);
            container.removeEventListener('focusout', onContainerFocusOut);
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            clearStatusTimers();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            unsubscribeStatus();
            unsubscribeExit();
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
        // Reset dims so the next session always sends SIGWINCH on first fit,
        // even if the new session happens to have the same cols×rows.
        lastSentDims.current = null;
        unsubscribeData(); // always cleanup: registered before font loading
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

    // Hot-swap colour theme without recreating the terminal.
    useEffect(() => {
      const term = terminalRef.current;
      if (!term || !theme) return;
      term.options.theme = theme;
    }, [theme]);

    // Fire a fit+refresh+mouse-sync whenever the WebSocket (re)connects so the
    // PTY always knows the true terminal dimensions and mouse tracking is active.
    useEffect(() => {
      if (socket.status !== 'connected') return;
      const fit = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fit || !term) {
        // Socket connected before the terminal finished initialising (font load
        // still in flight). Schedule retries so the fit+refresh+mouse-tracking
        // still runs once the terminal is ready. The retry delays (500 ms,
        // 1500 ms, 3000 ms) bracket the 3-second font-load timeout.
        const doSync = () => {
          const f = fitAddonRef.current;
          const t = terminalRef.current;
          if (!f || !t) return;
          try {
            f.fit();
          } catch {
            return;
          }
          try {
            t.refresh(0, t.rows - 1);
          } catch {
            /* disposed */
          }
          try {
            t.write('\x1b[?1002h\x1b[?1006h');
          } catch {
            /* disposed */
          }
          lastSentDims.current = { cols: t.cols, rows: t.rows };
          console.log(`[XTermTerminal] WS connect retry sync: ${t.cols}x${t.rows}`);
          onResizeRef.current?.(t.cols, t.rows);
        };
        const timers = [500, 1500, 3000].map((d) => setTimeout(doSync, d));
        return () => timers.forEach(clearTimeout);
      }
      const t = setTimeout(() => {
        try {
          fit.fit();
        } catch {
          return; /* addon disposed */
        }
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* disposed */
        }
        // Re-sync mouse tracking: button events only, no hover spam
        try {
          term.write('\x1b[?1002h\x1b[?1006h');
        } catch {
          /* disposed */
        }
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
        {!terminalReady && socket.status !== 'error' && <LoadingOverlay />}

        {/* Status badge only shown after the terminal is fully initialised. */}
        {terminalReady && (
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
          style={{ backgroundColor: theme?.background ?? TERMINAL_THEME.background }}
        />

        {/* "Copiado!" toast — shown after any copy action */}
        {showCopied && <CopiedToast />}

        {/* Image upload feedback */}
        {imageUploadStatus !== 'idle' && (
          <div className="pointer-events-none absolute bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-[6px] border border-[rgba(255,255,255,0.1)] bg-[#111118] px-3 py-1.5 font-['Inter'] text-[12px]">
            {imageUploadStatus === 'uploading' ? (
              <span className="text-[#b3e502]">⬆ Uploading image…</span>
            ) : (
              <span className="text-red-400">✕ Image upload failed</span>
            )}
          </div>
        )}
      </div>
    );
  }),
);
