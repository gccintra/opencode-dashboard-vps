import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch, fetchKanbanColumns, type ApiError, type KanbanColumn } from '../lib/api';
import type { Task } from '../components/KanbanBoard/KanbanCard';
import { TaskDetail } from '../components/KanbanBoard/TaskDetail';

/**
 * Full-page route for a single task (`/tasks/:taskId`).
 *
 * The board's `/api/tasks` already returns the enriched task shape the detail
 * view expects, so we load the list + columns and resolve the task by id.
 */
export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<Task | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` refreshes data in place without flipping the full-screen spinner.
  // Inline edits (title, body, status, agent config…) call this via onChanged;
  // toggling `loading` there would unmount + remount <TaskDetail>, wiping its
  // local state and making the whole screen appear to restart.
  const load = useCallback(
    async (silent = false) => {
      if (!taskId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [tasks, cols] = await Promise.all([
          apiFetch<Task[]>('/api/tasks'),
          fetchKanbanColumns().catch(() => [] as KanbanColumn[]),
        ]);
        const found = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) ?? null : null;
        setTask(found);
        setColumns(Array.isArray(cols) ? cols : []);
      } catch (err) {
        setError((err as ApiError).message || 'Failed to load task');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const goBack = () => navigate('/tasks');

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0f]">
        <div className="size-8 animate-spin rounded-full border-2 border-[#b3e502] border-t-transparent" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[14px] bg-[#0a0a0f] px-[24px] text-center">
        <h2 className="text-[20px] font-bold text-[#f0f0f0]">
          {error ? 'Could not load task' : 'Task not found'}
        </h2>
        <p className="max-w-[320px] text-[13px] leading-[1.55] text-[#7a828c]">
          {error || 'This task may have been deleted or moved.'}
        </p>
        <button
          onClick={goBack}
          className="rounded-[10px] bg-[#b3e502] px-[18px] py-[9px] text-[13px] font-bold text-[#0a0a0f] transition-colors hover:bg-[#c2f516]"
        >
          Back to board
        </button>
      </div>
    );
  }

  return (
    <TaskDetail task={task} kanbanColumns={columns} onChanged={refresh} onClose={goBack} />
  );
}
