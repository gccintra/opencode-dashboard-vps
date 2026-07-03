/**
 * Unified Dashboard — command center view.
 *
 * Desktop: AgentPanel (left) + KanbanBoard (center) + MetricsBar (top).
 * Mobile: bottom-tab navigation (Kanban | Agentes | Projetos).
 *
 * Keyboard shortcuts: Ctrl+1 Kanban, Ctrl+2 Agentes, Ctrl+3 Projetos.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AgentPanel from '../components/AgentPanel/AgentPanel';
import { useAgentList, type AgentInfo } from '../components/AgentPanel/useAgentList';
import MetricsBar from '../components/AgentPanel/MetricsBar';
import { KanbanBoard } from '../components/KanbanBoard';
import { apiFetch, type ApiError } from '../lib/api';

/* ── Types ── */

interface Project {
  id: string;
  name: string;
}

type MobileTab = 'kanban' | 'agents' | 'projects';

/* ── Icons ── */

function KanbanIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="5.5" height="18" rx="1" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="8.25" y="8" width="5.5" height="12" rx="1" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="14.5" y="5" width="5.5" height="15" rx="1" fill={active ? '#b3e502' : '#5a626c'} />
    </svg>
  );
}

function AgentsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect
        x="2"
        y="3"
        width="18"
        height="11"
        rx="2"
        stroke={active ? '#b3e502' : '#5a626c'}
        strokeWidth="1.5"
      />
      <path d="M7 18h8" stroke={active ? '#b3e502' : '#5a626c'} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11" y1="14" x2="11" y2="18" stroke={active ? '#b3e502' : '#5a626c'} strokeWidth="1.5" />
      <rect
        x="7"
        y="6"
        width="8"
        height="5"
        rx="1"
        fill={active ? '#b3e502' : 'none'}
        stroke={active ? '#b3e502' : '#5a626c'}
        strokeWidth="0.5"
        opacity="0.4"
      />
    </svg>
  );
}

function ProjectsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="8.5" y="2" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="15" y="2" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="2" y="8.5" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="8.5" y="8.5" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="15" y="8.5" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="2" y="15" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="8.5" y="15" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
      <rect x="15" y="15" width="5" height="5" rx="1.25" fill={active ? '#b3e502' : '#5a626c'} />
    </svg>
  );
}

/* ── Simple Project List (for mobile tab) ── */

function ProjectList({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Project[]>('/api/projects')
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#b3e502] border-t-transparent" />
      </div>
    );
  if (projects.length === 0)
    return (
      <div className="py-8 text-center text-[13px] text-[#5a626c]">
        Nenhum projeto cadastrado
      </div>
    );

  return (
    <div className="grid gap-[10px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 p-[16px]">
      {projects.map((p) => (
        <div
          key={p.id}
          className="cursor-pointer rounded-[8px] border border-white/[0.07] bg-[#111118] p-[16px] hover:border-white/[0.14] transition-colors"
          onClick={() => onSelect(p.id)}
        >
          <h3 className="text-[14px] font-semibold text-[#f0f0f0]">{p.name}</h3>
        </div>
      ))}
    </div>
  );
}

/* ── Dashboard ── */

export default function DashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { metrics } = useAgentList();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('kanban');
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  // Track viewport for responsive layout.
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Keyboard shortcuts: Ctrl+1/2/3.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') {
          e.preventDefault();
          setMobileTab('kanban');
        } else if (e.key === '2') {
          e.preventDefault();
          setMobileTab('agents');
        } else if (e.key === '3') {
          e.preventDefault();
          setMobileTab('projects');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleProjectSelect = useCallback((id: string) => navigate(`/projects/${id}`), [navigate]);

  const handleCreateTask = useCallback(
    (agent: AgentInfo) => {
      if (agent.projectId) {
        navigate(`/tasks?project=${encodeURIComponent(agent.projectId)}`);
      } else {
        navigate('/tasks');
      }
    },
    [navigate],
  );

  const tabs: { key: MobileTab; label: string; Icon: React.FC<{ active: boolean }> }[] = useMemo(
    () => [
      { key: 'kanban', label: 'Kanban', Icon: KanbanIcon },
      { key: 'agents', label: 'Agentes', Icon: AgentsIcon },
      { key: 'projects', label: 'Projetos', Icon: ProjectsIcon },
    ],
    [],
  );

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="kb-aurora" style={{ top: '-200px', left: '-140px', width: 600, height: 600, opacity: 0.4, background: 'radial-gradient(circle, rgba(179,229,2,0.2), rgba(179,229,2,0) 70%)' }} />
        <div className="kb-aurora" style={{ top: '-160px', right: '-160px', width: 560, height: 560, opacity: 0.32, animationDelay: '-9s', background: 'radial-gradient(circle, rgba(139,92,246,0.16), rgba(139,92,246,0) 70%)' }} />
        <div className="kb-grid" />
      </div>
      {/* Header */}
      <header className="relative z-10 shrink-0 flex items-center justify-between border-b border-white/[0.06] px-[16px] py-[10px] backdrop-blur-md">
        <div className="flex items-center gap-[10px]">
          <span className="font-['JetBrains_Mono'] text-[16px] font-medium text-[#b3e502] opacity-75">
            {'> _'}
          </span>
          <h1 className="text-[17px] font-bold tracking-[-0.5px] text-white hidden sm:block">
            Dashboard
          </h1>
        </div>
        <button
          onClick={logout}
          className="flex h-[30px] items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[12px] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]"
        >
          Sair
        </button>
      </header>

      {/* Metrics bar (always visible) */}
      <div className="relative z-10">
        <MetricsBar metrics={metrics} activeFilter={statusFilter} onFilterClick={setStatusFilter} />
      </div>

      {/* Content area */}
      {isMobile ? (
        <>
          {/* Mobile tab content */}
          <div className="relative z-10 flex-1 overflow-y-auto">
            {mobileTab === 'kanban' && (
              <div className="h-full">
                <KanbanBoard />
              </div>
            )}
            {mobileTab === 'agents' && (
              <AgentPanel
                showCreateTask
                showMetricsBar={false}
                onCreateTask={handleCreateTask}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
              />
            )}
            {mobileTab === 'projects' && <ProjectList onSelect={handleProjectSelect} />}
          </div>

          {/* Mobile bottom tabs */}
          <nav className="relative z-10 flex shrink-0 border-t border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md">
            {tabs.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`flex flex-1 flex-col items-center gap-[2px] py-[10px] transition-colors ${
                  mobileTab === key ? 'text-[#b3e502]' : 'text-[#5a626c] hover:text-[#9aa3ad]'
                }`}
                onClick={() => setMobileTab(key)}
                data-testid={`mobile-tab-${key}`}
              >
                <Icon active={mobileTab === key} />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            ))}
          </nav>
        </>
      ) : (
        /* Desktop layout: AgentPanel sidebar + Kanban center */
        <div className="relative z-10 flex flex-1 overflow-hidden">
          {/* Agent panel sidebar */}
          <aside className="w-[280px] shrink-0 border-r border-white/[0.06] overflow-y-auto">
            <AgentPanel
              compact
              showCreateTask
              showMetricsBar={false}
              onCreateTask={handleCreateTask}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </aside>

          {/* Kanban center */}
          <div className="flex-1 overflow-auto">
            <KanbanBoard />
          </div>
        </div>
      )}
    </div>
  );
}
