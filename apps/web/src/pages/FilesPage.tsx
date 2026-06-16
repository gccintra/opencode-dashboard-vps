import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import FileTree from '../components/FileManager/FileTree';
import CodeEditor from '../components/FileManager/CodeEditor';
import type { FileTreeHandle } from '../components/FileManager/FileTree';
import type { CodeEditorHandle } from '../components/FileManager/CodeEditor';

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
    <svg width="30" height="30" viewBox="0 0 48 48" fill="none">
      <path
        d="M6 12v26a2 2 0 002 2h32a2 2 0 002-2V18a2 2 0 00-2-2H24l-4-4H8a2 2 0 00-2 2z"
        stroke="#b3e502"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ── Atmosphere layer ── */

function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="kb-aurora"
        style={{
          top: '-180px',
          left: '-120px',
          width: 620,
          height: 620,
          opacity: 0.5,
          background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)',
        }}
      />
      <div
        className="kb-aurora"
        style={{
          top: '-220px',
          left: '38%',
          width: 680,
          height: 680,
          opacity: 0.4,
          animationDelay: '-7s',
          background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)',
        }}
      />
      <div
        className="kb-aurora"
        style={{
          top: '-160px',
          right: '-160px',
          width: 560,
          height: 560,
          opacity: 0.38,
          animationDelay: '-13s',
          background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)',
        }}
      />
      <div className="kb-grid" />
    </div>
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
      className={`w-full rounded-[12px] border p-[14px] text-left backdrop-blur-md transition-all active:scale-[0.99] ${
        isSelected
          ? 'border-[#b3e502]/40 bg-[rgba(179,229,2,0.08)]'
          : 'border-white/[0.06] bg-white/[0.04] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] hover:border-white/[0.12] hover:bg-white/[0.05]'
      }`}
      data-testid={`project-card-${project.id}`}
    >
      <div className="flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="shrink-0 text-[#b3e502]"
        >
          <path
            d="M2 4v7a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
        <span className="flex-1 truncate font-['Inter'] text-[13px] font-medium text-[#f0f0f0]">
          {project.name}
        </span>
        {isSelected && (
          <span className="shrink-0 rounded-[3px] bg-[#b3e502] px-1.5 py-px font-['Inter'] text-[10px] font-medium text-[#0a0a0f]">
            selected
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="shrink-0 text-[#5a626c]"
        >
          <path
            d="M4.5 2.5L8 6L4.5 9.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-1 truncate font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
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
      <div className="flex h-full items-center justify-center bg-[#0a0a0f]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#b3e502] border-t-transparent" />
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-3 overflow-hidden bg-[#0a0a0f]">
        <Atmosphere />
        <div className="relative z-10 rounded-[10px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[13px] text-red-400 backdrop-blur-md">
          {projectsError}
          <button
            onClick={() => window.location.reload()}
            className="ml-[8px] underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0f]">
        <Atmosphere />
        <div className="kb-rise relative z-10 flex flex-col items-center text-center">
          <div className="mb-[16px] flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
            <FolderOpenIcon />
          </div>
          <h3 className="font-['Syne'] text-[20px] font-bold text-white">No projects yet</h3>
          <p className="mt-[6px] max-w-[280px] font-['Inter'] text-[13px] leading-relaxed text-[#7a828c]">
            Create a project to start managing files.
          </p>
          <button
            onClick={() => navigate('/projects')}
            className="kb-sheen relative mt-[22px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516]"
            data-testid="create-project-cta"
          >
            Create Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0f]"
      data-testid="files-page"
    >
      <Atmosphere />
      {/* ═══════════════════════════════
          MOBILE layout  (< 640px / sm)
          Three-view: projects → tree → editor
          ═══════════════════════════════ */}
      <div className="relative z-10 flex h-full flex-col sm:hidden">
        {/* ── View: project list ── */}
        {mobileView === 'projects' && (
          <div className="flex h-full flex-col">
            <div className="shrink-0 border-b border-white/[0.06] bg-[#0a0a0f]/80 px-[16px] py-[13px] backdrop-blur-md">
              <h1 className="font-['Syne'] text-[24px] font-extrabold tracking-[-0.5px] text-white">
                Files
              </h1>
              <p className="mt-[2px] font-['Inter'] text-[12px] text-[#7a828c]">Select a project</p>
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
            <div className="shrink-0 flex min-h-[44px] items-center gap-2 border-b border-white/[0.07] bg-[#0a0a0f] px-3 py-2">
              <button
                onClick={() => setMobileView('projects')}
                className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-[6px] px-2 font-['Inter'] text-[12px] text-[#9aa3ad] active:bg-[rgba(255,255,255,0.06)] active:text-[#ccd]"
                data-testid="mobile-back-to-projects"
              >
                <ArrowLeftIcon />
                <span>Projects</span>
              </button>
              <span className="text-[#5a626c]">/</span>
              <span className="min-w-0 flex-1 truncate font-['Inter'] text-[12px] font-medium text-[#f0f0f0]">
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
      <div className="relative z-10 hidden h-full min-h-0 flex-col sm:flex">
        {/* Project tab bar */}
        <div className="shrink-0 border-b border-white/[0.06] bg-[#0a0a0f]/80 px-4 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="shrink-0 font-['Inter'] text-[10px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
              Project
            </span>
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProjectSelect(p.id)}
                  className={`shrink-0 rounded-[5px] border px-2.5 py-1 font-['Inter'] text-[12px] font-medium transition-colors ${
                    selectedProjectId === p.id
                      ? 'border-[rgba(179,229,2,0.3)] bg-[rgba(179,229,2,0.1)] text-[#b3e502]'
                      : 'border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
                  }`}
                  data-testid={`project-tab-${p.id}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {selectedProject && (
              <span className="ml-2 shrink-0 max-w-[240px] truncate font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
                {selectedProject.directory}
              </span>
            )}
          </div>
        </div>

        {/* Content area */}
        {!selectedProjectId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-['Inter'] text-[13px] text-[#5a626c]">Select a project above</p>
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
                className="w-[4px] shrink-0 cursor-col-resize bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(179,229,2,0.3)] transition-colors active:bg-[rgba(179,229,2,0.5)]"
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
