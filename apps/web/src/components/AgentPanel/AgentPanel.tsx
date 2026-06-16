/**
 * AgentPanel — grid of AgentCards with search and filtering.
 *
 * Desktop: 2-3 column grid. Mobile: vertical list.
 * Ctrl+K: search modal overlay.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentCard from './AgentCard';
import StatusBadge from '../StatusBadge/StatusBadge';
import { useAgentList, type AgentInfo, type AgentMetrics } from './useAgentList';
import MetricsBar from './MetricsBar';

interface AgentPanelProps {
  /** Whether to show the panel in compact mode (for sidebar). */
  compact?: boolean;
  /** Whether to show the "Create task" option. */
  showCreateTask?: boolean;
  /** Called when "Create task" is clicked. */
  onCreateTask?: (agent: AgentInfo) => void;
  /** External filter state for when the panel is controlled by a parent. */
  statusFilter?: string | null;
  /** Called when the user changes the status filter. */
  onStatusFilterChange?: (status: string | null) => void;
  /** Whether to render the MetricsBar inside the panel. Defaults to true.
   *  Set to false when the parent already renders a MetricsBar. */
  showMetricsBar?: boolean;
}

export default function AgentPanel({
  compact = false,
  showCreateTask = false,
  onCreateTask,
  statusFilter,
  onStatusFilterChange,
  showMetricsBar = true,
}: AgentPanelProps) {
  const { agents, metrics, loading, error, refresh, closeAgent, renameAgent } = useAgentList();
  const navigate = useNavigate();

  // Internal filter state (used when not controlled by parent).
  const [internalFilter, setInternalFilter] = useState<string | null>(null);
  const effectiveFilter = statusFilter !== undefined ? statusFilter : internalFilter;

  // Search modal state.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  // Filtered agents.
  const filteredAgents = useMemo(() => {
    let list = agents;
    if (effectiveFilter) {
      list = list.filter((a) => a.status === effectiveFilter);
    }
    return list;
  }, [agents, effectiveFilter]);

  // Search results.
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.projectName && a.projectName.toLowerCase().includes(q)),
    );
  }, [agents, searchQuery]);

  // Ctrl+K / Cmd+K global search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        setSearchQuery('');
        setSearchIndex(0);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  // Keyboard navigation in search.
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (searchResults.length === 1) {
          navigateToAgent(searchResults[0]);
        } else if (searchResults[searchIndex]) {
          navigateToAgent(searchResults[searchIndex]);
        }
        setSearchOpen(false);
      }
    },
    [searchResults, searchIndex],
  );

  const navigateToAgent = useCallback(
    (agent: AgentInfo) => {
      if (agent.status === 'finished') return;
      if (agent.type === 'emergency') {
        navigate('/emergency');
      } else if (agent.projectId) {
        navigate(`/projects/${agent.projectId}`);
      }
    },
    [navigate],
  );

  const handleFilterClick = useCallback(
    (status: string | null) => {
      const next = effectiveFilter === status ? null : status;
      if (onStatusFilterChange) {
        onStatusFilterChange(next);
      } else {
        setInternalFilter(next);
      }
    },
    [effectiveFilter, onStatusFilterChange],
  );

  return (
    <div className="flex flex-col h-full" data-testid="agent-panel">
      {/* Metrics bar */}
      {showMetricsBar && (
        <MetricsBar
          metrics={metrics}
          activeFilter={effectiveFilter}
          onFilterClick={handleFilterClick}
        />
      )}

      {/* Search bar (mobile: visible button) */}
      {!compact && (
        <div className="flex items-center gap-[8px] px-[16px] py-[8px]">
          <button
            className="flex flex-1 items-center gap-[8px] rounded-[6px] border border-white/[0.07] bg-[#0a0a0f] px-[12px] py-[6px] font-['Inter'] text-[12px] text-[#5a626c] hover:border-white/[0.14] transition-colors"
            onClick={() => setSearchOpen(true)}
            data-testid="search-trigger"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M9.5 9.5L13 13"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>Buscar agentes...</span>
            <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">Ctrl+K</span>
          </button>
        </div>
      )}

      {/* Filter active indicator */}
      {effectiveFilter && (
        <div className="px-[16px] pb-[4px]">
          <button
            className="inline-flex items-center gap-[4px] rounded-[4px] bg-[rgba(179,229,2,0.08)] px-[8px] py-[2px] font-['Inter'] text-[11px] text-[#b3e502] hover:bg-[rgba(179,229,2,0.12)] transition-colors"
            onClick={() => handleFilterClick(null)}
          >
            {effectiveFilter === 'waiting'
              ? 'Aguardando'
              : effectiveFilter === 'active'
                ? 'Ativos'
                : 'Finalizados'}
            <span className="text-[#9aa3ad]">×</span>
          </button>
        </div>
      )}

      {/* Agent grid / list */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[16px]">
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center py-[32px]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#b3e502] border-t-transparent" />
          </div>
        ) : error ? (
          <div className="py-[16px] text-center font-['Inter'] text-[12px] text-[#f54]">
            {error}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="py-[32px] text-center font-['Inter'] text-[13px] text-[#5a626c]">
            {agents.length === 0
              ? 'Nenhum agente ativo. Abra uma sessão em um projeto.'
              : 'Nenhum agente encontrado para este filtro.'}
          </div>
        ) : (
          <div
            className={`grid gap-[10px] ${
              compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3'
            }`}
          >
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClose={closeAgent}
                onRename={renameAgent}
                pulse={agent.status === 'waiting'}
                showCreateTask={showCreateTask}
                onCreateTask={onCreateTask}
              />
            ))}
          </div>
        )}
      </div>

      {/* Search modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          data-testid="search-modal"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70" onClick={() => setSearchOpen(false)} />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-[480px] rounded-[12px] border border-white/[0.07] bg-[#16161f] shadow-2xl">
            <div className="flex items-center gap-[8px] border-b border-white/[0.07] px-[16px] py-[12px]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="#9aa3ad" strokeWidth="1.25" />
                <path d="M11 11l4 4" stroke="#9aa3ad" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
              <input
                className="flex-1 bg-transparent font-['Inter'] text-[14px] text-[#f0f0f0] placeholder-[#556] outline-none"
                placeholder="Buscar por nome ou projeto..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                autoFocus
                data-testid="search-input"
              />
              <span className="font-['JetBrains_Mono'] text-[11px] text-[#5a626c]">esc</span>
            </div>
            <div className="max-h-[320px] overflow-y-auto py-[4px]">
              {searchResults.length === 0 && searchQuery.trim() ? (
                <div className="px-[16px] py-[16px] text-center font-['Inter'] text-[13px] text-[#5a626c]">
                  Nenhuma sessão encontrada
                </div>
              ) : (
                searchResults.map((agent, idx) => (
                  <div
                    key={agent.id}
                    className={`flex cursor-pointer items-center gap-[10px] px-[16px] py-[10px] transition-colors ${
                      idx === searchIndex
                        ? 'bg-[rgba(179,229,2,0.08)]'
                        : 'hover:bg-[rgba(255,255,255,0.03)]'
                    }`}
                    onClick={() => {
                      navigateToAgent(agent);
                      setSearchOpen(false);
                    }}
                    data-testid={`search-result-${agent.id}`}
                  >
                    <span className="shrink-0">
                      <StatusBadge
                        status={
                          agent.type === 'emergency'
                            ? 'emergency'
                            : agent.status === 'finished'
                              ? 'finished'
                              : agent.status === 'waiting'
                                ? 'waiting'
                                : 'active'
                        }
                        size="sm"
                      />
                    </span>
                    <span className="flex-1 truncate font-['Inter'] text-[13px] font-medium text-[#f0f0f0]">
                      {agent.name}
                    </span>
                    <span className="shrink-0 truncate font-['Inter'] text-[11px] text-[#9aa3ad] max-w-[140px]">
                      {agent.projectName || (agent.type === 'emergency' ? '/root' : '—')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
