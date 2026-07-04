import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiFetch,
  applyTaskLabels,
  createSession,
  fetchAgentCatalog,
  fetchAgentHint,
  fetchAgentModels,
  fetchLabels,
  fetchProjectSessions,
  fetchSpawnHistory,
  fetchTaskAttachments,
  implementTask,
  updateTaskAgentConfig,
  updateTaskProject,
  setTaskSession,
  updateTaskPriority,
  type AgentCatalog,
  type AgentHint,
  type AgentModel,
  type AgentSource,
  type ApiError,
  type Attachment,
  type CatalogEntry,
  type Label,
  type ProjectSession,
  type SpawnEvent,
  type KanbanColumn,
  type TaskPriority,
} from '../../lib/api';
import { Markdown } from '../Markdown';
import { AttachmentList } from './AttachmentList';
import { LabelChip } from './LabelChip';
import { LabelManager } from './LabelManager';
import { ActivityTimeline } from './ActivityTimeline';
import { LinkedTasks } from './LinkedTasks';
import { PRIORITY_META, PRIORITY_ORDER } from './PriorityBadge';
import type { Task } from './KanbanCard';

interface TaskDetailProps {
  task: Task;
  /** All kanban columns so status picker can show current columns. */
  kanbanColumns?: KanbanColumn[];
  /** Called after a mutation succeeds, so the board can refresh its data. */
  onChanged?: () => void;
  /** Leave the detail view (navigates back to the board). */
  onClose: () => void;
}

/**
 * Delay (ms) between spawning a session and injecting the prompt, per runtime.
 * opencode's TUI is slower to become ready for input than claude's, so it gets
 * a longer head-start. The wait runs server-side (see implement endpoint).
 */
const SPAWN_BOOT_DELAY_MS: Record<'opencode' | 'claude', number> = {
  opencode: 14000,
  claude: 4000,
};

/**
 * Selectable reasoning-effort levels per runtime. claude maps to `--effort`
 * (low|medium|high|xhigh|max); opencode maps to `--variant` (provider-specific
 * reasoning effort, commonly minimal|low|medium|high|max).
 */
const EFFORT_OPTIONS: Record<'opencode' | 'claude', string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  opencode: ['minimal', 'low', 'medium', 'high', 'max'],
};

/** Build a prompt preview string (mirrors server's buildImplementPrompt logic). */
function buildPromptPreview(task: Task): string {
  const lines: string[] = [`# Task: ${task.title}`, ''];
  if (task.description?.trim()) {
    lines.push(task.description.trim());
    lines.push('');
  }
  lines.push('Please implement this task.');
  return lines.join('\n');
}

/** Shared section-label style. */
const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-3";

/**
 * Rich task detail — full-page "Aurora Glass" layout (a route, not a modal).
 *
 * Desktop (lg+): main content + a 300px properties sidebar in a responsive grid.
 * Mobile: everything stacks into one vertical scroll.
 */
