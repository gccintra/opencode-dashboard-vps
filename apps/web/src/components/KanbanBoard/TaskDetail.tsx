import { useEffect, useMemo, useState } from 'react';
import {
  apiFetch,
  applyTaskLabels,
  fetchLabels,
  fetchProjectSessions,
  fetchTaskAttachments,
  implementTask,
  setTaskSession,
  type ApiError,
  type Attachment,
  type Label,
  type ProjectSession,
} from '../../lib/api';
import { Markdown } from '../Markdown';
import { AttachmentList } from './AttachmentList';
import { LabelChip } from './LabelChip';
import { LabelManager } from './LabelManager';
import type { Task } from './KanbanCard';

interface TaskDetailProps {
  task: Task;
  /** Called after a mutation succeeds, so the board can refresh its data. */
  onChanged?: () => void;
  onClose: () => void;
}

/**
 * Rich task detail panel (Linear-style). Opened when a card is clicked.
 *
 * Sections:
 *  - Markdown body editor with Edit/Preview toggle (saves `description`).
 *  - Labels: applied chips + a manager/picker (LabelManager).
 *  - Attachments: upload / paste / thumbnails / delete (AttachmentList).
 *  - Session association: dropdown listing live project sessions + "none";
 *    shows "session expired" with a re-associate action.
 *  - "Start implementation" button: disabled (with reason) when there is no
 *    associated session or the session is expired.
 *
 * Mobile-first: full-screen drawer at 375px; centered modal on >= sm.
 */
