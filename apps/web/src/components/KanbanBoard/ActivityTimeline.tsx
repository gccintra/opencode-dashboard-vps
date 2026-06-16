import { useCallback, useEffect, useState } from 'react';
import {
  deleteComment,
  editComment,
  fetchTaskActivity,
  postComment,
  type ApiError,
  type KanbanColumn,
  type TaskActivity,
} from '../../lib/api';
import { Markdown } from '../Markdown';
import { PRIORITY_META } from './PriorityBadge';

const SECTION_LABEL =
  "font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function priorityLabel(v: string | null): string {
  if (!v) return '—';
  return PRIORITY_META[v as keyof typeof PRIORITY_META]?.label ?? v;
}

/** Human-readable sentence for a non-comment (system) event. */
function describe(ev: TaskActivity, columnName: (id: string | null) => string): string {
  switch (ev.type) {
    case 'created':
      return 'created this task';
    case 'moved':
      return `moved from ${columnName(ev.oldValue)} to ${columnName(ev.newValue)}`;
    case 'title_changed':
      return `changed the title from “${ev.oldValue ?? ''}” to “${ev.newValue ?? ''}”`;
    case 'description_changed':
      return 'updated the description';
    case 'priority_changed':
      return `changed priority from ${priorityLabel(ev.oldValue)} to ${priorityLabel(ev.newValue)}`;
    case 'label_added':
      return `added label ${ev.body ?? ev.newValue ?? ''}`;
    case 'label_removed':
      return `removed label ${ev.body ?? ev.oldValue ?? ''}`;
    case 'linked':
      return `linked ${ev.body ? `“${ev.body}”` : 'another task'}`;
    case 'unlinked':
      return 'removed a task link';
    default:
      return ev.type;
  }
}

interface ActivityTimelineProps {
  taskId: string;
  kanbanColumns?: KanbanColumn[];
  onChanged?: () => void;
  /** Bump to silently re-fetch the timeline after an external mutation. */
  refreshKey?: number;
}

/** GitLab-style unified timeline: system events + free-text comments. */
export function ActivityTimeline({
  taskId,
  kanbanColumns = [],
  onChanged,
  refreshKey,
}: ActivityTimelineProps) {
  const [events, setEvents] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const columnName = (id: string | null): string => {
    if (!id) return '—';
    return kanbanColumns.find((c) => c.id === id)?.name ?? id;
  };

  // Silent re-fetch (no spinner) — used by own actions and external refreshKey bumps.
  const load = useCallback(() => {
    fetchTaskActivity(taskId)
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]));
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTaskActivity(taskId)
      .then((data) => {
        if (!cancelled) setEvents(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Re-fetch silently when a parent mutation bumps refreshKey (skip initial 0).
  useEffect(() => {
    if (!refreshKey) return;
    load();
  }, [refreshKey, load]);

  const submitComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    setPosting(true);
    setError(null);
    try {
      await postComment(taskId, text);
      setNewComment('');
      load();
      onChanged?.();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (id: string) => {
    const text = editText.trim();
    if (!text) return;
    try {
      await editComment(taskId, id, text);
      setEditingId(null);
      setEditText('');
      load();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to edit comment');
    }
  };

  const removeComment = async (id: string) => {
    try {
      await deleteComment(taskId, id);
      load();
      onChanged?.();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to delete comment');
    }
  };

  return (
    <section className="flex flex-col gap-[12px]">
      <h3 className={SECTION_LABEL}>Activity</h3>

      {error && (
        <p className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-[12px] py-[7px] font-['Inter'] text-[12px] text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-['Inter'] text-[12px] text-[#5a626c]">Loading activity…</p>
      ) : events.length === 0 ? (
        <p className="font-['Inter'] text-[12px] text-[#454c55]">No activity yet.</p>
      ) : (
        <ol className="flex flex-col gap-[10px]">
          {events.map((ev) =>
            ev.type === 'comment' ? (
              <li
                key={ev.id}
                className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-[14px] py-[10px] backdrop-blur-md"
              >
                <div className="mb-[6px] flex items-center justify-between gap-[8px]">
                  <span className="font-['Inter'] text-[11px] text-[#7a828c]">
                    {fmtTime(ev.createdAt)}
                    {ev.updatedAt !== ev.createdAt && ' (edited)'}
                  </span>
                  {editingId !== ev.id && (
                    <span className="flex items-center gap-[8px]">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(ev.id);
                          setEditText(ev.body ?? '');
                        }}
                        className="font-['Inter'] text-[11px] text-[#7a828c] hover:text-[#d1d5db]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeComment(ev.id)}
                        className="font-['Inter'] text-[11px] text-[#7a828c] hover:text-red-400"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                {editingId === ev.id ? (
                  <div className="flex flex-col gap-[8px]">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-[12px] py-[8px] font-['JetBrains_Mono'] text-[12px] text-[#f0f0f0] outline-none focus:border-[#b3e502]/40"
                    />
                    <div className="flex justify-end gap-[6px]">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-[7px] border border-white/[0.07] px-[12px] py-[5px] font-['Inter'] text-[11px] text-[#9aa3ad] hover:text-[#e6e8eb]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(ev.id)}
                        className="rounded-[7px] bg-[#b3e502] px-[12px] py-[5px] font-['Inter'] text-[11px] font-bold text-[#0a0a0f] hover:bg-[#c2f516]"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[13px]">
                    <Markdown>{ev.body ?? ''}</Markdown>
                  </div>
                )}
              </li>
            ) : (
              <li key={ev.id} className="flex items-start gap-[8px] px-[2px]">
                <span className="mt-[5px] size-[6px] shrink-0 rounded-full bg-white/20" />
                <p className="font-['Inter'] text-[12px] leading-[1.5] text-[#7a828c]">
                  <span className="text-[#9aa3ad]">{describe(ev, columnName)}</span>
                  <span className="text-[#454c55]"> · {fmtTime(ev.createdAt)}</span>
                </p>
              </li>
            ),
          )}
        </ol>
      )}

      {/* New comment box */}
      <div className="flex flex-col gap-[8px] rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-[12px] backdrop-blur-md">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
          placeholder="Add a comment (Markdown supported)…"
          aria-label="New comment"
          className="w-full resize-y bg-transparent font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitComment}
            disabled={posting || !newComment.trim()}
            className="rounded-[8px] bg-[#b3e502] px-[14px] py-[6px] font-['Inter'] text-[12px] font-bold text-[#0a0a0f] transition-colors hover:bg-[#c2f516] disabled:opacity-40"
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default ActivityTimeline;
