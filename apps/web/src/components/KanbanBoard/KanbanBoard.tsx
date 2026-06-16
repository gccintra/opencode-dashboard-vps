import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiFetch,
  applyTaskLabels,
  fetchLabels,
  fetchKanbanColumns,
  type ApiError,
  type Label,
  type KanbanColumn,
} from '../../lib/api';
import type { Task } from './KanbanCard';
import { KanbanColumn as KanbanColumnComponent } from './KanbanColumn';
import { KanbanFilters, DEFAULT_FILTERS, type KanbanFiltersState } from './KanbanFilters';
import { TaskModal, type TaskFormData } from './TaskModal';
import { LabelsModal } from './LabelsModal';
import { ColumnsModal } from './ColumnsModal';

interface Project {
  id: string;
  name: string;
}

interface KanbanBoardProps {
  onFiltersChange?: (filters: KanbanFiltersState) => void;
  initialFilters?: KanbanFiltersState;
}

export default function KanbanBoard({ onFiltersChange, initialFilters }: KanbanBoardProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<KanbanFiltersState>(initialFilters || DEFAULT_FILTERS);

  const [createOpen, setCreateOpen] = useState(false);
  const [createColumn, setCreateColumn] = useState<string>('backlog');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [labelsModalOpen, setLabelsModalOpen] = useState(false);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, projectsData, columnsData] = await Promise.all([
        apiFetch<Task[]>('/api/tasks'),
        apiFetch<Project[]>('/api/projects'),
        fetchKanbanColumns(),
      ]);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setKanbanColumns(Array.isArray(columnsData) ? columnsData : []);

      const labelData = await fetchLabels().catch(() => [] as Label[]);
      setLabels(Array.isArray(labelData) ? labelData : []);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    onFiltersChange?.(filters);
  }, [filters, onFiltersChange]);

  // Drag-and-drop handler — moves column (if needed) and places the task at a
  // precise position. `beforeTaskId` is the task that should end up right
  // after the dragged one (null = end of column). The target slot's current
  // `sortOrder` becomes the dragged task's new value; the server shifts the
  // intervening rows by one to make room (see PUT /tasks/:id/reorder).
  const handleDrop = useCallback(
    async (taskId: string, newColumn: string, beforeTaskId: string | null) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const siblings = tasks
        .filter((t) => t.column === newColumn && t.id !== taskId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const beforeTask = beforeTaskId ? siblings.find((t) => t.id === beforeTaskId) : undefined;
      const targetSortOrder = beforeTask
        ? beforeTask.sortOrder
        : (siblings[siblings.length - 1]?.sortOrder ?? -1) + 1;
      const changedColumn = task.column !== newColumn;

      const prevTasks = tasks;
      setTasks((prev) => {
        const without = prev.filter((t) => t.id !== taskId);
        const updated = { ...task, column: newColumn };
        let insertAt = beforeTaskId ? without.findIndex((t) => t.id === beforeTaskId) : -1;
        if (insertAt === -1) {
          const lastInColumn = without.reduce(
            (last, t, i) => (t.column === newColumn ? i : last),
            -1,
          );
          insertAt = lastInColumn + 1;
        }
        without.splice(insertAt, 0, updated);
        return without;
      });

      try {
        if (changedColumn) {
          await apiFetch(`/api/tasks/${taskId}/move`, {
            method: 'PUT',
            body: JSON.stringify({ column: newColumn }),
          });
        }
        await apiFetch(`/api/tasks/${taskId}/reorder`, {
          method: 'PUT',
          body: JSON.stringify({ sortOrder: targetSortOrder }),
        });
      } catch {
        setTasks(prevTasks);
        setError('Failed to reorder task');
      }
    },
    [tasks],
  );

  const handleCreate = useCallback(
    async (data: TaskFormData) => {
      setFormError(null);
      setFormLoading(true);
      try {
        const task = await apiFetch<Task>(`/api/projects/${data.projectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({
            title: data.title,
            description: data.description || undefined,
            column: data.column || createColumn,
            priority: data.priority,
          }),
        });
        if (data.labelIds && data.labelIds.length > 0) {
          await applyTaskLabels(task.id, data.labelIds);
        }
        setCreateOpen(false);
        await fetchData();
      } catch (err) {
        setFormError((err as ApiError).message || 'Failed to create task');
      } finally {
        setFormLoading(false);
      }
    },
    [fetchData, createColumn],
  );

  // Card delete only opens the confirmation — the destructive call happens on confirm.
  const requestDelete = useCallback((taskId: string) => {
    setDeleteTarget(taskId);
  }, []);

  const confirmDelete = useCallback(async () => {
    const taskId = deleteTarget;
    if (!taskId) return;
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      setDeleteTarget(null);
      setError((err as ApiError).message || 'Failed to delete task');
    }
  }, [deleteTarget, fetchData]);

  const filteredTasks = useMemo(() => {
    let list = [...tasks];

    if (filters.projectIds.length > 0) {
      list = list.filter((t) => filters.projectIds.includes(t.projectId));
    }

    if (filters.labelIds.length > 0) {
      list = list.filter((t) => {
        const ids = new Set((t.labels || []).map((l) => l.id));
        return filters.labelIds.every((id) => ids.has(id));
      });
    }

    if (filters.type === 'task') {
      list = list.filter((t) => t.source === 'local');
    } else if (filters.type === 'issue') {
      list = list.filter((t) => t.source === 'github');
    }

    if (filters.query.trim()) {
      const q = filters.query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      );
    }

    if (filters.sort === 'created') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (filters.sort === 'updated') {
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    return list;
  }, [tasks, filters]);

  const totalFiltered = filteredTasks.length;

  const openCreate = (columnId: string) => {
    setCreateColumn(columnId);
    setFormError(null);
    setCreateOpen(true);
  };

  const openTask = (task: Task) => navigate(`/tasks/${task.id}`);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* ══════ Ambient atmosphere ══════ */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="kb-aurora"
          style={{
            top: '-180px',
            left: '-120px',
            width: '620px',
            height: '620px',
            opacity: 0.5,
            background:
              'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-220px',
            left: '38%',
            width: '680px',
            height: '680px',
            opacity: 0.4,
            animationDelay: '-7s',
            background:
              'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)',
          }}
        />
        <div
          className="kb-aurora"
          style={{
            top: '-160px',
            right: '-160px',
            width: '560px',
            height: '560px',
            opacity: 0.38,
            animationDelay: '-13s',
            background:
              'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)',
          }}
        />
        <div className="kb-grid" />
      </div>

      {/* ══════ Header ══════ */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-[12px] border-b border-white/[0.06] px-[20px] py-[16px] sm:px-[32px]">
        <div className="flex items-baseline gap-[12px]">
          <h1 className="font-['Syne'] text-[24px] font-extrabold leading-none tracking-[-0.5px] text-white sm:text-[26px]">
            Tasks
          </h1>
          {!loading && tasks.length > 0 && (
            <span className="font-['JetBrains_Mono'] text-[12px] font-medium text-[#5a626c] tabular-nums">
              {totalFiltered === tasks.length
                ? `${tasks.length}`
                : `${totalFiltered} / ${tasks.length}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-[8px]">
          {/* Columns button */}
          <button
            onClick={() => setColumnsModalOpen(true)}
            className="flex h-[34px] shrink-0 items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[12px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="6" y="3" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="11" y="3" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="hidden sm:inline">Columns</span>
          </button>

          {/* Labels button */}
          <button
            onClick={() => setLabelsModalOpen(true)}
            className="flex h-[34px] shrink-0 items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[12px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path
                d="M1 1h6.5l7 7a1.414 1.414 0 0 1 0 2L9 15.5a1.414 1.414 0 0 1-2 0L.5 9V1z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
            </svg>
            <span className="hidden sm:inline">Labels</span>
          </button>

          {/* New Task button */}
          <button
            onClick={() => openCreate('backlog')}
            className="kb-sheen relative flex h-[34px] shrink-0 items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502] px-[14px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f] shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)]"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="#0a0a0f" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">New Task</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </header>

      {/* ══════ Filters ══════ */}
      <div className="relative z-10 shrink-0 px-[16px] pt-[16px] sm:px-[32px] sm:pt-[20px]">
        {error && (
          <div className="mb-[14px] flex items-center gap-[8px] rounded-[10px] border border-red-500/30 bg-red-500/10 px-[14px] py-[10px] font-['Inter'] text-[13px] text-red-400 backdrop-blur-md">
            <span className="flex-1">{error}</span>
            <button onClick={fetchData} className="font-semibold underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}
        <KanbanFilters filters={filters} projects={projects} labels={labels} onChange={setFilters} />
      </div>

      {/* ══════ Board region (the ONLY horizontal scroll container) ══════ */}
      <div className="relative z-10 mt-[16px] min-h-0 flex-1">
        {/* Loading skeleton */}
        {loading && (
          <div className="kb-scroll flex h-full gap-[20px] overflow-x-auto px-[16px] pb-[20px] sm:px-[32px]">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex w-[312px] shrink-0 flex-col gap-[10px]">
                <div className="h-[20px] w-[130px] animate-pulse rounded-[6px] bg-white/[0.05]" />
                <div className="h-[96px] animate-pulse rounded-[14px] bg-white/[0.03]" />
                <div className="h-[80px] animate-pulse rounded-[14px] bg-white/[0.03]" />
                <div className="h-[110px] animate-pulse rounded-[14px] bg-white/[0.02]" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && tasks.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-[24px] text-center">
            <div className="kb-rise mb-[18px] flex size-[64px] items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.03] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] backdrop-blur-md">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="2" width="14" height="19" rx="2" stroke="#b3e502" strokeWidth="1.5" />
                <path
                  d="M9 12.5l2 2 4-4"
                  stroke="#b3e502"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="font-['Syne'] text-[18px] font-bold text-[#f0f0f0]">No tasks yet</h3>
            <p className="mt-[8px] max-w-[320px] font-['Inter'] text-[13px] leading-[1.55] text-[#7a828c]">
              Create your first task or sync a GitHub repo to get started.
            </p>
            <button
              onClick={() => openCreate('backlog')}
              className="kb-sheen relative mt-[22px] overflow-hidden rounded-[10px] bg-[#b3e502] px-[22px] py-[11px] font-['Inter'] text-[14px] font-bold text-[#0a0a0f] shadow-[0_6px_22px_-6px_rgba(179,229,2,0.6)] transition-all hover:bg-[#c2f516]"
            >
              Create your first task
            </button>
          </div>
        )}

        {/* No filter results */}
        {!loading && !error && tasks.length > 0 && totalFiltered === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-[24px] text-center">
            <p className="font-['Inter'] text-[14px] text-[#9aa3ad]">No tasks match your filters</p>
            <button
              onClick={() => setFilters({ ...DEFAULT_FILTERS })}
              className="mt-[10px] font-['Inter'] text-[13px] font-semibold text-[#b3e502] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Kanban board — same horizontal swimlane layout at every viewport,
            so touch drag-to-move/reorder works identically on mobile (GitLab-style). */}
        {!loading && !error && totalFiltered > 0 && (
          <div className="kb-scroll flex h-full gap-[20px] overflow-x-auto px-[16px] pb-[24px] sm:px-[32px]">
            {kanbanColumns.map((col) => (
              <KanbanColumnComponent
                key={col.id}
                col={col}
                tasks={filteredTasks.filter((t) => t.column === col.id)}
                onEdit={openTask}
                onDelete={requestDelete}
                onDrop={handleDrop}
                onAddTask={() => openCreate(col.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <TaskModal
        open={createOpen}
        title="New Task"
        initial={{
          title: '',
          description: '',
          projectId: projects[0]?.id || '',
          column: createColumn,
          priority: 'medium',
          labelIds: [],
        }}
        projects={projects}
        kanbanColumns={kanbanColumns}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        error={formError}
        loading={formLoading}
      />

      {/* Labels Modal */}
      <LabelsModal open={labelsModalOpen} onClose={() => setLabelsModalOpen(false)} />

      {/* Columns Modal */}
      <ColumnsModal
        open={columnsModalOpen}
        onClose={() => setColumnsModalOpen(false)}
        onChanged={fetchData}
      />

      {/* Delete confirmation */}
      {deleteTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="mx-4 w-full max-w-[380px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-['Syne'] text-[17px] font-bold text-[#f0f0f0]">Delete task?</h3>
            <p className="mt-[8px] font-['Inter'] text-[13px] leading-[1.5] text-[#7a828c]">
              This action cannot be undone.
            </p>
            <div className="mt-[20px] flex justify-end gap-[10px]">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-[8px] border border-white/[0.08] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] transition-colors hover:border-white/[0.16] hover:text-[#e6e8eb]"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-[8px] bg-red-600 px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-white transition-colors hover:bg-red-500"
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
