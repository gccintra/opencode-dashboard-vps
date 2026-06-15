import { useState, useCallback, useMemo, useEffect } from 'react';
import { apiFetch, fetchLabels, type ApiError, type Label } from '../../lib/api';
import type { Task } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { KanbanFilters, DEFAULT_FILTERS, type KanbanFiltersState } from './KanbanFilters';
import { TaskModal, type TaskFormData } from './TaskModal';
import { TaskDetail } from './TaskDetail';

interface Project {
  id: string;
  name: string;
}

const COLUMNS = ['backlog', 'in_progress', 'done'];

interface KanbanBoardProps {
  /** Called when filters change, so parent can sync URL search params */
  onFiltersChange?: (filters: KanbanFiltersState) => void;
  /** Initial filters from URL, used for hydration */
  initialFilters?: KanbanFiltersState;
}

export default function KanbanBoard({ onFiltersChange, initialFilters }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<KanbanFiltersState>(initialFilters || DEFAULT_FILTERS);

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Mobile: active column tab
  const [activeColumn, setActiveColumn] = useState(0);

  // ── Data fetching ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, projectsData] = await Promise.all([
        apiFetch<Task[]>('/api/tasks'),
        apiFetch<Project[]>('/api/projects'),
      ]);
      const projectList = Array.isArray(projectsData) ? projectsData : [];
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setProjects(projectList);

      // Load labels across all projects (best-effort) for the filter bar.
      const labelLists = await Promise.all(
        projectList.map((p) => fetchLabels(p.id).catch(() => [] as Label[])),
      );
      // De-duplicate by id (labels are project-scoped, so ids are unique).
      const seen = new Set<string>();
      const merged: Label[] = [];
      for (const list of labelLists) {
        for (const label of list) {
          if (!seen.has(label.id)) {
            seen.add(label.id);
            merged.push(label);
          }
        }
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setLabels(merged);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync filters to parent (URL)
  useEffect(() => {
    onFiltersChange?.(filters);
  }, [filters, onFiltersChange]);

  // ── Optimistic move ──
  const handleMove = useCallback(
    async (taskId: string, newColumn: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.column === newColumn) return;

      // Optimistic update
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, column: newColumn } : t)));

      try {
        await apiFetch(`/api/tasks/${taskId}/move`, {
          method: 'PUT',
          body: JSON.stringify({ column: newColumn }),
        });
      } catch {
        // Revert on error
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, column: task.column } : t)));
        setError('Failed to move task');
      }
    },
    [tasks],
  );

  // ── Create task ──
  const handleCreate = useCallback(
    async (data: TaskFormData) => {
      setFormError(null);
      setFormLoading(true);
      try {
        await apiFetch(`/api/projects/${data.projectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({
            title: data.title,
            description: data.description || undefined,
            column: 'backlog',
          }),
        });
        setCreateOpen(false);
        await fetchData();
      } catch (err) {
        setFormError((err as ApiError).message || 'Failed to create task');
      } finally {
        setFormLoading(false);
      }
    },
    [fetchData],
  );

  // ── Delete task ──
  const handleDelete = useCallback(
    async (taskId: string) => {
      setDeleteTarget(taskId);
      try {
        await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        setDeleteTarget(null);
        await fetchData();
      } catch (err) {
        setDeleteTarget(null);
        setError((err as ApiError).message || 'Failed to delete task');
      }
    },
    [fetchData],
  );

  // ── Filtered & sorted tasks ──
  const filteredTasks = useMemo(() => {
    let list = [...tasks];

    // Project filter
    if (filters.projectIds.length > 0) {
      list = list.filter((t) => filters.projectIds.includes(t.projectId));
    }

    // Label filter (task must have ALL selected labels)
    if (filters.labelIds.length > 0) {
      list = list.filter((t) => {
        const ids = new Set((t.labels || []).map((l) => l.id));
        return filters.labelIds.every((id) => ids.has(id));
      });
    }

    // Type filter
    if (filters.type === 'task') {
      list = list.filter((t) => t.source === 'local');
    } else if (filters.type === 'issue') {
      list = list.filter((t) => t.source === 'github');
    }

    // Text search
    if (filters.query.trim()) {
      const q = filters.query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      );
    }

    // Sort
    if (filters.sort === 'created') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (filters.sort === 'updated') {
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    // 'manual' = default sort_order

    return list;
  }, [tasks, filters]);

  const columns = useMemo(() => {
    return COLUMNS.map((col) => ({
      id: col,
      tasks: filteredTasks.filter((t) => t.column === col),
    }));
  }, [filteredTasks]);

  const totalFiltered = filteredTasks.length;

  // ── Render ──

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-[24px] pb-[19px] pt-[18px] sm:px-[32px]">
        <h1 className="font-['Inter'] text-[18px] font-semibold tracking-[-0.18px] text-[#f0f0f0]">
          Tasks
        </h1>
        <button
          onClick={() => {
            setFormError(null);
            setCreateOpen(true);
          }}
          className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-[8px] bg-[#af0] px-[14px] font-['Inter'] text-[13px] font-semibold tracking-[0.13px] text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="#0a0a0f" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">New Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </header>

      {/* Content */}
      <div className="px-[16px] pb-[40px] pt-[20px] sm:px-[32px] sm:pt-[28px]">
        {/* Error banner */}
        {error && (
          <div className="mb-[20px] rounded-[8px] border border-red-500/30 bg-red-500/10 px-[16px] py-[12px] font-['Inter'] text-[14px] text-red-400">
            {error}
            <button onClick={fetchData} className="ml-[8px] underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="mb-[20px]">
          <KanbanFilters
            filters={filters}
            projects={projects}
            labels={labels}
            onChange={setFilters}
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex gap-[16px] overflow-x-auto pb-[20px]">
            {COLUMNS.map((col) => (
              <div
                key={col}
                className="flex w-[280px] shrink-0 flex-col gap-[8px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-[16px] animate-pulse"
              >
                <div className="h-[18px] w-[80px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
                <div className="h-[80px] rounded-[8px] bg-[rgba(255,255,255,0.04)]" />
                <div className="h-[80px] rounded-[8px] bg-[rgba(255,255,255,0.04)]" />
              </div>
            ))}
          </div>
        )}

        {/* Empty: no tasks at all */}
        {!loading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] text-center">
            <div className="mb-[16px] flex size-[56px] items-center justify-center rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#111118]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="2" width="14" height="19" rx="2" stroke="#445" strokeWidth="1.5" />
                <path
                  d="M9 2v3a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15 5V2"
                  stroke="#445"
                  strokeWidth="1.5"
                />
                <path
                  d="M9 12.5l2 2 4-4"
                  stroke="#445"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
              No tasks yet
            </h3>
            <p className="mt-[6px] max-w-[300px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
              Create your first task or sync a GitHub repo to get started.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-[20px] rounded-[8px] bg-[#af0] px-[20px] py-[10px] font-['Inter'] text-[14px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
            >
              Create your first task
            </button>
          </div>
        )}

        {/* No filter results */}
        {!loading && !error && tasks.length > 0 && totalFiltered === 0 && (
          <div className="flex flex-col items-center justify-center py-[64px] text-center">
            <p className="font-['Inter'] text-[15px] text-[#889]">No cards match your filters</p>
            <button
              onClick={() => setFilters({ ...DEFAULT_FILTERS })}
              className="mt-[10px] font-['Inter'] text-[13px] text-[#af0] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Kanban board */}
        {!loading && !error && totalFiltered > 0 && (
          <>
            {/* Desktop: horizontal columns */}
            <div className="hidden lg:flex gap-[16px] items-start pb-[40px]">
              {columns.map((col) => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  title={col.id}
                  count={col.tasks.length}
                  tasks={col.tasks}
                  onEdit={(task) => setDetailTarget(task)}
                  onDelete={handleDelete}
                  onDrop={handleMove}
                />
              ))}
            </div>

            {/* Mobile: tabbed columns */}
            <div className="lg:hidden">
              {/* Column tabs */}
              <div className="mb-[12px] flex gap-[4px] rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-[4px]">
                {COLUMNS.map((col, idx) => {
                  const colTasks = columns.find((c) => c.id === col)?.tasks || [];
                  const isActive = activeColumn === idx;
                  const color =
                    col === 'backlog' ? '#445' : col === 'in_progress' ? '#fa0' : '#2d8';
                  return (
                    <button
                      key={col}
                      onClick={() => setActiveColumn(idx)}
                      className={`flex-1 rounded-[8px] px-[12px] py-[8px] font-['Inter'] text-[12px] font-semibold transition-all ${
                        isActive ? 'bg-[#111118] text-[#f0f0f0]' : 'text-[#889]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-[6px]">
                        <span
                          className="size-[6px] shrink-0 rounded-[3px]"
                          style={{ backgroundColor: color }}
                        />
                        {col === 'backlog'
                          ? 'Backlog'
                          : col === 'in_progress'
                            ? 'Progress'
                            : 'Done'}
                        <span className="font-['JetBrains_Mono'] text-[10px] text-[#445]">
                          {colTasks.length}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active column */}
              {COLUMNS.map((col, idx) => {
                if (idx !== activeColumn) return null;
                const colTasks = columns.find((c) => c.id === col)?.tasks || [];
                return (
                  <div key={col} className="flex flex-col gap-[8px]">
                    {colTasks.map((task) => (
                      <div key={task.id}>
                        {/* Mobile: move-to buttons */}
                        <div className="mb-[2px] flex gap-[4px]">
                          {COLUMNS.filter((c) => c !== col).map((targetCol) => (
                            <button
                              key={targetCol}
                              onClick={() => handleMove(task.id, targetCol)}
                              className="rounded-[4px] border border-[rgba(255,255,255,0.06)] px-[8px] py-[2px] font-['Inter'] text-[10px] text-[#556] hover:border-[rgba(255,255,255,0.12)] hover:text-[#889] transition-colors"
                            >
                              Move to{' '}
                              {targetCol === 'backlog'
                                ? 'Backlog'
                                : targetCol === 'in_progress'
                                  ? 'Progress'
                                  : 'Done'}
                            </button>
                          ))}
                        </div>
                        <div onClick={() => setDetailTarget(task)}>
                          {/* We reuse the KanbanCard styling via a simple rendition */}
                          <div className="rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[14px] cursor-pointer">
                            <h4 className="font-['Inter'] text-[13.5px] font-semibold text-[#f0f0f0]">
                              {task.title}
                            </h4>
                            {task.description && (
                              <p className="mt-[6px] font-['Inter'] text-[12px] text-[#667] line-clamp-2">
                                {task.description}
                              </p>
                            )}
                            <div className="mt-[8px] flex items-center gap-[6px]">
                              {task.source === 'github' ? (
                                <span className="rounded-[4px] bg-[#24292e] px-[6px] py-[1px] font-['Inter'] text-[10px] text-[#f0f0f0]">
                                  #{task.githubIssueNumber || '?'}
                                </span>
                              ) : (
                                <span className="rounded-[4px] border border-[rgba(100,140,255,0.2)] bg-[rgba(100,140,255,0.12)] px-[6px] py-[1px] font-['Inter'] text-[10px] text-[#8af]">
                                  Task
                                </span>
                              )}
                              {task.projectName && (
                                <span className="font-['Inter'] text-[10px] text-[#556]">
                                  {task.projectName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {colTasks.length === 0 && (
                      <div className="py-[40px] text-center">
                        <p className="font-['Inter'] text-[12px] text-[#445]">No tasks</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Create Modal ── */}
      <TaskModal
        open={createOpen}
        title="New Task"
        initial={{
          title: '',
          description: '',
          projectId: projects[0]?.id || '',
        }}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        error={formError}
        loading={formLoading}
      />

      {/* ── Task Detail (rich) ── */}
      {detailTarget && (
        <TaskDetail
          task={detailTarget}
          onChanged={fetchData}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* ── Delete Confirmation Dialog ── */}
      {deleteTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="mx-4 w-full max-w-[380px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
              Delete task?
            </h3>
            <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
              This action cannot be undone.
            </p>
            <div className="mt-[20px] flex justify-end gap-[10px]">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = deleteTarget;
                  setDeleteTarget(null);
                  handleDelete(id);
                }}
                className="rounded-[6px] bg-red-600 px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-white hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
