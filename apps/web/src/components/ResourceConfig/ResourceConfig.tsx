import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch, type ApiError } from '../../lib/api';

/* ── Types ── */

interface ProjectResource {
  resourceId: string;
  name: string;
  description: string;
  type: 'skill' | 'agent' | 'mcp';
  active: boolean;
  available: boolean;
}

interface ResourcesResponse {
  resources: ProjectResource[];
}

type ResourceType = 'skill' | 'agent' | 'mcp';

const TYPE_LABELS: Record<ResourceType, string> = {
  skill: 'Skills',
  agent: 'Agents',
  mcp: 'MCPs',
};

/* ── Inline Icons ── */

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1.5L13 12H1L7 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <line
        x1="7"
        y1="6"
        x2="7"
        y2="9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.2" />
      <line
        x1="9.5"
        y1="9.5"
        x2="12.5"
        y2="12.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Component ── */

interface ResourceConfigProps {
  projectId: string;
}

export default function ResourceConfig({ projectId }: ResourceConfigProps) {
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResourceType>('skill');
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [scanning, setScanning] = useState(false);

  /* ── Fetch resources ── */

  const fetchResources = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ResourcesResponse>(`/api/projects/${projectId}/resources`);
      setResources(data.resources || []);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  /* ── Toggle resource ── */

  const handleToggle = useCallback(
    async (resourceId: string) => {
      // Optimistic update
      setResources((prev) =>
        prev.map((r) => (r.resourceId === resourceId ? { ...r, active: !r.active } : r)),
      );
      setToggling((prev) => new Set(prev).add(resourceId));

      try {
        const res = await apiFetch<{ active: boolean }>(
          `/api/projects/${projectId}/resources/${resourceId}`,
          { method: 'PUT' },
        );
        // Confirm server state
        setResources((prev) =>
          prev.map((r) => (r.resourceId === resourceId ? { ...r, active: res.active } : r)),
        );
      } catch {
        // Revert on error
        setResources((prev) =>
          prev.map((r) => (r.resourceId === resourceId ? { ...r, active: !r.active } : r)),
        );
      } finally {
        setToggling((prev) => {
          const next = new Set(prev);
          next.delete(resourceId);
          return next;
        });
      }
    },
    [projectId],
  );

  /* ── Remove unavailable ── */

  const scanResources = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      await apiFetch('/api/resources/scan', { method: 'POST' });
      await fetchResources();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to scan resources');
    } finally {
      setScanning(false);
    }
  }, [scanning, fetchResources]);

  const handleRemoveUnavailable = useCallback(async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/resources/unavailable`, { method: 'DELETE' });
      await fetchResources();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to clean up');
    } finally {
      setRemoving(false);
    }
  }, [projectId, removing, fetchResources]);

  /* ── Filtered & counted ── */

  const filtered = useMemo(() => {
    return resources
      .filter((r) => r.type === activeTab)
      .filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [resources, activeTab, search]);

  const counts = useMemo(() => {
    const byType = { skill: 0, agent: 0, mcp: 0 };
    const active = { skill: 0, agent: 0, mcp: 0 };
    for (const r of resources) {
      byType[r.type] = (byType[r.type] || 0) + 1;
      if (r.active) active[r.type] = (active[r.type] || 0) + 1;
    }
    return { byType, active };
  }, [resources]);

  const hasUnavailable = useMemo(() => resources.some((r) => !r.available), [resources]);

  /* ── Render: loading ── */

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4 sm:p-6" data-testid="resource-config-loading">
        <div className="h-8 w-48 animate-pulse rounded bg-white/5" />
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[6px] border border-white/10 bg-[#111118] p-3"
            >
              <div className="flex-1">
                <div className="mb-1 h-4 w-32 animate-pulse rounded bg-white/5" />
                <div className="h-3 w-48 animate-pulse rounded bg-white/5" />
              </div>
              <div className="h-5 w-10 animate-pulse rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Render: error ── */

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 p-8 text-center"
        data-testid="resource-config-error"
      >
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 font-['Inter'] text-[13px] text-red-400">
          {error}
        </p>
        <button
          onClick={fetchResources}
          className="rounded-[6px] border border-white/10 px-[14px] py-[7px] font-['Inter'] text-[13px] font-medium text-[#f0f0f0] hover:border-white/20 transition-colors"
          data-testid="resource-retry-button"
        >
          Retry
        </button>
      </div>
    );
  }

  /* ── Render: data ── */

  return (
    <div className="flex flex-col gap-0" data-testid="resource-config">
      {/* Sub-tabs */}
      <div className="flex border-b border-white/10" role="tablist">
        {(Object.keys(TYPE_LABELS) as ResourceType[]).map((type) => (
          <button
            key={type}
            role="tab"
            aria-selected={activeTab === type}
            onClick={() => setActiveTab(type)}
            className={`px-4 py-3 font-['Inter'] text-[13px] font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === type
                ? 'border-[#af0] text-[#af0]'
                : 'border-transparent text-[#889] hover:text-[#ccd]'
            }`}
            data-testid={`resource-tab-${type}`}
          >
            {TYPE_LABELS[type]} ({counts.active[type]} of {counts.byType[type]} active)
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-3 pb-1">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#556]">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="Filter resources…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-[6px] border border-white/10 bg-[#111118] py-2 pl-9 pr-3 font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#556] outline-none focus:border-white/20 transition-colors"
              data-testid="resource-search"
            />
          </div>
          <button
            onClick={scanResources}
            disabled={scanning}
            className="shrink-0 rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#111118] px-3 py-2 font-['Inter'] text-[12px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
            data-testid="resource-scan-button"
            title="Re-scan opencode resource directories"
          >
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
      </div>

      {/* Resource list */}
      <div className="flex flex-col p-3 pt-1 gap-1" data-testid="resource-list">
        {filtered.length === 0 && !search && (
          <div
            className="py-8 text-center font-['Inter'] text-[13px] text-[#667]"
            data-testid="resource-empty"
          >
            No {TYPE_LABELS[activeTab].toLowerCase()} found for this project.
          </div>
        )}
        {filtered.length === 0 && search && (
          <div
            className="py-8 text-center font-['Inter'] text-[13px] text-[#667]"
            data-testid="resource-no-results"
          >
            No resources match &ldquo;{search}&rdquo;.{' '}
            <button onClick={() => setSearch('')} className="text-[#af0] hover:underline">
              Clear search
            </button>
          </div>
        )}
        {filtered.map((resource) => (
          <div
            key={resource.resourceId}
            className="flex items-center gap-3 rounded-[6px] border border-white/10 bg-[#111118] px-3 py-2.5 transition-colors hover:border-white/20"
            data-testid={`resource-row-${resource.resourceId}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="font-['Inter'] text-[13px] font-medium text-[#f0f0f0] truncate"
                  data-testid="resource-name"
                >
                  {resource.name}
                </span>
                {!resource.available && (
                  <span
                    className="shrink-0 text-[#889] cursor-help"
                    title="Indisponível — this resource no longer exists on disk"
                    data-testid="resource-unavailable-icon"
                  >
                    <WarningIcon />
                  </span>
                )}
              </div>
              <p className="font-['Inter'] text-[12px] text-[#667] truncate mt-0.5">
                {resource.description}
              </p>
            </div>

            {/* Toggle */}
            <button
              onClick={() => handleToggle(resource.resourceId)}
              disabled={!resource.available || toggling.has(resource.resourceId)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                !resource.available
                  ? 'bg-white/5 cursor-not-allowed opacity-40'
                  : resource.active
                    ? 'bg-[#af0]'
                    : 'bg-white/10'
              }`}
              role="switch"
              aria-checked={resource.active}
              aria-disabled={!resource.available}
              data-testid={`resource-toggle-${resource.resourceId}`}
              title={!resource.available ? 'Indisponível' : resource.active ? 'Disable' : 'Enable'}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-[#0a0a0f] shadow-sm transition-transform ${
                  resource.active && resource.available ? 'translate-x-[18px]' : 'translate-x-[3px]'
                } ${toggling.has(resource.resourceId) ? 'opacity-60' : ''}`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Batch cleanup button */}
      {hasUnavailable && (
        <div className="border-t border-white/10 px-3 py-2">
          <button
            onClick={handleRemoveUnavailable}
            disabled={removing}
            className="flex items-center gap-1.5 rounded-[6px] border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 font-['Inter'] text-[12px] text-yellow-400 hover:border-yellow-500/50 transition-colors disabled:opacity-50"
            data-testid="cleanup-unavailable-button"
          >
            {removing ? 'Cleaning…' : 'Limpar indisponíveis'}
          </button>
        </div>
      )}
    </div>
  );
}
