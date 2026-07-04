import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import FileTree from '../components/FileManager/FileTree';
import CodeEditor from '../components/FileManager/CodeEditor';
import type { FileTreeHandle } from '../components/FileManager/FileTree';
import type { CodeEditorHandle } from '../components/FileManager/CodeEditor';
import { Button } from '../components/ui';

/* ── Types ── */

interface HarnessEntry {
  id: string;
  name: string;
  description: string;
  fileCount: number;
}

type MobileView = 'tree' | 'editor';

/* ── Icons ── */

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M9 3L4 7l5 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Page ── */

export default function HarnessManagerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [harness, setHarness] = useState<HarnessEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>('tree');
  const [mobileFilePath, setMobileFilePath] = useState<string | null>(null);

  const fileTreeRef = useRef<FileTreeHandle>(null);
  const desktopEditorRef = useRef<CodeEditorHandle>(null);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('harness-mgr-sidebar-w') || 240);
    } catch {
      return 240;
    }
  });
  const isDraggingSidebar = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const handleSidebarDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      isDraggingSidebar.current = true;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      dragStartX.current = clientX;
      dragStartW.current = sidebarWidth;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!isDraggingSidebar.current) return;
        const cx =
          'touches' in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
        const newW = Math.max(160, Math.min(520, dragStartW.current + (cx - dragStartX.current)));
        setSidebarWidth(newW);
        try {
          localStorage.setItem('harness-mgr-sidebar-w', String(newW));
        } catch {
          /* ignore */
        }
      };
      const onUp = () => {
        isDraggingSidebar.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchend', onUp);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiFetch<HarnessEntry[]>('/api/harnesses')
      .then((list) => {
        const found = list.find((h) => h.id === id);
        if (!found) {
          setError('Template not found');
          return;
        }
        setHarness(found);
      })
      .catch((err) => setError((err as ApiError).message || 'Failed to load template'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleFileOpen = useCallback((_projectId: string, filePath: string) => {
    desktopEditorRef.current?.openFile(filePath);
    setMobileFilePath(filePath);
    setMobileView('editor');
  }, []);

  if (!id) return null;

  const filesApiBase = `/api/harnesses/${encodeURIComponent(id)}/fm/files`;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[14px] bg-bg">
        <p className="rounded-control border border-danger/30 bg-danger/10 px-[16px] py-[12px] text-[13px] text-danger">
          {error}
        </p>
        <Button variant="primary" onClick={() => navigate('/templates')}>
          Back to Templates
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-testid="harness-manager-page">
      {/* Header */}
      <div className="shrink-0 border-b border-hairline bg-bg px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/templates')}
            className="flex items-center gap-1.5 rounded-control px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <ArrowLeftIcon />
            <span className="hidden sm:inline">Templates</span>
          </button>
          <span className="text-ink-3">/</span>
          <span className="text-[14px] font-semibold text-ink">
            {harness?.name ?? id}
          </span>
          {harness?.description && (
            <span className="hidden sm:block truncate text-[12px] text-ink-3">
              — {harness.description}
            </span>
          )}
        </div>
      </div>

      {/* ════ MOBILE ════ */}
      <div className="flex h-full min-h-0 flex-col sm:hidden">
        {mobileView === 'tree' && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileTree
                ref={fileTreeRef}
                projectId={id}
                filesApiBase={filesApiBase}
                onFileOpen={handleFileOpen}
                isMobile
              />
            </div>
          </div>
        )}

        {mobileView === 'editor' && (
          <div className="flex h-full min-h-0 flex-col">
            <CodeEditor
              key={mobileFilePath}
              projectId={id}
              filesApiBase={filesApiBase}
              initialFilePath={mobileFilePath || undefined}
              isMobile
              onBack={() => {
                setMobileView('tree');
                fileTreeRef.current?.refresh();
              }}
            />
          </div>
        )}
      </div>

      {/* ════ DESKTOP ════ */}
      <div className="hidden min-h-0 flex-1 sm:flex">
        {/* FileTree sidebar */}
        <div
          className="shrink-0 overflow-hidden border-r border-hairline"
          style={{ width: sidebarWidth }}
        >
          <FileTree
            ref={fileTreeRef}
            projectId={id}
            filesApiBase={filesApiBase}
            onFileOpen={handleFileOpen}
          />
        </div>
        {/* Drag handle */}
        <div
          className="w-[4px] shrink-0 cursor-col-resize bg-white/[0.04] hover:bg-accent/30 transition-colors active:bg-accent/50"
          onMouseDown={handleSidebarDragStart}
          onTouchStart={handleSidebarDragStart}
          title="Drag to resize"
        />
        {/* CodeEditor */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <CodeEditor ref={desktopEditorRef} projectId={id} filesApiBase={filesApiBase} />
        </div>
      </div>
    </div>
  );
}
