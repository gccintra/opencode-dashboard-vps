interface Project {
  id: string;
  name: string;
}

export interface KanbanFiltersState {
  projectIds: string[];
  type: string; // 'all' | 'task' | 'issue'
  query: string;
  sort: string; // 'created' | 'updated' | 'manual'
}

interface KanbanFiltersProps {
  filters: KanbanFiltersState;
  projects: Project[];
  onChange: (filters: KanbanFiltersState) => void;
}

export const DEFAULT_FILTERS: KanbanFiltersState = {
  projectIds: [],
  type: 'all',
  query: '',
  sort: 'manual',
};

export function KanbanFilters({ filters, projects, onChange }: KanbanFiltersProps) {
  const hasActiveFilters =
    filters.projectIds.length > 0 || filters.type !== 'all' || filters.query.trim() !== '';

  const clearFilters = () => {
    onChange({ ...DEFAULT_FILTERS });
  };

  const toggleProject = (id: string) => {
    const next = filters.projectIds.includes(id)
      ? filters.projectIds.filter((p) => p !== id)
      : [...filters.projectIds, id];
    onChange({ ...filters, projectIds: next });
  };

  return (
    <div className="flex flex-col gap-[12px]">
      {/* Search + Sort row */}
      <div className="flex items-center gap-[10px]">
        {/* Search */}
        <div className="relative flex-1">
          <div className="absolute left-[10px] top-1/2 -translate-y-1/2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5.5" cy="5.5" r="4" stroke="#445" strokeWidth="1.2" />
              <path d="M8.5 8.5L12 12" stroke="#445" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search tasks…"
            className="h-[34px] w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] pl-[32px] pr-[12px] font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
          />
        </div>

        {/* Sort dropdown */}
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value })}
          className="h-[34px] shrink-0 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] px-[10px] font-['Inter'] text-[12px] font-medium text-[#889] outline-none focus:border-[rgba(255,255,255,0.16)] appearance-none"
        >
          <option value="manual">Manual</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
      </div>

      {/* Filter chips row */}
      <div className="flex flex-wrap items-center gap-[8px]">
        {/* Type filter */}
        <button
          onClick={() =>
            onChange({
              ...filters,
              type: filters.type === 'all' ? 'task' : filters.type === 'task' ? 'issue' : 'all',
            })
          }
          className={`rounded-[6px] border px-[10px] py-[5px] font-['Inter'] text-[11px] font-medium transition-colors ${
            filters.type === 'all'
              ? 'border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.16)]'
              : filters.type === 'task'
                ? 'border-[rgba(100,140,255,0.3)] bg-[rgba(100,140,255,0.1)] text-[#8af]'
                : 'border-[rgba(255,255,255,0.08)] bg-[#24292e] text-[#f0f0f0]'
          }`}
        >
          {filters.type === 'all' ? 'All' : filters.type === 'task' ? 'Tasks' : 'Issues'}
        </button>

        {/* Project filter chips */}
        {projects.map((project) => {
          const active = filters.projectIds.includes(project.id);
          return (
            <button
              key={project.id}
              onClick={() => toggleProject(project.id)}
              className={`rounded-[6px] border px-[10px] py-[5px] font-['Inter'] text-[11px] font-medium transition-colors ${
                active
                  ? 'border-[rgba(170,255,0,0.3)] bg-[rgba(170,255,0,0.1)] text-[#af0]'
                  : 'border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.16)]'
              }`}
            >
              {project.name}
            </button>
          );
        })}

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[10px] py-[5px] font-['Inter'] text-[11px] font-medium text-[#889] hover:text-[#ccd] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
