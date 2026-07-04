import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import FileTree from '../components/FileManager/FileTree';
import CodeEditor from '../components/FileManager/CodeEditor';
import type { FileTreeHandle } from '../components/FileManager/FileTree';
import type { CodeEditorHandle } from '../components/FileManager/CodeEditor';
import { Button, EmptyState } from '../components/ui';

/* ── Types ── */

interface Project {
  id: string;
  name: string;
  directory: string;
}

type MobileView = 'projects' | 'tree' | 'editor';

/* ── Icons ── */

function FolderOpenIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
      <path
        d="M6 12v26a2 2 0 002 2h32a2 2 0 002-2V18a2 2 0 00-2-2H24l-4-4H8a2 2 0 00-2 2z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 3L5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Project Card (mobile list) ── */

function ProjectCard({
  project,
  isSelected,
  onSelect,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-panel border p-[14px] text-left transition-colors active:scale-[0.99] ${
        isSelected
          ? 'border-accent/40 bg-accent/[0.08]'
          : 'border-hairline bg-surface hover:border-hairline-strong'
      }`}
      data-testid={`project-card-${project.id}`}
    >
      <div className="flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="shrink-0 text-accent"
        >
          <path
            d="M2 4v7a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
        <span className="flex-1 truncate text-[13px] font-medium text-ink">
          {project.name}
        </span>
        {isSelected && (
          <span className="shrink-0 rounded-[3px] bg-accent px-1.5 py-px text-[10px] font-medium text-bg">
            selected
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="shrink-0 text-ink-3"
        >
          <path
            d="M4.5 2.5L8 6L4.5 9.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-1 truncate font-['JetBrains_Mono'] text-[10px] text-ink-3">
        {project.directory}
      </div>
    </button>
  );
}

/* ── FilesPage ── */

export default function FilesPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>('projects');
  // Mobile opens one file at a time via initialFilePath + key remount.
  // Desktop opens via imperative ref (multiple tabs supported).
  const [mobileFilePath, setMobileFilePath] = useState<string | null>(null);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const desktopEditorRef = useRef<CodeEditorHandle>(null);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('files-sidebar-w') || 220);
    } catch {
      return 220;
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
        const newW = Math.max(120, Math.min(480, dragStartW.current + (cx - dragStartX.current)));
        setSidebarWidth(newW);
        try {
          localStorage.setItem('files-sidebar-w', String(newW));
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

  /* ── Load projects ── */
  useEffect(() => {
    setLoadingProjects(true);
    apiFetch<Project[]>('/api/projects')
      .then((data) => setProjects(data))
      .catch((err) => setProjectsError((err as ApiError).message || 'Failed to load projects'))
      .finally(() => setLoadingProjects(false));
  }, []);

  /* ── Handlers ── */

  const handleProjectSelect = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setMobileView('tree');
  }, []);

  const handleFileOpen = useCallback((_projectId: string, filePath: string) => {
    // Desktop: open via imperative ref (supports multiple tabs).
    desktopEditorRef.current?.openFile(filePath);
    // Mobile: set initialFilePath + key remount so the editor mounts with the file.
    setMobileFilePath(filePath);
    setMobileView('editor');
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  /* ── Full-page states ── */

  if (loadingProjects) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg">
        <div className="rounded-control border border-danger/30 bg-danger/10 px-[16px] py-[12px] text-[13px] text-danger">
          {projectsError}
          <button
            onClick={() => window.location.reload()}
            className="ml-[8px] underline hover:text-danger/80"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg">
        <EmptyState
          icon={<FolderOpenIcon />}
          title="No projects yet"
          description="Create a project to start managing files."
          action={
            <Button
              variant="primary"
              onClick={() => navigate('/projects')}
              data-testid="create-project-cta"
            >
              Create Project
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-bg"
      data-testid="files-page"
    >
      {/* ═══════════════════════════════
          MOBILE layout  (< 640px / sm)
          Three-view: projects → tree → editor
          ═══════════════════════════════ */}
      <div className="flex h-full flex-col sm:hidden">
        {/* ── View: project list ── */}
        {mobileView === 'projects' && (
          <div className="flex h-full flex-col">
            <div className="shrink-0 border-b border-hairline bg-bg px-[16px] py-[13px]">
              <h1 className="text-[20px] font-semibold tracking-[-0.2px] text-ink">
                Files
              </h1>
              <p className="mt-[2px] text-[12px] text-ink-3">Select a project</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  isSelected={selectedProjectId === p.id}
                  onSelect={() => handleProjectSelect(p.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── View: file tree ── */}
        {mobileView === 'tree' && selectedProjectId && (
          <div className="flex h-full flex-col">
            <div className="shrink-0 flex min-h-[44px] items-center gap-2 border-b border-hairline bg-bg px-3 py-2">
              <button
                onClick={() => setMobileView('projects')}
                className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-control px-2 text-[12px] text-ink-2 active:bg-white/[0.06] active:text-ink"
                data-testid="mobile-back-to-projects"
              >
                <ArrowLeftIcon />
                <span>Projects</span>
              </button>
              <span className="text-ink-3">/</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                {selectedProject?.name}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileTree
                ref={fileTreeRef}
                projectId={selectedProjectId}
                onFileOpen={handleFileOpen}
                isMobile
              />
            </div>
          </div>
        )}

        {/* ── View: code editor ── */}
        {mobileView === 'editor' && selectedProjectId && (
          <div className="flex h-full flex-col">
            {/* key remounts the editor when a different file is selected */}
            <CodeEditor
              key={mobileFilePath}
              initialFilePath={mobileFilePath || undefined}
              projectId={selectedProjectId}
              isMobile
              onBack={() => setMobileView('tree')}
            />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════
          DESKTOP layout  (≥ 640px / sm)
          Project tabs bar + split view
          ═══════════════════════════════ */}
      <div className="hidden h-full min-h-0 flex-col sm:flex">
        {/* Project tab bar */}
        <div className="shrink-0 border-b border-hairline bg-bg px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.5px] text-ink-3">
              Project
            </span>
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProjectSelect(p.id)}
                  className={`shrink-0 rounded-control border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    selectedProjectId === p.id
                      ? 'border-accent/30 bg-accent/10 text-accent'
                      : 'border-hairline text-ink-2 hover:border-hairline-strong hover:text-ink'
                  }`}
                  data-testid={`project-tab-${p.id}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {selectedProject && (
              <span className="ml-2 shrink-0 max-w-[240px] truncate font-['JetBrains_Mono'] text-[10px] text-ink-3">
                {selectedProject.directory}
              </span>
            )}
          </div>
        </div>

        {/* Content area */}
        {!selectedProjectId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[13px] text-ink-3">Select a project above</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              {/* FileTree sidebar — user-resizable via drag handle */}
              <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
                <FileTree
                  ref={fileTreeRef}
                  projectId={selectedProjectId}
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
              {/* CodeEditor main area */}
              <div className="min-w-0 flex-1 overflow-hidden">
                <CodeEditor ref={desktopEditorRef} projectId={selectedProjectId} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
