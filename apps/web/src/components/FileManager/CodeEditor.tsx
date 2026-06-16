import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
} from 'react';
import { apiFetch, getToken, type ApiError } from '../../lib/api';
import { highlight, langFromExtension, THEMES, DEFAULT_THEME, type ThemeName } from './tokenizer';

/* ── Types ── */

export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  modified: boolean;
  modifiedAt: string;
  type?: 'text' | 'image';
  imageUrl?: string; // blob URL — revoke on tab close
}

export interface CodeEditorHandle {
  openFile: (filePath: string) => void;
}

interface FileContentResponse {
  content: string;
  size: number;
  encoding: string;
  modifiedAt: string;
}

/* ── Constants ── */

const MAX_TABS = 10;

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.avif',
  '.svg',
]);

/* ── Helpers ── */

function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.substring(dot) : '';
}

/* ── Inline Icons ── */

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileTabIcon({ extension }: { extension: string }) {
  const color =
    (
      {
        '.ts': '#3178c6',
        '.tsx': '#3178c6',
        '.js': '#f0db4f',
        '.jsx': '#f0db4f',
        '.json': '#f0db4f',
        '.md': '#b3e502',
        '.css': '#42a5f5',
        '.html': '#e65100',
      } as Record<string, string>
    )[extension] || '#9aa3ad';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
      <path
        d="M3 1.5h3.5l2.5 2.5v6.5a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z"
        stroke={color}
        strokeWidth="1"
        fill={color}
        fillOpacity="0.1"
      />
      <path d="M6.5 1.5v2.5H9" stroke={color} strokeWidth="1" />
    </svg>
  );
}

/* ── Unsaved Confirmation ── */

