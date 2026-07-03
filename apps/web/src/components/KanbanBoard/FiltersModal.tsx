import { createPortal } from 'react-dom';
import { labelTint } from './LabelChip';
import type { Label } from '../../lib/api';
import type { KanbanFiltersState } from './KanbanFilters';

interface Project {
  id: string;
  name: string;
}

interface FiltersModalProps {
  open: boolean;
  onClose: () => void;
  filters: KanbanFiltersState;
  projects: Project[];
  /** Labels available for filtering (across the currently loaded projects). */
  labels?: Label[];
  onChange: (filters: KanbanFiltersState) => void;
}

/**
 * Filters dialog opened from the board toolbar. Holds the project + label
 * filters (and grows to host more filter sections over time). The board-level
 * search / type / sort controls stay inline; only the multi-select filters live
 * here.
 */
export function FiltersModal({
  open,
  onClose,
  filters,
  projects,
  labels = [],
  onChange,
}: FiltersModalProps) {
  if (!open) return null;

  const toggleProject = (id: string) => {
    const next = filters.projectIds.includes(id)
      ? filters.projectIds.filter((p) => p !== id)
      : [...filters.projectIds, id];
    onChange({ ...filters, projectIds: next });
  };

  const toggleLabel = (id: string) => {
    const next = filters.labelIds.includes(id)
      ? filters.labelIds.filter((l) => l !== id)
      : [...filters.labelIds, id];
    onChange({ ...filters, labelIds: next });
  };

  const activeCount = filters.projectIds.length + filters.labelIds.length;
  const clear = () => onChange({ ...filters, projectIds: [], labelIds: [] });

  const isEmpty = projects.length === 0 && labels.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-rise mx-4 flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#111118] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-[20px] py-[14px]">
          <div className="flex items-center gap-[8px]">
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 2.5h12L8.5 8v4l-3 1.5V8L1 2.5Z"
                stroke="#b3e502"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <h2 className="text-[17px] font-bold tracking-[-0.2px] text-white">Filters</h2>
            {activeCount > 0 && (
              <span className="rounded-full border border-[#b3e502]/40 bg-[rgba(179,229,2,0.1)] px-[7px] py-[1px] font-['JetBrains_Mono'] text-[11px] text-[#b3e502] tabular-nums">
                {activeCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-[6px] text-[#9aa3ad] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="kb-scroll flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[20px] py-[16px]">
          {isEmpty && (
            <p className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-[12px] py-[14px] text-center text-[12px] text-[#7a828c]">
              No filters available yet.
            </p>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <section className="flex flex-col gap-[10px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
                Projects
              </span>
              <div className="flex flex-wrap gap-[8px]">
                {projects.map((project) => {
                  const active = filters.projectIds.includes(project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => toggleProject(project.id)}
                      aria-pressed={active}
                      className={`rounded-[8px] border px-[11px] py-[6px] text-[12px] font-medium transition-all ${
                        active
                          ? 'border-[#b3e502]/40 bg-[rgba(179,229,2,0.1)] text-[#b3e502]'
                          : 'border-white/[0.07] bg-white/[0.03] text-[#7a828c] hover:border-white/[0.14] hover:text-[#d1d5db]'
                      }`}
                    >
                      {project.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Labels */}
          {labels.length > 0 && (
            <section className="flex flex-col gap-[10px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]">
                Labels
              </span>
              <div className="flex flex-wrap gap-[8px]">
                {labels.map((label) => {
                  const active = filters.labelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      aria-pressed={active}
                      aria-label={`Filter by label ${label.name}`}
                      style={
                        active
                          ? {
                              backgroundColor: labelTint(label.color, 0.16),
                              borderColor: labelTint(label.color, 0.5),
                              color: label.color,
                            }
                          : undefined
                      }
                      className={`inline-flex items-center gap-[6px] rounded-[8px] border px-[10px] py-[5px] text-[12px] font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-[#b3e502]/40 ${
                        active
                          ? ''
                          : 'border-white/[0.07] bg-white/[0.03] text-[#9aa3ad] hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]'
                      }`}
                    >
                      {active ? (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.5l2.5 2.5 4.5-5"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <span
                          className="size-[8px] shrink-0 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                      )}
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-[8px] border-t border-white/[0.08] px-[20px] py-[12px]">
          <button
            type="button"
            onClick={clear}
            disabled={activeCount === 0}
            className="rounded-[9px] px-[12px] py-[7px] text-[12px] font-medium text-[#7a828c] transition-colors hover:text-[#e6e8eb] disabled:opacity-40 disabled:hover:text-[#7a828c]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[9px] bg-[#b3e502] px-[16px] py-[7px] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default FiltersModal;