export function TaskDetail({ task, onChanged, onClose }: TaskDetailProps) {
  // ── Body editor ──
  const [description, setDescription] = useState(task.description ?? '');
  const [preview, setPreview] = useState(true);
  const [savingBody, setSavingBody] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);

  // ── Labels ──
  const [appliedLabels, setAppliedLabels] = useState<Label[]>(task.labels ?? []);
  const [showLabelManager, setShowLabelManager] = useState(false);

  // ── Attachments ──
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments ?? []);

  // ── Session association ──
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(task.sessionId);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'expired' | null>(
    task.sessionStatus ?? null,
  );

  // ── Implement ──
  const [implementing, setImplementing] = useState(false);
  const [implementMsg, setImplementMsg] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const appliedIds = useMemo(() => appliedLabels.map((l) => l.id), [appliedLabels]);

  // Load fresh attachments + sessions on open.
  useEffect(() => {
    let cancelled = false;
    fetchTaskAttachments(task.id)
      .then((data) => {
        if (!cancelled) setAttachments(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* keep optimistic list from props */
      });
    fetchProjectSessions(task.projectId)
      .then((data) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.projectId]);

  const sessionExpired = sessionStatus === 'expired';
  const hasSession = sessionId !== null;
  const canImplement = hasSession && !sessionExpired;

  // ── Save body ──
  const saveBody = async () => {
    setSavingBody(true);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ description: description.trim() || undefined }),
      });
      setBodyDirty(false);
      onChanged?.();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to save description');
    } finally {
      setSavingBody(false);
    }
  };

  // ── Toggle a label on/off ──
  const toggleLabel = async (labelId: string, all: Label[]) => {
    const isApplied = appliedIds.includes(labelId);
    const nextIds = isApplied
      ? appliedIds.filter((id) => id !== labelId)
      : [...appliedIds, labelId];
    const prev = appliedLabels;
    // Optimistic: resolve the full label objects from the manager's list.
    const nextLabels = all.filter((l) => nextIds.includes(l.id));
    setAppliedLabels(nextLabels);
    try {
      await applyTaskLabels(task.id, nextIds);
      onChanged?.();
    } catch (err) {
      setAppliedLabels(prev);
      setError((err as ApiError).message || 'Failed to update labels');
    }
  };

  // Remove a label directly from a chip.
  const removeLabel = async (labelId: string) => {
    const prev = appliedLabels;
    const nextLabels = appliedLabels.filter((l) => l.id !== labelId);
    setAppliedLabels(nextLabels);
    try {
      await applyTaskLabels(
        task.id,
        nextLabels.map((l) => l.id),
      );
      onChanged?.();
    } catch (err) {
      setAppliedLabels(prev);
      setError((err as ApiError).message || 'Failed to remove label');
    }
  };

  // ── Associate / dissociate session ──
  const changeSession = async (value: string) => {
    const next = value === '' ? null : value;
    const prevId = sessionId;
    const prevStatus = sessionStatus;
    setSessionId(next);
    setSessionStatus(next ? 'active' : null);
    setError(null);
    try {
      await setTaskSession(task.id, next);
      onChanged?.();
    } catch (err) {
      setSessionId(prevId);
      setSessionStatus(prevStatus);
      setError((err as ApiError).message || 'Failed to set session');
    }
  };

  // ── Start implementation ──
  const startImplement = async () => {
    if (!canImplement) return;
    setImplementing(true);
    setImplementMsg(null);
    setError(null);
    try {
      await implementTask(task.id);
      setImplementMsg('Implementation prompt sent to the session.');
    } catch (err) {
      const apiErr = err as ApiError;
      // A 409 means the session is gone/expired — reflect that in the UI.
      if (apiErr.status === 409) setSessionStatus('expired');
      setError(apiErr.message || 'Failed to start implementation');
    } finally {
      setImplementing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Task: ${task.title}`}
    >
      <div
        className="flex min-h-0 w-full flex-col bg-[#111118] sm:mx-4 sm:max-h-[90vh] sm:max-w-[640px] sm:rounded-[12px] sm:border sm:border-[rgba(255,255,255,0.08)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-[12px] border-b border-[rgba(255,255,255,0.08)] px-[20px] py-[16px]">
          <div className="min-w-0 flex-1">
            <h2 className="font-['Inter'] text-[16px] font-semibold leading-[1.35] text-[#f0f0f0]">
              {task.title}
            </h2>
            {task.projectName && (
              <p className="mt-[2px] font-['Inter'] text-[12px] text-[#556]">{task.projectName}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[6px] p-[6px] text-[#889] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#ccd]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[20px] py-[18px]">
          {error && (
            <p className="rounded-[6px] border border-red-500/30 bg-red-500/10 px-[10px] py-[6px] font-['Inter'] text-[12px] text-red-400">
              {error}
            </p>
          )}

          {/* ── Description (markdown) ── */}
          <section className="flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <h3 className="font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]">
                Description
              </h3>
              <div className="flex items-center gap-[4px] rounded-[6px] border border-[rgba(255,255,255,0.08)] p-[2px]">
                <button
                  type="button"
                  onClick={() => setPreview(false)}
                  aria-pressed={!preview}
                  className={`rounded-[4px] px-[8px] py-[3px] font-['Inter'] text-[11px] font-medium ${
                    !preview ? 'bg-[rgba(255,255,255,0.08)] text-[#f0f0f0]' : 'text-[#889]'
                  }`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(true)}
                  aria-pressed={preview}
                  className={`rounded-[4px] px-[8px] py-[3px] font-['Inter'] text-[11px] font-medium ${
                    preview ? 'bg-[rgba(255,255,255,0.08)] text-[#f0f0f0]' : 'text-[#889]'
                  }`}
                >
                  Preview
                </button>
              </div>
            </div>

            {preview ? (
              <div className="min-h-[80px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[10px]">
                {description.trim() ? (
                  <Markdown>{description}</Markdown>
                ) : (
                  <p className="font-['Inter'] text-[13px] italic text-[#445]">
                    No description. Switch to Edit to add one.
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setBodyDirty(true);
                }}
                rows={8}
                aria-label="Task description (markdown)"
                placeholder="Write task details in Markdown…"
                className="w-full resize-y rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[10px] font-['JetBrains_Mono'] text-[13px] leading-[1.55] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              />
            )}

            {bodyDirty && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveBody}
                  disabled={savingBody}
                  className="rounded-[6px] bg-[#af0] px-[12px] py-[6px] font-['Inter'] text-[12px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] disabled:opacity-50"
                >
                  {savingBody ? 'Saving…' : 'Save description'}
                </button>
              </div>
            )}
          </section>

          {/* ── Labels ── */}
          <section className="flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <h3 className="font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]">
                Labels
              </h3>
              <button
                type="button"
                onClick={() => setShowLabelManager((v) => !v)}
                className="font-['Inter'] text-[11px] font-medium text-[#af0] hover:underline"
              >
                {showLabelManager ? 'Done' : 'Manage'}
              </button>
            </div>

            {appliedLabels.length > 0 ? (
              <div className="flex flex-wrap gap-[6px]">
                {appliedLabels.map((label) => (
                  <LabelChip
                    key={label.id}
                    label={label}
                    size="md"
                    onRemove={() => removeLabel(label.id)}
                  />
                ))}
              </div>
            ) : (
              !showLabelManager && (
                <p className="font-['Inter'] text-[12px] text-[#556]">No labels applied.</p>
              )
            )}

            {showLabelManager && (
              <LabelManagerBridge
                projectId={task.projectId}
                appliedIds={appliedIds}
                onToggle={toggleLabel}
              />
            )}
          </section>

          {/* ── Attachments ── */}
          <section className="flex flex-col gap-[8px]">
            <h3 className="font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]">
              Attachments
            </h3>
            <AttachmentList
              taskId={task.id}
              attachments={attachments}
              onChange={(next) => {
                setAttachments(next);
                onChanged?.();
              }}
            />
          </section>

          {/* ── Session association ── */}
          <section className="flex flex-col gap-[8px]">
            <h3 className="font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]">
              Session
            </h3>
            <select
              value={sessionId ?? ''}
              onChange={(e) => changeSession(e.target.value)}
              aria-label="Associated session"
              className="w-full appearance-none rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[13px] text-[#f0f0f0] outline-none focus:border-[rgba(255,255,255,0.16)]"
            >
              <option value="">None</option>
              {/* If the currently associated session is no longer in the live
                  list (expired), still show it so the user understands. */}
              {sessionId && !sessions.some((s) => s.sessionId === sessionId) && (
                <option value={sessionId}>{sessionId.slice(0, 8)} (expired)</option>
              )}
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.name} · {s.status}
                </option>
              ))}
            </select>

            {sessionExpired && (
              <div className="flex items-center justify-between rounded-[6px] border border-[rgba(250,160,0,0.3)] bg-[rgba(250,160,0,0.08)] px-[10px] py-[6px]">
                <span className="font-['Inter'] text-[12px] text-[#fa0]">Session expired</span>
                <button
                  type="button"
                  onClick={() => changeSession('')}
                  className="font-['Inter'] text-[11px] font-medium text-[#fa0] underline hover:text-[#fc4]"
                >
                  Re-associate
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Footer: implement */}
        <div className="flex shrink-0 flex-col gap-[8px] border-t border-[rgba(255,255,255,0.08)] px-[20px] py-[14px]">
          {implementMsg && (
            <p className="font-['Inter'] text-[12px] text-[#af0]">{implementMsg}</p>
          )}
          <div className="flex items-center justify-between gap-[12px]">
            <span
              className="font-['Inter'] text-[11px] text-[#556]"
              role={!canImplement ? 'note' : undefined}
            >
              {!hasSession
                ? 'Associate a session to enable implementation.'
                : sessionExpired
                  ? 'The associated session has expired.'
                  : 'Injects the task prompt into the associated session.'}
            </span>
            <button
              type="button"
              onClick={startImplement}
              disabled={!canImplement || implementing}
              title={
                !hasSession
                  ? 'No session associated'
                  : sessionExpired
                    ? 'Session expired — re-associate first'
                    : 'Start implementation'
              }
              className="shrink-0 rounded-[8px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {implementing ? 'Starting…' : 'Start implementation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Small bridge so LabelManager (which only knows label ids) can hand back the
 * full Label objects when toggling, letting TaskDetail keep `appliedLabels`
 * in sync without an extra fetch.
 */
function LabelManagerBridge({
  projectId,
  appliedIds,
  onToggle,
}: {
  projectId: string;
  appliedIds: string[];
  onToggle: (labelId: string, all: Label[]) => void;
}) {
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchLabels(projectId)
      .then((data) => {
        if (!cancelled) setAllLabels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAllLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <LabelManager
      projectId={projectId}
      appliedIds={appliedIds}
      onToggle={(labelId) => onToggle(labelId, allLabels)}
    />
  );
}

export default TaskDetail;