function UnsavedModal({
  fileName,
  onDiscard,
  onSave,
  onCancel,
}: {
  fileName: string;
  onDiscard: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      data-testid="unsaved-modal"
    >
      <div
        className="w-[300px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[20px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-[8px] font-['Syne'] text-[17px] font-bold text-[#fa0]">
          Unsaved Changes
        </h3>
        <p className="mb-4 font-['Inter'] text-[13px] text-[#9aa3ad]">
          <span className="font-mono text-[#f0f0f0]">{fileName}</span> has unsaved changes.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-[4px] px-3 py-1 font-['Inter'] text-[12px] text-[#9aa3ad] hover:text-[#e6e8eb]"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="rounded-[4px] border border-red-500/30 px-3 py-1 font-['Inter'] text-[12px] text-red-400 hover:bg-red-500/10"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="rounded-[4px] bg-[#b3e502] px-3 py-1 font-['Inter'] text-[12px] font-medium text-[#0a0a0f]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Language Badge ── */

function LanguageBadge({ extension }: { extension: string }) {
  const lang = langFromExtension(extension) || extension.slice(1);
  return (
    <span className="rounded-[3px] bg-[rgba(255,255,255,0.05)] px-1.5 py-px font-['Inter'] text-[10px] text-[#5a626c]">
      {lang}
    </span>
  );
}

/* ── Theme Picker ── */

function ThemePicker({
  current,
  onChange,
}: {
  current: ThemeName;
  onChange: (t: ThemeName) => void;
}) {
  const [open, setOpen] = useState(false);
  const names = Object.keys(THEMES) as ThemeName[];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-[3px] bg-[rgba(255,255,255,0.05)] px-1.5 py-px font-['Inter'] text-[10px] text-[#5a626c] hover:text-[#9aa3ad]"
      >
        {current}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 rounded-[8px] border border-white/[0.08] bg-[#111118] py-1 shadow-xl backdrop-blur-md">
            {names.map((t) => (
              <button
                key={t}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left font-['Inter'] text-[12px] hover:bg-[rgba(255,255,255,0.06)] ${t === current ? 'text-[#b3e502]' : 'text-[#ccd]'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main CodeEditor Component ── */

export interface CodeEditorProps {
  projectId: string;
  filesApiBase?: string;
  initialFilePath?: string;
  isMobile?: boolean;
  onBack?: () => void;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { projectId, filesApiBase, initialFilePath, isMobile = false, onBack },
  ref,
) {
  const base = filesApiBase ?? `/api/projects/${projectId}/files`;
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsaved, setShowUnsaved] = useState<{ tabIndex: number } | null>(null);
  const [theme, setTheme] = useState<ThemeName>(() => {
    try {
      return (localStorage.getItem('editor-theme') as ThemeName) || DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });
  const [dragTabIdx, setDragTabIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [showTimeline, setShowTimeline] = useState(false);
  const [wordWrap, setWordWrap] = useState(() => {
    try {
      const stored = localStorage.getItem('editor-wordwrap');
      if (stored !== null) return stored === 'true';
      // Default ON for mobile (narrow viewport), OFF for desktop
      return typeof window !== 'undefined' && window.innerWidth < 640;
    } catch {
      return false;
    }
  });

  // Per-file save-history — Timeline. Each entry is a saved snapshot.
  const historyRef = useRef<Map<string, Array<{ content: string; savedAt: Date }>>>(new Map());

  // Scroll-sync refs
  const lineNumRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Open a file ── */
  const openFile = useCallback(
    async (filePath: string) => {
      if (tabs.length >= MAX_TABS) {
        setError(`Maximum ${MAX_TABS} tabs open`);
        return;
      }
      const existingIdx = tabs.findIndex((t) => t.filePath === filePath);
      if (existingIdx >= 0) {
        setActiveTabIndex(existingIdx);
        return;
      }
      const ext = extOf(filePath.split('/').pop() || filePath);
      if (IMAGE_EXTS.has(ext.toLowerCase())) {
        // Image file: fetch via download endpoint and create a blob URL for preview
        try {
          const token = getToken();
          const res = await fetch(`${base}/download?path=${encodeURIComponent(filePath)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setError((d as { error?: string }).error || 'Failed to load image');
            return;
          }
          const blob = await res.blob();
          const imageUrl = URL.createObjectURL(blob);
          const newTab: EditorTab = {
            filePath,
            fileName: filePath.split('/').pop() || filePath,
            content: '',
            modified: false,
            modifiedAt: new Date().toISOString(),
            type: 'image',
            imageUrl,
          };
          setTabs((prev) => {
            const next = [...prev, newTab];
            setActiveTabIndex(next.length - 1);
            return next;
          });
        } catch (err) {
          setError((err as Error).message || 'Failed to load image');
        }
        return;
      }

      try {
        const data = await apiFetch<FileContentResponse>(
          `${base}/read?path=${encodeURIComponent(filePath)}`,
        );
        const newTab: EditorTab = {
          filePath,
          fileName: filePath.split('/').pop() || filePath,
          content: data.content,
          modified: false,
          modifiedAt: data.modifiedAt,
          type: 'text',
        };
        setTabs((prev) => {
          const next = [...prev, newTab];
          setActiveTabIndex(next.length - 1);
          return next;
        });
        historyRef.current.set(filePath, [{ content: data.content, savedAt: new Date() }]);
      } catch (err) {
        setError((err as ApiError).message || 'Failed to open file');
      }
    },
    [tabs, projectId],
  );

  useImperativeHandle(ref, () => ({ openFile }), [openFile]);

  useEffect(() => {
    if (initialFilePath && tabs.length === 0) openFile(initialFilePath);
  }, [initialFilePath, openFile, tabs.length]);

  /* ── Close tab ── */
  const closeTab = useCallback(
    (index: number) => {
      if (tabs[index]?.modified) {
        setShowUnsaved({ tabIndex: index });
        return;
      }
      // Revoke blob URL if this was an image tab
      const tab = tabs[index];
      if (tab?.type === 'image' && tab.imageUrl) URL.revokeObjectURL(tab.imageUrl);
      setTabs((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (activeTabIndex >= next.length && next.length > 0) setActiveTabIndex(next.length - 1);
        return next;
      });
    },
    [tabs, activeTabIndex],
  );

  /* ── Save ── */
  const saveFile = useCallback(
    async (tab: EditorTab, index: number) => {
      setSaving(true);
      setError(null);
      try {
        const result = await apiFetch<{ modifiedAt: string }>(
          `${base}/write?path=${encodeURIComponent(tab.filePath)}`,
          { method: 'PUT', body: JSON.stringify({ content: tab.content }) },
        );
        setTabs((prev) =>
          prev.map((t, i) =>
            i === index ? { ...t, modified: false, modifiedAt: result.modifiedAt } : t,
          ),
        );
        // Push save snapshot to Timeline
        const hist = historyRef.current.get(tab.filePath) ?? [];
        historyRef.current.set(tab.filePath, [
          ...hist,
          { content: tab.content, savedAt: new Date() },
        ]);
      } catch (err) {
        const e = err as ApiError;
        setError(
          e.status === 400 ? 'Conflict: modified externally.' : e.message || 'Failed to save',
        );
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  /* ── Restore from Timeline snapshot ── */
  const restoreSnapshot = useCallback(
    (content: string) => {
      setTabs((prev) =>
        prev.map((t, i) => (i === activeTabIndex ? { ...t, content, modified: true } : t)),
      );
    },
    [activeTabIndex],
  );

  /* ── Content change ── */
  const handleContentChange = useCallback(
    (value: string) => {
      setTabs((prev) =>
        prev.map((t, i) => (i === activeTabIndex ? { ...t, content: value, modified: true } : t)),
      );
    },
    [activeTabIndex],
  );

  /* ── Word wrap toggle ── */
  const toggleWordWrap = useCallback(() => {
    setWordWrap((v) => {
      const next = !v;
      try {
        localStorage.setItem('editor-wordwrap', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /* ── Tab key → insert spaces; Shift+Tab → dedent ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const content = tabs[activeTabIndex]?.content ?? '';
      const indent = '  '; // 2 spaces

      if (start === end) {
        // No selection: insert indent at cursor
        const next = content.slice(0, start) + indent + content.slice(end);
        handleContentChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + indent.length;
        });
      } else if (e.shiftKey) {
        // Shift+Tab: dedent selected lines (remove up to 2 leading spaces)
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const block = content.slice(lineStart, end);
        const dedented = block.replace(/^  /gm, '').replace(/^\t/gm, '');
        const delta = block.length - dedented.length;
        handleContentChange(content.slice(0, lineStart) + dedented + content.slice(end));
        requestAnimationFrame(() => {
          ta.selectionStart = Math.max(lineStart, start - Math.min(2, delta));
          ta.selectionEnd = end - delta;
        });
      } else {
        // Tab with selection: indent all selected lines
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const block = content.slice(lineStart, end);
        const indented = block.replace(/^/gm, indent);
        const delta = indented.length - block.length;
        handleContentChange(content.slice(0, lineStart) + indented + content.slice(end));
        requestAnimationFrame(() => {
          ta.selectionStart = start + indent.length;
          ta.selectionEnd = end + delta;
        });
      }
    },
    [tabs, activeTabIndex, handleContentChange],
  );

  /* ── Global keyboard shortcuts (Ctrl+S only — let browser handle Ctrl+Z/Shift+Z natively) ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const tab = tabs[activeTabIndex];
        if (tab?.modified) saveFile(tab, activeTabIndex);
      }
    };
    window.addEventListener('keydown', handler as unknown as EventListener);
    return () => window.removeEventListener('keydown', handler as unknown as EventListener);
  }, [tabs, activeTabIndex, saveFile]);

  /* ── Theme persistence ── */
  const handleThemeChange = useCallback((t: ThemeName) => {
    setTheme(t);
    try {
      localStorage.setItem('editor-theme', t);
    } catch {
      /* ignore */
    }
  }, []);

  /* ── Tab drag-to-reorder ── */
  const handleTabDragStart = useCallback((i: number) => setDragTabIdx(i), []);
  const handleTabDragOver = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIdx(i);
  }, []);
  const handleTabDrop = useCallback(
    (e: React.DragEvent, i: number) => {
      e.preventDefault();
      if (dragTabIdx === null || dragTabIdx === i) {
        setDragTabIdx(null);
        setDragOverIdx(null);
        return;
      }
      setTabs((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragTabIdx, 1);
        next.splice(i, 0, moved);
        return next;
      });
      setActiveTabIndex((prev) => {
        if (prev === dragTabIdx) return i;
        if (prev > dragTabIdx && prev <= i) return prev - 1;
        if (prev < dragTabIdx && prev >= i) return prev + 1;
        return prev;
      });
      setDragTabIdx(null);
      setDragOverIdx(null);
    },
    [dragTabIdx],
  );

  /* ── Scroll sync ── */
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (lineNumRef.current) lineNumRef.current.scrollTop = ta.scrollTop;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  /* ── Derived ── */
  const activeTab = tabs[activeTabIndex];
  const extension = activeTab ? extOf(activeTab.fileName) : '';
  const lang = langFromExtension(extension);

  const lineCount = useMemo(() => {
    if (!activeTab?.content) return 1;
    const n = (activeTab.content.match(/\n/g) || []).length;
    return activeTab.content.endsWith('\n') ? n : n + 1;
  }, [activeTab?.content]);

  const highlighted = useMemo(
    () => (activeTab ? highlight(activeTab.content, lang, theme) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.content, lang, theme],
  );

  const textColor = THEMES[theme].text;

  /* ── Empty state ── */
  if (tabs.length === 0 && !initialFilePath) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-[12px] bg-[#0a0a0f]"
        data-testid="editor-empty"
      >
        <div className="flex size-[56px] items-center justify-center rounded-[16px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] backdrop-blur-md">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 3h7l5 5v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"
              stroke="#b3e502"
              strokeWidth="1.5"
            />
            <path d="M13 3v5h5" stroke="#b3e502" strokeWidth="1.5" />
          </svg>
        </div>
        <p className="font-['Inter'] text-[13px] text-[#7a828c]">Select a file to edit</p>
        {error && <p className="font-['Inter'] text-[12px] text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]" data-testid="code-editor">
      {/* ── Tab bar ── */}
      <div
        className="flex items-center border-b border-white/[0.07] bg-[#0c0c14]"
        data-testid="tab-bar"
      >
        {isMobile && onBack && (
          <button
            onClick={onBack}
            className="flex min-h-[44px] shrink-0 items-center px-3 font-['Inter'] text-[12px] text-[#9aa3ad] active:text-[#ccd]"
          >
            ‹ Back
          </button>
        )}
        {/* Mobile Save button — visible when file is modified (Ctrl+S not available on touch) */}
        {isMobile && activeTab?.modified && activeTab.type !== 'image' && (
          <button
            onClick={() => saveFile(activeTab!, activeTabIndex)}
            disabled={saving}
            className="flex min-h-[44px] shrink-0 items-center gap-1 px-3 font-['Inter'] text-[12px] font-medium text-[#b3e502] active:opacity-70 disabled:opacity-40"
          >
            {saving ? '…' : 'Save'}
          </button>
        )}
        {/* Mobile: show only active tab name, no list, no close button */}
        {isMobile ? (
          <div className="flex min-h-[44px] flex-1 items-center px-3">
            {activeTab && (
              <>
                <FileTabIcon extension={extOf(activeTab.fileName)} />
                <span className="ml-1.5 font-['Inter'] text-[13px] text-[#f0f0f0] truncate">
                  {activeTab.fileName}
                </span>
                {activeTab.modified && <span className="ml-1.5 text-[#b3e502] text-[10px]">●</span>}
              </>
            )}
          </div>
        ) : (
          /* Desktop: full scrollable tab list with close buttons */
          <div className="flex min-h-[40px] flex-1 overflow-x-auto">
            {tabs.map((tab, i) => {
              const tabExt = extOf(tab.fileName);
              const isDragTarget = dragOverIdx === i && dragTabIdx !== null && dragTabIdx !== i;
              return (
                <button
                  key={tab.filePath}
                  draggable
                  onDragStart={() => handleTabDragStart(i)}
                  onDragOver={(e) => handleTabDragOver(e, i)}
                  onDrop={(e) => handleTabDrop(e, i)}
                  onDragEnd={() => {
                    setDragTabIdx(null);
                    setDragOverIdx(null);
                  }}
                  onClick={() => setActiveTabIndex(i)}
                  className={`flex min-h-[40px] items-center gap-1.5 border-r border-[rgba(255,255,255,0.06)] px-3 py-2 text-left font-['Inter'] text-[12px] transition-colors shrink-0 cursor-pointer ${
                    i === activeTabIndex
                      ? 'border-b-2 border-b-[#b3e502] bg-[#0a0a0f] text-[#f0f0f0]'
                      : 'text-[#9aa3ad] hover:text-[#e6e8eb]'
                  } ${isDragTarget ? 'border-l-2 border-l-[#b3e502]' : ''}`}
                  data-testid={`tab-${i}`}
                >
                  <FileTabIcon extension={tabExt} />
                  <span className="max-w-[120px] truncate">{tab.fileName}</span>
                  {tab.modified && <span className="text-[#b3e502] text-[10px]">●</span>}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(i);
                    }}
                    className="ml-1 flex size-[20px] shrink-0 items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] cursor-pointer"
                    data-testid={`close-tab-${i}`}
                  >
                    <CloseIcon />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {activeTab && (
          <div className="flex shrink-0 items-center gap-2 px-3">
            {saving && <span className="font-['Inter'] text-[10px] text-[#9aa3ad]">Saving…</span>}
            {!saving && activeTab.modified && <span className="text-[#b3e502] text-[10px]">●</span>}
            {extension && <LanguageBadge extension={extension} />}
            <button
              onClick={toggleWordWrap}
              title="Toggle word wrap"
              className={`rounded-[3px] px-1.5 py-px font-['Inter'] text-[10px] transition-colors ${wordWrap ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502]' : 'bg-[rgba(255,255,255,0.05)] text-[#5a626c] hover:text-[#9aa3ad]'}`}
            >
              wrap
            </button>
            <ThemePicker current={theme} onChange={handleThemeChange} />
          </div>
        )}
      </div>

      {/* ── Editor / Image viewer ── */}
      {activeTab && activeTab.type === 'image' && activeTab.imageUrl ? (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0a0f]"
          data-testid="image-viewer"
        >
          {/* Image meta bar */}
          <div className="shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0c0c14] px-3 py-1 flex items-center gap-2">
            <span className="font-['Inter'] text-[11px] text-[#5a626c]">{activeTab.fileName}</span>
            <a
              href={activeTab.imageUrl}
              download={activeTab.fileName}
              className="ml-auto rounded-[3px] border border-white/[0.07] px-2 py-0.5 font-['Inter'] text-[10px] text-[#9aa3ad] hover:text-[#e6e8eb]"
            >
              Download
            </a>
          </div>
          {/* Image */}
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={activeTab.imageUrl}
              alt={activeTab.fileName}
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: activeTab.fileName.endsWith('.svg') ? 'auto' : 'pixelated' }}
              draggable={false}
            />
          </div>
        </div>
      ) : (
        activeTab && (
          <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="editor-content">
            {/* Line numbers — font-size matches textarea (16px mobile prevents iOS zoom) */}
            <div
              ref={lineNumRef}
              className="shrink-0 overflow-hidden border-r border-[rgba(255,255,255,0.06)] bg-[#0c0c14] py-2 pl-2 pr-3 text-right select-none"
              style={{ minWidth: `${String(lineCount).length * 8 + 24}px` }}
              aria-hidden="true"
            >
              <div
                className="font-['JetBrains_Mono'] leading-[1.6] text-[#5a626c]"
                style={{ fontSize: isMobile ? 16 : 13 }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
            </div>

            {/* Backdrop highlight + transparent textarea */}
            <div className="relative min-w-0 flex-1 overflow-hidden">
              {/* font-size 16px on mobile prevents iOS keyboard zoom-in */}
              <pre
                ref={preRef}
                className={`absolute inset-0 m-0 overflow-auto p-2 font-['JetBrains_Mono'] leading-[1.6] pointer-events-none select-none ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}
                style={{
                  color: textColor,
                  background: 'transparent',
                  tabSize: 2,
                  fontSize: isMobile ? 16 : 13,
                }}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
                aria-hidden="true"
              />
              <textarea
                ref={textareaRef}
                value={activeTab.content}
                onChange={(e) => handleContentChange(e.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                className={`absolute inset-0 m-0 h-full w-full overflow-auto resize-none p-2 font-['JetBrains_Mono'] leading-[1.6] bg-transparent outline-none ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}
                style={{
                  color: 'transparent',
                  caretColor: 'white',
                  tabSize: 2,
                  fontSize: isMobile ? 16 : 13,
                }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                data-testid="editor-textarea"
                aria-label={`Editing ${activeTab.fileName}`}
              />
            </div>
          </div>
        )
      )}

      {/* ── Unsaved modal ── */}
      {showUnsaved && (
        <UnsavedModal
          fileName={tabs[showUnsaved.tabIndex]?.fileName || ''}
          onDiscard={() => {
            const idx = showUnsaved.tabIndex;
            setShowUnsaved(null);
            setTabs((prev) => {
              const next = prev.filter((_, i) => i !== idx);
              if (activeTabIndex >= next.length && next.length > 0)
                setActiveTabIndex(next.length - 1);
              return next;
            });
          }}
          onSave={() => {
            const idx = showUnsaved.tabIndex;
            setShowUnsaved(null);
            const tab = tabs[idx];
            if (tab) saveFile(tab, idx);
          }}
          onCancel={() => setShowUnsaved(null)}
        />
      )}

      {/* ── Error ── */}
      {error && (
        <div
          className="shrink-0 border-t border-red-500/20 bg-red-500/10 px-3 py-1.5 font-['Inter'] text-[11px] text-red-400"
          data-testid="editor-error"
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-[#5a626c] hover:text-[#9aa3ad]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Timeline panel ── */}
      {activeTab && (
        <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] bg-[#0c0c14]">
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgba(255,255,255,0.03)]"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`shrink-0 transition-transform text-[#5a626c] ${showTimeline ? 'rotate-90' : ''}`}
            >
              <path
                d="M3 1.5L7 5L3 8.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-['Inter'] text-[10px] text-[#5a626c]">Timeline</span>
            {historyRef.current.get(activeTab.filePath)?.length ? (
              <span className="rounded-[3px] bg-[rgba(255,255,255,0.06)] px-1 font-['JetBrains_Mono'] text-[9px] text-[#5a626c]">
                {historyRef.current.get(activeTab.filePath)!.length} saves
              </span>
            ) : null}
          </button>
          {showTimeline && (
            <div className="max-h-[120px] overflow-y-auto border-t border-[rgba(255,255,255,0.04)]">
              {(() => {
                const hist = [...(historyRef.current.get(activeTab.filePath) ?? [])].reverse();
                if (hist.length === 0) {
                  return (
                    <div className="px-3 py-2 font-['Inter'] text-[11px] text-[#5a626c]">
                      {isMobile
                        ? 'No saves yet — tap Save to create snapshot'
                        : 'No saves yet — Ctrl+S to create a snapshot'}
                    </div>
                  );
                }
                return hist.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.04)] px-3 py-1.5 hover:bg-white/[0.02]"
                  >
                    <span className="font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
                      {entry.savedAt.toLocaleTimeString()}
                    </span>
                    <span className="flex-1 font-['Inter'] text-[10px] text-[#5a626c]">
                      v{hist.length - i} · {entry.content.split('\n').length} lines
                    </span>
                    <button
                      onClick={() => restoreSnapshot(entry.content)}
                      className="rounded-[3px] border border-white/[0.07] px-2 py-0.5 font-['Inter'] text-[10px] text-[#9aa3ad] hover:border-[rgba(179,229,2,0.3)] hover:text-[#b3e502]"
                    >
                      Restore
                    </button>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Status hint (desktop only) ── */}
      {!isMobile && (
        <div className="shrink-0 border-t border-[rgba(255,255,255,0.04)] bg-[#0c0c14] px-3 py-0.5">
          <span className="font-['JetBrains_Mono'] text-[9px] text-[#334]">
            Ctrl+S save · Ctrl+Z/Shift+Z undo/redo · drag tabs to reorder
          </span>
        </div>
      )}
    </div>
  );
});

export default CodeEditor;
