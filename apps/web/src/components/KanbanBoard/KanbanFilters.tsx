import { useState } from 'react';
import type { Label } from '../../lib/api';
import { FiltersModal } from './FiltersModal';

interface Project {
  id: string;
  name: string;
}

export interface KanbanFiltersState {
  projectIds: string[];
  labelIds: string[];
  type: string; // 'all' | 'task' | 'issue'
  query: string;
  sort: string; // 'created' | 'updated' | 'manual'
}

interface KanbanFiltersProps {
  filters: KanbanFiltersState;
  projects: Project[];
  /** Labels available for filtering (across the currently loaded projects). */
  labels?: Label[];
  onChange: (filters: KanbanFiltersState) => void;
}

export const DEFAULT_FILTERS: KanbanFiltersState = {
  projectIds: [],
  labelIds: [],
  type: 'all',
  query: '',
  sort: 'manual',
};

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'issue', label: 'Issues' },
];

export function KanbanFilters({ filters, projects, labels = [], onChange }: KanbanFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);

  // Multi-select filters (projects + labels) live in the Filters modal.
  const activeCount = filters.projectIds.length + filters.labelIds.length;

  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      {/* Search */}
      <div className="group relative min-w-[180px] flex-1">
        <div className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-3 transition-colors group-focus-within:text-accent">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8.5 8.5L12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <input
          type="text"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Search tasks…"
          className="h-[36px] w-full rounded-[10px] border border-white/[0.07] bg-white/[0.03] pl-[34px] pr-[12px] text-[13px] text-ink placeholder:text-ink-3 outline-none backdrop-blur-md transition-colors focus:border-accent/40 focus:bg-white/[0.05]"
        />
      </div>

      {/* Type segmented control */}
      <div
        role="tablist"
        aria-label="Filter by type"
        className="flex h-[36px] shrink-0 items-center gap-[2px] rounded-[10px] border border-white/[0.07] bg-white/[0.03] p-[3px] backdrop-blur-md"
      >
        {TYPE_OPTIONS.map((opt) => {
          const active = filters.type === opt.value;
          return (
            <button
              key={opt.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ ...filters, type: opt.value })}
              className={`rounded-[7px] px-[12px] py-[5px] text-[12px] font-semibold transition-all ${
                active
                  ? 'bg-accent text-bg'
                  : 'text-ink-2 hover:text-[#d1d5db]'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Sort dropdown */}
      <select
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value })}
        aria-label="Sort tasks"
        className="h-[36px] shrink-0 appearance-none rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-[12px] text-[12px] font-medium text-ink-2 outline-none backdrop-blur-md transition-colors focus:border-accent/40"
      >
        <option value="manual" className="bg-surface">
          Manual
        </option>
        <option value="created" className="bg-surface">
          Created
        </option>
        <option value="updated" className="bg-surface">
          Updated
        </option>
      </select>

      {/* Filters button → opens the filters modal */}
      <button
        type="button"
        onClick={() => setShowFilters(true)}
        aria-label="Filters"
        aria-haspopup="dialog"
        className={`flex h-[36px] shrink-0 items-center gap-[6px] rounded-[10px] border px-[12px] text-[12px] font-medium backdrop-blur-md transition-all ${
          activeCount > 0
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-white/[0.07] bg-white/[0.03] text-ink-2 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-ink'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path
            d="M1 2.5h12L8.5 8v4l-3 1.5V8L1 2.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="hidden sm:inline">Filters</span>
        {activeCount > 0 && (
          <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-[4px] font-['JetBrains_Mono'] text-[10px] font-bold text-bg tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      <FiltersModal
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        projects={projects}
        labels={labels}
        onChange={onChange}
      />
    </div>
  );
}
