import { useEffect, useMemo, useState } from 'react';
import {
  apiFetch,
  createTaskLink,
  deleteTaskLink,
  fetchTaskLinks,
  type ApiError,
  type LinkType,
  type TaskLink,
} from '../../lib/api';
import type { Task } from './KanbanCard';

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-3";

const LINK_TYPE_LABELS: Record<LinkType, string> = {
  relates_to: 'Relates to',
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  duplicates: 'Duplicates',
};

const LINK_TYPE_ORDER: LinkType[] = ['blocks', 'blocked_by', 'relates_to', 'duplicates'];

interface LinkedTasksProps {
  taskId: string;
  onChanged?: () => void;
}

/** GitLab-style linked-issues section with a typed picker. */
export function LinkedTasks({ taskId, onChanged }: LinkedTasksProps) {
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [linkType, setLinkType] = useState<LinkType>('relates_to');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchTaskLinks(taskId)
      .then((data) => setLinks(Array.isArray(data) ? data : []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTaskLinks(taskId)
      .then((data) => {
        if (!cancelled) setLinks(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setLinks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Lazy-load the task list only when the picker opens.
  useEffect(() => {
    if (!adding || allTasks.length > 0) return;
    apiFetch<Task[]>('/api/tasks')
      .then((data) => setAllTasks(Array.isArray(data) ? data : []))
      .catch(() => setAllTasks([]));
  }, [adding, allTasks.length]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.task.id)), [links]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks
      .filter((t) => t.id !== taskId && !linkedIds.has(t.id))
      .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [allTasks, search, taskId, linkedIds]);

  const grouped = useMemo(() => {
    const map = new Map<LinkType, TaskLink[]>();
    for (const l of links) {
      const arr = map.get(l.type) ?? [];
      arr.push(l);
      map.set(l.type, arr);
    }
    return map;
  }, [links]);

  const addLink = async (targetTaskId: string) => {
    setError(null);
    try {
      await createTaskLink(taskId, targetTaskId, linkType);
      setSearch('');
      setAdding(false);
      load();
      onChanged?.();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to create link');
    }
  };

  const removeLink = async (linkId: string) => {
    setError(null);
    try {
      await deleteTaskLink(taskId, linkId);
      load();
      onChanged?.();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to remove link');
    }
  };

  return (
    <section className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between">
        <h3 className={SECTION_LABEL}>Linked tasks</h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          {adding ? 'Done' : '+ Add link'}
        </button>
      </div>

      {error && (
        <p className="rounded-[8px] border border-danger/30 bg-danger/10 px-[12px] py-[7px] text-[12px] text-danger">
          {error}
        </p>
      )}

      {/* Picker */}
      {adding && (
        <div className="flex flex-col gap-[8px] rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-[12px] backdrop-blur-md">
          <div className="flex gap-[8px]">
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkType)}
              aria-label="Link type"
              className="shrink-0 appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none focus:border-accent/40"
            >
              {LINK_TYPE_ORDER.map((t) => (
                <option key={t} value={t} className="bg-surface">
                  {LINK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title…"
              aria-label="Search tasks"
              className="min-w-0 flex-1 rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink placeholder:text-ink-3 outline-none focus:border-accent/40"
            />
          </div>
          {candidates.length > 0 ? (
            <ul className="flex flex-col gap-[2px]">
              {candidates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => addLink(t.id)}
                    className="flex w-full items-center gap-[8px] rounded-[7px] px-[10px] py-[6px] text-left text-[12px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink"
                  >
                    <span className="truncate">{t.title}</span>
                    {t.projectName && (
                      <span className="ml-auto shrink-0 text-[10px] text-ink-3">
                        {t.projectName}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[#454c55]">No matching tasks.</p>
          )}
        </div>
      )}

      {/* Existing links grouped by type */}
      {loading ? (
        <p className="text-[12px] text-ink-3">Loading…</p>
      ) : links.length === 0 ? (
        !adding && <p className="text-[12px] text-[#454c55]">No linked tasks.</p>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {LINK_TYPE_ORDER.filter((t) => grouped.has(t)).map((t) => (
            <div key={t} className="flex flex-col gap-[5px]">
              <p className="text-[11px] font-semibold text-ink-2">
                {LINK_TYPE_LABELS[t]}
              </p>
              {grouped.get(t)!.map((l) => (
                <div
                  key={l.id}
                  className="group flex items-center gap-[8px] rounded-[9px] border border-white/[0.06] bg-white/[0.02] px-[12px] py-[7px] backdrop-blur-md"
                >
                  {l.task.columnName && (
                    <span className="shrink-0 truncate text-[10px] text-ink-3">
                      {l.task.columnName}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#d1d5db]">
                    {l.task.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLink(l.id)}
                    aria-label="Remove link"
                    className="shrink-0 rounded-[5px] p-[3px] text-ink-3 opacity-0 transition-all group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default LinkedTasks;