export function TaskDetail({ task, kanbanColumns = [], onChanged, onClose }: TaskDetailProps) {
  // ── Title inline editing ──
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);

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
  const [spawning, setSpawning] = useState(false);

  // ── Project selection ──
  const [currentProjectId, setCurrentProjectId] = useState(task.projectId);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [savingProject, setSavingProject] = useState(false);

  // ── Agent selection ──
  const [agentHint, setAgentHint] = useState<AgentHint | null>(null);
  const [localAgentType, setLocalAgentType] = useState<'opencode' | 'claude' | null>(
    task.agentType ?? null,
  );
  const [agentSource, setAgentSource] = useState<AgentSource>(
    (task.agentSource as AgentSource) ?? 'agents',
  );
  const [agentName, setAgentName] = useState<string | null>(task.agentName ?? null);
  const [model, setModel] = useState<string | null>(task.model ?? null);
  const [effort, setEffort] = useState<string | null>(task.effort ?? null);
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // ── Status (column) in sidebar ──
  const [currentColumn, setCurrentColumn] = useState(task.column);
  const [movingColumn, setMovingColumn] = useState(false);

  // ── Priority in sidebar ──
  const [currentPriority, setCurrentPriority] = useState<TaskPriority>(task.priority ?? 'medium');
  const [savingPriority, setSavingPriority] = useState(false);

  // ── Implement / prompt ──
  const [implementing, setImplementing] = useState(false);
  const [implementMsg, setImplementMsg] = useState<string | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Spawn history ──
  const [spawnHistory, setSpawnHistory] = useState<SpawnEvent[]>([]);

  const [error, setError] = useState<string | null>(null);

  // Bumped after every mutation so child history views (ActivityTimeline)
  // re-fetch in place — keeps the activity log live without an F5 / full reload.
  const [activityVersion, setActivityVersion] = useState(0);
  const notifyChanged = () => {
    setActivityVersion((v) => v + 1);
    onChanged?.();
  };

  const appliedIds = useMemo(() => appliedLabels.map((l) => l.id), [appliedLabels]);

  // Concrete runtime used for spawning (resolves the auto-detected hint).
  const runtime: 'opencode' | 'claude' =
    localAgentType ?? (agentHint?.hint === 'opencode' ? 'opencode' : 'claude');

  // Agents/commands available for the current runtime + source.
  const agentList: CatalogEntry[] = useMemo(() => {
    if (!catalog) return [];
    if (runtime === 'opencode') return catalog.opencode.agents;
    return agentSource === 'commands' ? catalog.claude.commands : catalog.claude.agents;
  }, [catalog, runtime, agentSource]);

  // Load attachments, sessions, projects, agent hint, and the agent catalog on open.
  useEffect(() => {
    let cancelled = false;
    fetchTaskAttachments(task.id)
      .then((data) => {
        if (!cancelled) setAttachments(Array.isArray(data) ? data : []);
      })
      .catch(() => { /* keep optimistic list */ });

    fetchProjectSessions(task.projectId)
      .then((data) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });

    apiFetch<{ id: string; name: string }[]>('/api/projects')
      .then((data) => {
        if (!cancelled) setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => { /* non-fatal */ });

    fetchAgentHint(task.projectId)
      .then((hint) => {
        if (!cancelled) setAgentHint(hint);
      })
      .catch(() => { /* non-fatal */ });

    fetchAgentCatalog(task.projectId)
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => { /* non-fatal — agent picker just stays empty */ });

    fetchSpawnHistory(task.id)
      .then((data) => {
        if (!cancelled) setSpawnHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => { /* non-fatal */ });

    return () => {
      cancelled = true;
    };
  }, [task.id, task.projectId]);

  // Reload the LLM model list whenever the runtime changes.
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    fetchAgentModels(runtime)
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const sessionExpired = sessionStatus === 'expired';
  const hasSession = sessionId !== null;
  const canImplement = hasSession && !sessionExpired;

  // ── Save title ──
  const saveTitle = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === task.title) {
      setTitleValue(task.title);
      setTitleEditing(false);
      return;
    }
    setSavingTitle(true);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ title: trimmed }),
      });
      setTitleValue(trimmed);
      setTitleEditing(false);
      notifyChanged();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to save title');
      setTitleValue(task.title);
      setTitleEditing(false);
    } finally {
      setSavingTitle(false);
    }
  };

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
      notifyChanged();
    } catch (err) {
      setError((err as ApiError).message || 'Failed to save description');
    } finally {
      setSavingBody(false);
    }
  };

  // ── Change priority ──
  const changePriority = async (next: TaskPriority) => {
    if (next === currentPriority) return;
    const prev = currentPriority;
    setCurrentPriority(next);
    setSavingPriority(true);
    setError(null);
    try {
      await updateTaskPriority(task.id, next);
      notifyChanged();
    } catch (err) {
      setCurrentPriority(prev);
      setError((err as ApiError).message || 'Failed to update priority');
    } finally {
      setSavingPriority(false);
    }
  };

  // ── Change project ──
  const changeProject = async (nextProjectId: string) => {
    if (nextProjectId === currentProjectId) return;
    const prev = currentProjectId;
    setCurrentProjectId(nextProjectId);
    setSavingProject(true);
    setError(null);
    try {
      await updateTaskProject(task.id, nextProjectId);
      notifyChanged();
    } catch (err) {
      setCurrentProjectId(prev);
      setError((err as ApiError).message || 'Failed to update project');
    } finally {
      setSavingProject(false);
    }
  };

  // ── Toggle label ──
  const toggleLabel = async (labelId: string, all: Label[]) => {
    const isApplied = appliedIds.includes(labelId);
    const nextIds = isApplied ? appliedIds.filter((id) => id !== labelId) : [...appliedIds, labelId];
    const prev = appliedLabels;
    const nextLabels = all.filter((l) => nextIds.includes(l.id));
    setAppliedLabels(nextLabels);
    try {
      await applyTaskLabels(task.id, nextIds);
      notifyChanged();
    } catch (err) {
      setAppliedLabels(prev);
      setError((err as ApiError).message || 'Failed to update labels');
    }
  };

  const removeLabel = async (labelId: string) => {
    const prev = appliedLabels;
    const nextLabels = appliedLabels.filter((l) => l.id !== labelId);
    setAppliedLabels(nextLabels);
    try {
      await applyTaskLabels(task.id, nextLabels.map((l) => l.id));
      notifyChanged();
    } catch (err) {
      setAppliedLabels(prev);
      setError((err as ApiError).message || 'Failed to remove label');
    }
  };

  // ── Change session ──
  const changeSession = async (value: string) => {
    const next = value === '' ? null : value;
    const prevId = sessionId;
    const prevStatus = sessionStatus;
    setSessionId(next);
    setSessionStatus(next ? 'active' : null);
    setError(null);
    try {
      await setTaskSession(task.id, next);
      notifyChanged();
    } catch (err) {
      setSessionId(prevId);
      setSessionStatus(prevStatus);
      setError((err as ApiError).message || 'Failed to set session');
    }
  };

  // ── Change column (status) ──
  const changeColumn = async (newCol: string) => {
    if (newCol === currentColumn) return;
    const prev = currentColumn;
    setCurrentColumn(newCol);
    setMovingColumn(true);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/move`, {
        method: 'PUT',
        body: JSON.stringify({ column: newCol }),
      });
      notifyChanged();
    } catch (err) {
      setCurrentColumn(prev);
      setError((err as ApiError).message || 'Failed to change status');
    } finally {
      setMovingColumn(false);
    }
  };

  // ── Change runtime (opencode/claude) — resets agent + model + effort (catalogs/levels differ) ──
  const changeAgentType = async (value: 'opencode' | 'claude') => {
    const prev = { localAgentType, agentSource, agentName, model, effort };
    setLocalAgentType(value);
    setAgentSource('agents');
    setAgentName(null);
    setModel(null);
    setEffort(null);
    try {
      await updateTaskAgentConfig(task.id, {
        agentType: value,
        agentSource: 'agents',
        agentName: null,
        model: null,
        effort: null,
      });
      notifyChanged();
    } catch (err) {
      setLocalAgentType(prev.localAgentType);
      setAgentSource(prev.agentSource);
      setAgentName(prev.agentName);
      setModel(prev.model);
      setEffort(prev.effort);
      setError((err as ApiError).message || 'Failed to set runtime');
    }
  };

  // ── Change agent source (claude: agents vs commands) ──
  const changeAgentSource = async (value: AgentSource) => {
    const prev = { agentSource, agentName };
    setAgentSource(value);
    setAgentName(null);
    try {
      await updateTaskAgentConfig(task.id, { agentSource: value, agentName: null });
      notifyChanged();
    } catch (err) {
      setAgentSource(prev.agentSource);
      setAgentName(prev.agentName);
      setError((err as ApiError).message || 'Failed to set agent source');
    }
  };

  // ── Change selected agent/command ──
  const changeAgentName = async (value: string) => {
    const next = value === '' ? null : value;
    const prev = agentName;
    setAgentName(next);
    try {
      await updateTaskAgentConfig(task.id, { agentName: next });
      notifyChanged();
    } catch (err) {
      setAgentName(prev);
      setError((err as ApiError).message || 'Failed to set agent');
    }
  };

  // ── Change LLM model ──
  const changeModel = async (value: string) => {
    const next = value === '' ? null : value;
    const prev = model;
    setModel(next);
    try {
      await updateTaskAgentConfig(task.id, { model: next });
      notifyChanged();
    } catch (err) {
      setModel(prev);
      setError((err as ApiError).message || 'Failed to set model');
    }
  };

  // ── Change reasoning effort (claude --effort / opencode --variant) ──
  const changeEffort = async (value: string) => {
    const next = value === '' ? null : value;
    const prev = effort;
    setEffort(next);
    try {
      await updateTaskAgentConfig(task.id, { effort: next });
      notifyChanged();
    } catch (err) {
      setEffort(prev);
      setError((err as ApiError).message || 'Failed to set effort');
    }
  };

  // ── Spawn session (configured with runtime + agent + model + effort) ──
  const handleSpawnSession = async (): Promise<ProjectSession | null> => {
    setSpawning(true);
    setError(null);
    try {
      const s = await createSession(task.projectId, {
        agentType: runtime,
        model: model ?? undefined,
        agent: agentName ?? undefined,
        agentSource,
        effort: effort ?? undefined,
        name: task.title.slice(0, 30),
      });
      await setTaskSession(task.id, s.sessionId);
      setSessionId(s.sessionId);
      setSessionStatus('active');
      setSessions((prev) => [...prev, s]);
      notifyChanged();
      return s;
    } catch (err) {
      setError((err as ApiError).message || 'Failed to spawn session');
      return null;
    } finally {
      setSpawning(false);
    }
  };

  // ── Start implementation ──
  // One action: reuse the live session if present, otherwise spawn one
  // configured with the chosen runtime/agent/model and inject the prompt after
  // a boot delay (the CLI — opencode especially — needs time to come up).
  const startImplement = async () => {
    setImplementing(true);
    setImplementMsg(null);
    setError(null);
    try {
      let delayMs = 0;
      if (!canImplement) {
        const s = await handleSpawnSession();
        if (!s) return; // spawn failed — error already surfaced
        delayMs = SPAWN_BOOT_DELAY_MS[runtime];
        setImplementMsg(
          `Session spawned. Waiting ${Math.round(delayMs / 1000)}s for ${runtime} to load…`,
        );
      }
      const res = await implementTask(task.id, delayMs);
      setImplementMsg(
        res.delayedMs
          ? `Prompt queued — sending in ${Math.round(res.delayedMs / 1000)}s, once ${runtime} is ready.`
          : 'Implementation prompt sent to the session.',
      );
      // Refresh spawn history after implement.
      fetchSpawnHistory(task.id)
        .then((data) => setSpawnHistory(Array.isArray(data) ? data : []))
        .catch(() => {});
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409) setSessionStatus('expired');
      setError(apiErr.message || 'Failed to start implementation');
    } finally {
      setImplementing(false);
    }
  };

  const navigate = useNavigate();

  // ── Copy prompt ──
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPromptPreview(task));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  // Resolve column metadata from dynamic kanban columns or fallback
  const colMeta = kanbanColumns.find((c) => c.id === currentColumn) ?? {
    id: currentColumn,
    name: currentColumn,
    color: '#6b7280',
  };

  const statusColumns =
    kanbanColumns.length > 0
      ? kanbanColumns
      : [
          { id: 'backlog', name: 'Backlog', color: '#6b7280' },
          { id: 'in_progress', name: 'In Progress', color: '#5e6ad2' },
          { id: 'done', name: 'Done', color: '#22c55e' },
        ];

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-bg">
      {/* ══════ Header ══════ */}
      <header className="relative z-10 flex shrink-0 items-center gap-[12px] border-b border-hairline px-[16px] py-[12px] sm:px-[28px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to board"
          className="flex h-[34px] shrink-0 items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03] pl-[8px] pr-[12px] text-[13px] font-medium text-ink-2 transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden sm:inline">Board</span>
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-[8px]">
          <span className="shrink-0 rounded-[6px] border border-white/[0.08] bg-black/40 px-[8px] py-[3px] font-['JetBrains_Mono'] text-[11px] font-bold tracking-[0.3px] text-ink-2">
            #{task.issueNumber ?? task.githubIssueNumber ?? '?'}
          </span>
          <span
            className="flex shrink-0 items-center gap-[5px] rounded-[6px] border px-[8px] py-[3px] text-[11px] font-semibold"
            style={{
              borderColor: `${colMeta.color}40`,
              backgroundColor: `${colMeta.color}1a`,
              color: colMeta.color,
            }}
          >
            <span className="size-[5px] shrink-0 rounded-full" style={{ backgroundColor: colMeta.color }} />
            {colMeta.name}
          </span>
          {task.projectName && (
            <span className="hidden truncate text-[12px] text-ink-3 sm:block">
              {task.projectName}
            </span>
          )}
        </div>

        {task.sessionId && (
          <span className="hidden items-center gap-[5px] rounded-[6px] bg-accent/10 px-[8px] py-[3px] text-[11px] font-semibold text-accent sm:flex">
            <span className="size-[5px] rounded-full bg-accent" />
            live session
          </span>
        )}
      </header>

      {/* ══════ Scrollable body ══════ */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-[16px] py-[20px] sm:px-[28px] sm:py-[26px]">
          {error && (
            <p className="mb-[16px] rounded-[10px] border border-danger/30 bg-danger/10 px-[14px] py-[10px] text-[13px] text-danger backdrop-blur-md">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-[24px] lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ── MAIN content ── */}
            <main className="min-w-0">
              {/* Title inline edit */}
              <div className="mb-[20px]">
                {titleEditing ? (
                  <input
                    type="text"
                    value={titleValue}
                    autoFocus
                    onChange={(e) => setTitleValue(e.target.value)}
                    onBlur={() => saveTitle(titleValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle(titleValue);
                      if (e.key === 'Escape') {
                        setTitleValue(task.title);
                        setTitleEditing(false);
                      }
                    }}
                    disabled={savingTitle}
                    className="w-full bg-transparent text-[26px] font-extrabold leading-[1.2] tracking-[-0.5px] text-white outline-none disabled:opacity-60 sm:text-[30px]"
                  />
                ) : (
                  <h2
                    onClick={() => setTitleEditing(true)}
                    className="cursor-text text-[26px] font-extrabold leading-[1.2] tracking-[-0.5px] text-white transition-colors hover:text-white/90 sm:text-[30px]"
                    title="Click to edit title"
                  >
                    {titleValue}
                  </h2>
                )}
              </div>

              {/* Description */}
              <section className="mb-[24px] flex flex-col gap-[10px]">
                <div className="flex items-center justify-between">
                  <h3 className={SECTION_LABEL}>Description</h3>
                  <div className="flex items-center gap-[2px] rounded-[8px] border border-white/[0.07] bg-white/[0.03] p-[3px]">
                    <button
                      type="button"
                      onClick={() => setPreview(false)}
                      aria-pressed={!preview}
                      className={`rounded-[6px] px-[10px] py-[4px] text-[11px] font-semibold transition-colors ${
                        !preview ? 'bg-white/[0.1] text-ink' : 'text-ink-2 hover:text-[#d1d5db]'
                      }`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreview(true)}
                      aria-pressed={preview}
                      className={`rounded-[6px] px-[10px] py-[4px] text-[11px] font-semibold transition-colors ${
                        preview ? 'bg-white/[0.1] text-ink' : 'text-ink-2 hover:text-[#d1d5db]'
                      }`}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {preview ? (
                  <div className="min-h-[100px] rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-[16px] py-[14px] backdrop-blur-md">
                    {description.trim() ? (
                      <Markdown>{description}</Markdown>
                    ) : (
                      <p
                        className="cursor-text text-[13px] italic text-ink-3"
                        onClick={() => setPreview(false)}
                      >
                        No description. Click Edit to add one.
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
                    rows={10}
                    aria-label="Task description (markdown)"
                    placeholder="Write task details in Markdown…"
                    className="w-full resize-y rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-[16px] py-[14px] font-['JetBrains_Mono'] text-[13px] leading-[1.6] text-ink placeholder:text-ink-3 outline-none backdrop-blur-md focus:border-accent/40"
                  />
                )}

                {bodyDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveBody}
                      disabled={savingBody}
                      className="rounded-[8px] bg-accent px-[14px] py-[7px] text-[12px] font-bold text-bg transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      {savingBody ? 'Saving…' : 'Save description'}
                    </button>
                  </div>
                )}
              </section>

              {/* Attachments */}
              <section className="mb-[24px] flex flex-col gap-[10px]">
                <h3 className={SECTION_LABEL}>Attachments</h3>
                <AttachmentList
                  taskId={task.id}
                  attachments={attachments}
                  onChange={(next) => {
                    setAttachments(next);
                    notifyChanged();
                  }}
                />
              </section>

              {/* Spawn history */}
              {spawnHistory.length > 0 && (
                <section className="flex flex-col gap-[10px]">
                  <h3 className={SECTION_LABEL}>Implementation history</h3>
                  <div className="flex flex-col gap-[5px]">
                    {spawnHistory.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-[8px] rounded-[10px] border border-white/[0.05] bg-white/[0.02] px-[12px] py-[8px] backdrop-blur-md"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 text-accent">
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="text-[11px] text-ink-2">
                          {new Date(ev.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {ev.runtime && (
                          <span className="rounded-[4px] bg-accent/10 px-[6px] py-[1px] text-[10px] font-semibold text-accent">
                            {ev.runtime}
                          </span>
                        )}
                        {ev.agentName && (
                          <span className="truncate text-[11px] text-ink-3">
                            {ev.agentName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Linked tasks */}
              <section className="mt-[24px]">
                <LinkedTasks taskId={task.id} onChanged={notifyChanged} />
              </section>

              {/* Activity + comments */}
              <section className="mt-[24px]">
                <ActivityTimeline
                  taskId={task.id}
                  kanbanColumns={kanbanColumns}
                  projects={projects}
                  onChanged={notifyChanged}
                  refreshKey={activityVersion}
                />
              </section>
            </main>

            {/* ── PROPERTIES sidebar ── */}
            <aside className="flex flex-col gap-[20px] lg:border-l lg:border-white/[0.06] lg:pl-[24px]">
              {/* STATUS */}
              <div>
                <p className={`mb-[8px] ${SECTION_LABEL}`}>Status</p>
                <div className="flex flex-col gap-[2px]">
                  {statusColumns.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      disabled={movingColumn}
                      onClick={() => changeColumn(col.id)}
                      className={`flex items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-left text-[12px] transition-colors ${
                        currentColumn === col.id
                          ? 'bg-white/[0.07] text-ink'
                          : 'text-ink-2 hover:bg-surface hover:text-[#d1d5db]'
                      }`}
                    >
                      <span className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                      {col.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* PRIORITY */}
              <div>
                <p className={`mb-[8px] ${SECTION_LABEL}`}>Priority</p>
                <div className="flex flex-col gap-[2px]">
                  {PRIORITY_ORDER.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={savingPriority}
                      onClick={() => changePriority(p)}
                      className={`flex items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-left text-[12px] transition-colors ${
                        currentPriority === p
                          ? 'bg-white/[0.07] text-ink'
                          : 'text-ink-2 hover:bg-surface hover:text-[#d1d5db]'
                      }`}
                    >
                      <span
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: PRIORITY_META[p].dot }}
                      />
                      {PRIORITY_META[p].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* PROJECT */}
              <div>
                <p className={`mb-[8px] ${SECTION_LABEL}`}>Project</p>
                <select
                  value={currentProjectId}
                  onChange={(e) => changeProject(e.target.value)}
                  disabled={savingProject || projects.length === 0}
                  aria-label="Project"
                  className="w-full appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none backdrop-blur-md focus:border-accent/40 disabled:opacity-50"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface">
                      {p.name}
                    </option>
                  ))}
                  {!projects.some((p) => p.id === currentProjectId) && currentProjectId && (
                    <option value={currentProjectId} className="bg-surface">
                      {task.projectName ?? currentProjectId.slice(0, 8)}
                    </option>
                  )}
                </select>
              </div>

              {/* LABELS */}
              <div>
                <div className="mb-[8px] flex items-center justify-between">
                  <p className={SECTION_LABEL}>Labels</p>
                  <button
                    type="button"
                    onClick={() => setShowLabelManager((v) => !v)}
                    className="text-[11px] font-semibold text-accent hover:underline"
                  >
                    {showLabelManager ? 'Done' : '+ Add'}
                  </button>
                </div>
                {appliedLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-[4px]">
                    {appliedLabels.map((label) => (
                      <LabelChip
                        key={label.id}
                        label={label}
                        size="sm"
                        onRemove={() => removeLabel(label.id)}
                      />
                    ))}
                  </div>
                ) : (
                  !showLabelManager && <p className="text-[12px] text-[#454c55]">None</p>
                )}
                {showLabelManager && (
                  <div className="mt-[8px]">
                    <LabelManagerBridge appliedIds={appliedIds} onToggle={toggleLabel} />
                  </div>
                )}
              </div>

              {/* SESSION */}
              <div>
                <p className={`mb-[8px] ${SECTION_LABEL}`}>Session</p>
                <select
                  value={sessionId ?? ''}
                  onChange={(e) => changeSession(e.target.value)}
                  aria-label="Associated session"
                  className="w-full appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none backdrop-blur-md focus:border-accent/40"
                >
                  <option value="" className="bg-surface">None</option>
                  {sessionId && !sessions.some((s) => s.sessionId === sessionId) && (
                    <option value={sessionId} className="bg-surface">{sessionId.slice(0, 8)} (expired)</option>
                  )}
                  {sessions.map((s) => (
                    <option key={s.sessionId} value={s.sessionId} className="bg-surface">
                      {s.name} · {s.status}
                    </option>
                  ))}
                </select>

                {sessionExpired && (
                  <div className="mt-[6px] flex items-center justify-between rounded-[7px] border border-hairline bg-white/[0.03] px-[10px] py-[6px]">
                    <span className="text-[11px] text-ink-3">Expired</span>
                    <button
                      type="button"
                      onClick={() => changeSession('')}
                      className="text-[11px] font-semibold text-ink-2 underline hover:text-ink"
                    >
                      Clear
                    </button>
                  </div>
                )}

                {!sessionId && (
                  <button
                    type="button"
                    onClick={handleSpawnSession}
                    disabled={spawning}
                    className="mt-[8px] flex w-full items-center justify-center gap-[6px] rounded-[8px] border border-accent/30 bg-accent/[0.06] px-[10px] py-[7px] text-[12px] font-semibold text-accent transition-colors hover:bg-accent/[0.12] disabled:opacity-50"
                  >
                    {spawning ? (
                      'Spawning…'
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        Spawn session
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* AGENT & MODEL */}
              <div>
                <p className={`mb-[8px] ${SECTION_LABEL}`}>Agent &amp; Model</p>

                {/* Runtime toggle (opencode / claude) */}
                <div className="flex rounded-[8px] border border-white/[0.07] bg-white/[0.03] p-[3px]">
                  {(['opencode', 'claude'] as const).map((rt) => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => changeAgentType(rt)}
                      aria-pressed={runtime === rt}
                      className={`flex-1 rounded-[6px] px-[6px] py-[5px] text-[11px] font-semibold transition-colors ${
                        runtime === rt
                          ? 'bg-white/[0.1] text-ink'
                          : 'text-ink-3 hover:text-ink-2'
                      }`}
                    >
                      {rt === 'opencode' ? 'Opencode' : 'Claude'}
                    </button>
                  ))}
                </div>

                {/* Auto-detect hint badge */}
                {agentHint && agentHint.hint === 'both' ? (
                  <p className="mt-[5px] text-[10px] text-ink-3">
                    Detected: <span className="text-accent">.opencode</span> +{' '}
                    <span className="text-accent">.claude</span>
                  </p>
                ) : agentHint && agentHint.hint ? (
                  <p className="mt-[5px] text-[10px] text-ink-3">
                    Detected: <span className="text-accent">.{agentHint.hint}</span>
                  </p>
                ) : null}
                {!localAgentType && (
                  <p className="mt-[3px] text-[10px] text-[#454c55]">
                    Using <span className="text-ink-2">{runtime}</span> (auto)
                  </p>
                )}

                {/* Claude only: agents vs commands */}
                {runtime === 'claude' && (
                  <div className="mt-[10px]">
                    <p className="mb-[5px] text-[10px] text-ink-2">Source</p>
                    <div className="flex rounded-[8px] border border-white/[0.07] bg-white/[0.03] p-[3px]">
                      {(['agents', 'commands'] as const).map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => changeAgentSource(src)}
                          aria-pressed={agentSource === src}
                          className={`flex-1 rounded-[6px] px-[6px] py-[4px] text-[11px] font-semibold capitalize transition-colors ${
                            agentSource === src
                              ? 'bg-white/[0.1] text-ink'
                              : 'text-ink-3 hover:text-ink-2'
                          }`}
                        >
                          {src}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agent / command picker */}
                <div className="mt-[10px]">
                  <p className="mb-[5px] text-[10px] text-ink-2">
                    {runtime === 'claude' && agentSource === 'commands' ? 'Command' : 'Agent'}
                  </p>
                  <select
                    value={agentName ?? ''}
                    onChange={(e) => changeAgentName(e.target.value)}
                    aria-label="Agent or command"
                    className="w-full appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none backdrop-blur-md focus:border-accent/40"
                  >
                    <option value="" className="bg-surface">{runtime === 'opencode' ? 'Default agent' : 'None'}</option>
                    {agentName && !agentList.some((a) => a.name === agentName) && (
                      <option value={agentName} className="bg-surface">{agentName}</option>
                    )}
                    {agentList.map((a) => (
                      <option key={a.name} value={a.name} title={a.description} className="bg-surface">
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {agentList.length === 0 && (
                    <p className="mt-[4px] text-[10px] text-[#454c55]">
                      No {runtime === 'claude' && agentSource === 'commands' ? 'commands' : 'agents'} found in project.
                    </p>
                  )}
                </div>

                {/* LLM model picker */}
                <div className="mt-[10px]">
                  <p className="mb-[5px] text-[10px] text-ink-2">LLM model</p>
                  {models.length > 0 ? (
                    <select
                      value={model ?? ''}
                      onChange={(e) => changeModel(e.target.value)}
                      aria-label="LLM model"
                      className="w-full appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none backdrop-blur-md focus:border-accent/40"
                    >
                      <option value="" className="bg-surface">Default</option>
                      {model && !models.some((m) => m.id === model) && (
                        <option value={model} className="bg-surface">{model}</option>
                      )}
                      {models.map((m) => (
                        <option key={m.id} value={m.id} className="bg-surface">
                          {m.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={model ?? ''}
                      onChange={(e) => setModel(e.target.value || null)}
                      onBlur={(e) => changeModel(e.target.value)}
                      placeholder={modelsLoading ? 'Loading…' : 'provider/model (optional)'}
                      aria-label="LLM model"
                      className="w-full rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink placeholder:text-ink-3 outline-none backdrop-blur-md focus:border-accent/40"
                    />
                  )}
                </div>

                {/* Reasoning effort picker (claude --effort / opencode --variant) */}
                <div className="mt-[10px]">
                  <p className="mb-[5px] text-[10px] text-ink-2">
                    Reasoning effort
                  </p>
                  <select
                    value={effort ?? ''}
                    onChange={(e) => changeEffort(e.target.value)}
                    aria-label="Reasoning effort"
                    className="w-full appearance-none rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[10px] py-[7px] text-[12px] text-ink outline-none backdrop-blur-md focus:border-accent/40"
                  >
                    <option value="" className="bg-surface">Default</option>
                    {effort && !EFFORT_OPTIONS[runtime].includes(effort) && (
                      <option value={effort} className="bg-surface">{effort}</option>
                    )}
                    {EFFORT_OPTIONS[runtime].map((level) => (
                      <option key={level} value={level} className="bg-surface">
                        {level}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* ══════ Footer action bar ══════ */}
      <div className="relative z-10 flex shrink-0 flex-col gap-[10px] border-t border-white/[0.06] bg-bg/80 px-[16px] py-[12px] backdrop-blur-md sm:px-[28px]">
        {implementMsg && <p className="text-[12px] text-accent">{implementMsg}</p>}

        {/* Prompt preview accordion */}
        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02]">
          <button
            type="button"
            onClick={() => setShowPromptPreview((v) => !v)}
            className="flex w-full items-center justify-between px-[14px] py-[9px] text-[12px] text-ink-2 transition-colors hover:text-[#d1d5db]"
          >
            <span>Prompt preview</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform ${showPromptPreview ? 'rotate-180' : ''}`}
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showPromptPreview && (
            <div className="border-t border-white/[0.06] px-[14px] py-[10px]">
              <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap font-['JetBrains_Mono'] text-[11px] leading-[1.6] text-ink-2">
                {buildPromptPreview(task)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-[8px] sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={startImplement}
            disabled={implementing || spawning}
            title={canImplement ? 'Send the prompt to the live session' : `Spawn ${runtime} and start implementation`}
            className="kb-sheen relative w-full overflow-hidden rounded-[10px] bg-accent px-[16px] py-[10px] text-[13px] font-bold text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-[8px]"
          >
            {implementing || spawning
              ? canImplement
                ? 'Starting…'
                : 'Spawning…'
              : canImplement
                ? 'Implement'
                : 'Spawn & implement'}
          </button>

          <div className="flex items-center gap-[8px]">
            {canImplement && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${task.projectId}?session=${sessionId}`)}
                title="Open session terminal"
                className="flex items-center gap-[5px] rounded-[8px] border border-white/[0.07] px-[12px] py-[7px] text-[12px] font-medium text-ink-2 transition-colors hover:border-white/[0.14] hover:text-ink"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 6l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">View session</span>
              </button>
            )}
            <button
              type="button"
              onClick={copyPrompt}
              className="flex items-center gap-[5px] rounded-[8px] border border-white/[0.07] px-[12px] py-[7px] text-[12px] font-medium text-ink-2 transition-colors hover:border-white/[0.14] hover:text-ink"
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="#5e6ad2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy prompt'}</span>
            </button>
            {!canImplement && (
              <span className="hidden text-[11px] text-[#454c55] sm:inline">
                Spawns {runtime}{agentName ? ` · ${agentName}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Small bridge so LabelManager can hand back the full Label objects when
 * toggling, letting TaskDetail keep `appliedLabels` in sync without an extra fetch.
 * Label creation is disabled here — manage labels from the board header instead.
 */
function LabelManagerBridge({
  appliedIds,
  onToggle,
}: {
  appliedIds: string[];
  onToggle: (labelId: string, all: Label[]) => void;
}) {
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchLabels()
      .then((data) => {
        if (!cancelled) setAllLabels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAllLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <LabelManager
      appliedIds={appliedIds}
      onToggle={(labelId) => onToggle(labelId, allLabels)}
      allowCreate={false}
    />
  );
}

export default TaskDetail;
