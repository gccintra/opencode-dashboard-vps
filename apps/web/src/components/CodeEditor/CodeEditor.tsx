import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { apiFetch, type ApiError } from '../../lib/api';

/* ── Types ── */

export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  modified: boolean;
  modifiedAt: string;
}

interface FileContentResponse {
  content: string;
  size: number;
  encoding: string;
  modifiedAt: string;
}

/* ── Constants ── */

const MAX_TABS = 10;
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.svg': 'xml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.env': 'plain',
  '.gitignore': 'plain',
  '.editorconfig': 'plain',
  '.xml': 'xml',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
};

/* ── Inline SVG Icons ── */

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
        '.md': '#af0',
        '.css': '#42a5f5',
        '.html': '#e65100',
      } as Record<string, string>
    )[extension] || '#889';
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      data-testid="unsaved-modal"
    >
      <div
        className="w-[300px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-['Inter'] text-[13px] font-medium text-yellow-400">
          Unsaved Changes
        </h3>
        <p className="mb-4 font-['Inter'] text-[13px] text-[#889]">
          <span className="font-mono text-[#f0f0f0]">{fileName}</span> has unsaved changes.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-[4px] px-3 py-1 font-['Inter'] text-[12px] text-[#889] hover:text-[#ccd]"
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
            className="rounded-[4px] bg-[#af0] px-3 py-1 font-['Inter'] text-[12px] font-medium text-[#0a0a0f]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Line Numbers ── */

function LineNumbers({ count }: { count: number }) {
  return (
    <div
      className="select-none pr-3 text-right font-['JetBrains_Mono'] text-[12px] leading-[1.6] text-[#445] shrink-0"
      data-testid="line-numbers"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

/* ── Language Badge ── */

function LanguageBadge({ extension }: { extension: string }) {
  const lang = LANGUAGE_EXTENSIONS[extension] || extension.slice(1);
  return (
    <span className="rounded-[3px] bg-[rgba(255,255,255,0.05)] px-1.5 py-px font-['Inter'] text-[10px] text-[#556]">
      {lang}
    </span>
  );
}

/* ── Main CodeEditor Component ── */

export default function CodeEditor({
  projectId,
  initialFilePath,
  isMobile = false,
  onBack,
}: {
  projectId: string;
  initialFilePath?: string;
  isMobile?: boolean;
  onBack?: () => void;
}) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsaved, setShowUnsaved] = useState<{ tabIndex: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Open a file ── */
  const openFile = useCallback(
    async (filePath: string) => {
      // Check max tabs
      if (tabs.length >= MAX_TABS) {
        setError(`Maximum ${MAX_TABS} tabs open`);
        return;
      }

      // Check if already open
      const existingIdx = tabs.findIndex((t) => t.filePath === filePath);
      if (existingIdx >= 0) {
        setActiveTabIndex(existingIdx);
        return;
      }

      try {
        const data = await apiFetch<FileContentResponse>(
          `/api/projects/${projectId}/files/read?path=${encodeURIComponent(filePath)}`,
        );
        const newTab: EditorTab = {
          filePath,
          fileName: filePath.split('/').pop() || filePath,
          content: data.content,
          modified: false,
          modifiedAt: data.modifiedAt,
        };
        setTabs((prev) => {
          const next = [...prev, newTab];
          setActiveTabIndex(next.length - 1);
          return next;
        });
      } catch (err) {
        setError((err as ApiError).message || 'Failed to open file');
      }
    },
    [tabs, projectId],
  );

  // Open initial file if provided
  useEffect(() => {
    if (initialFilePath && tabs.length === 0) {
      openFile(initialFilePath);
    }
  }, [initialFilePath, openFile, tabs.length]);

  /* ── Close tab ── */
  const closeTab = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (tab?.modified) {
        setShowUnsaved({ tabIndex: index });
        return;
      }
      setTabs((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (activeTabIndex >= next.length && next.length > 0) {
          setActiveTabIndex(next.length - 1);
        }
        return next;
      });
    },
    [tabs, activeTabIndex],
  );

  /* ── Save file ── */
  const saveFile = useCallback(
    async (tab: EditorTab, index: number) => {
      setSaving(true);
      setError(null);
      try {
        const result = await apiFetch<{ modifiedAt: string }>(
          `/api/projects/${projectId}/files/write?path=${encodeURIComponent(tab.filePath)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ content: tab.content }),
          },
        );
        setTabs((prev) =>
          prev.map((t, i) =>
            i === index ? { ...t, modified: false, modifiedAt: result.modifiedAt } : t,
          ),
        );
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 400) {
          setError('Conflict: file was modified externally. Refresh to see latest version.');
        } else {
          setError(apiErr.message || 'Failed to save');
        }
      } finally {
        setSaving(false);
      }
    },
    [projectId],
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

  /* ── Keyboard shortcut: Ctrl+S ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const activeTab = tabs[activeTabIndex];
        if (activeTab?.modified) {
          saveFile(activeTab, activeTabIndex);
        }
      }
    };
    window.addEventListener('keydown', handler as unknown as EventListener);
    return () => window.removeEventListener('keydown', handler as unknown as EventListener);
  }, [tabs, activeTabIndex, saveFile]);

  const activeTab = tabs[activeTabIndex];
  const extension = activeTab?.fileName.includes('.')
    ? activeTab.fileName.substring(activeTab.fileName.lastIndexOf('.'))
    : '';
  const lineCount = activeTab ? activeTab.content.split('\n').length : 0;

  /* ── Render: empty state ── */
  if (tabs.length === 0 && !initialFilePath) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="editor-empty">
        <p className="font-['Inter'] text-[13px] text-[#556]">Select a file to edit</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]" data-testid="code-editor">
      {/* Tab bar */}
      <div
        className="flex items-center border-b border-[rgba(255,255,255,0.08)] bg-[#0c0c14]"
        data-testid="tab-bar"
      >
        {isMobile && onBack && (
          <button
            onClick={onBack}
            className="px-2 font-['Inter'] text-[11px] text-[#889] hover:text-[#ccd]"
          >
            Back
          </button>
        )}
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab, i) => {
            const tabExt = tab.fileName.includes('.')
              ? tab.fileName.substring(tab.fileName.lastIndexOf('.'))
              : '';
            return (
              <button
                key={tab.filePath}
                onClick={() => setActiveTabIndex(i)}
                className={`flex items-center gap-1.5 border-r border-[rgba(255,255,255,0.06)] px-3 py-1.5 text-left font-['Inter'] text-[12px] transition-colors shrink-0 ${
                  i === activeTabIndex
                    ? 'border-b border-b-[#af0] bg-[#0a0a0f] text-[#f0f0f0]'
                    : 'text-[#889] hover:text-[#ccd]'
                }`}
                data-testid={`tab-${i}`}
              >
                <FileTabIcon extension={tabExt} />
                <span className="max-w-[100px] truncate">{tab.fileName}</span>
                {tab.modified && <span className="text-[#af0]">*</span>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(i);
                  }}
                  className="ml-1 rounded-sm p-0.5 hover:bg-[rgba(255,255,255,0.08)]"
                  data-testid={`close-tab-${i}`}
                >
                  <CloseIcon />
                </button>
              </button>
            );
          })}
        </div>
        {activeTab && (
          <div className="flex items-center gap-2 px-3">
            {saving && <span className="font-['Inter'] text-[10px] text-[#889]">Saving...</span>}
            {!saving && activeTab.modified && (
              <span className="font-['Inter'] text-[10px] text-[#af0]">Modified</span>
            )}
            {extension && <LanguageBadge extension={extension} />}
          </div>
        )}
      </div>

      {/* Editor content */}
      {activeTab && (
        <div className="flex flex-1 overflow-hidden" data-testid="editor-content">
          {/* Line numbers */}
          <div className="overflow-hidden border-r border-[rgba(255,255,255,0.06)] bg-[#0c0c14] px-2 py-2">
            <LineNumbers count={lineCount || 1} />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={activeTab.content}
            onChange={(e) => handleContentChange(e.target.value)}
            className={`flex-1 resize-none bg-transparent p-2 font-['JetBrains_Mono'] text-[13px] leading-[1.6] text-[#d4d4d4] outline-none ${getSyntaxClass(extension)}`}
            spellCheck={false}
            data-testid="editor-textarea"
            aria-label={`Editing ${activeTab.fileName}`}
          />
        </div>
      )}

      {/* Modals */}
      {showUnsaved && (
        <UnsavedModal
          fileName={tabs[showUnsaved.tabIndex]?.fileName || ''}
          onDiscard={() => {
            const idx = showUnsaved.tabIndex;
            setShowUnsaved(null);
            setTabs((prev) => {
              const next = prev.filter((_, i) => i !== idx);
              if (activeTabIndex >= next.length && next.length > 0) {
                setActiveTabIndex(next.length - 1);
              }
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

      {/* Error banner */}
      {error && (
        <div
          className="border-t border-red-500/20 bg-red-500/10 px-3 py-1.5 font-['Inter'] text-[11px] text-red-400"
          data-testid="editor-error"
        >
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-[#889] hover:text-[#ccd]">
            Dismiss
          </button>
        </div>
      )}

      {/* Tab limit warning */}
      {tabs.length >= MAX_TABS && (
        <div className="border-t border-yellow-500/20 bg-yellow-500/10 px-3 py-1.5 font-['Inter'] text-[11px] text-yellow-400">
          Max {MAX_TABS} tabs open
        </div>
      )}
    </div>
  );
}

/* ── Syntax Highlighting Classes ── */

function getSyntaxClass(extension: string): string {
  // Apply a subtle background tint based on file type
  // In production, a full syntax highlighter would be used
  switch (extension) {
    case '.ts':
    case '.tsx':
      return 'editor-syntax-ts';
    case '.js':
    case '.jsx':
      return 'editor-syntax-js';
    case '.json':
      return 'editor-syntax-json';
    case '.md':
      return 'editor-syntax-md';
    case '.css':
      return 'editor-syntax-css';
    case '.html':
      return 'editor-syntax-html';
    default:
      return '';
  }
}
