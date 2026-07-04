import { useState, useEffect, useRef } from 'react';
import { fetchLabels, type Label, type KanbanColumn, type TaskPriority } from '../../lib/api';
import { LabelChip } from './LabelChip';
import { PRIORITY_META, PRIORITY_ORDER } from './PriorityBadge';

export interface TaskFormData {
  title: string;
  description: string;
  projectId: string;
  column: string;
  priority: TaskPriority;
  labelIds: string[];
}

interface Project {
  id: string;
  name: string;
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#6b7280', sortOrder: 0, createdAt: '' },
  { id: 'in_progress', name: 'In Progress', category: 'started', color: '#5e6ad2', sortOrder: 0, createdAt: '' },
  { id: 'done', name: 'Done', category: 'completed', color: '#22c55e', sortOrder: 0, createdAt: '' },
];

interface TaskModalProps {
  open: boolean;
  title: string;
  initial: TaskFormData;
  projects: Project[];
  kanbanColumns?: KanbanColumn[];
  onClose: () => void;
  onSubmit: (data: TaskFormData) => void;
  error: string | null;
  loading: boolean;
}

export function TaskModal({
  open,
  title: _modalTitle,
  initial,
  projects,
  kanbanColumns,
  onClose,
  onSubmit,
  error,
  loading,
}: TaskModalProps) {
  const colOptions = kanbanColumns && kanbanColumns.length > 0 ? kanbanColumns : DEFAULT_COLUMNS;
  const [taskTitle, setTaskTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [column, setColumn] = useState(initial.column || 'backlog');
  const [priority, setPriority] = useState<TaskPriority>(initial.priority || 'medium');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(initial.labelIds || []);
  const [titleError, setTitleError] = useState('');

  // Popover state
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [projectLabels, setProjectLabels] = useState<Label[]>([]);

  const titleRef = useRef<HTMLInputElement>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const priorityPickerRef = useRef<HTMLDivElement>(null);
  const labelPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTaskTitle(initial.title);
      setDescription(initial.description);
      setProjectId(initial.projectId || projects[0]?.id || '');
      setColumn(initial.column || 'backlog');
      setPriority(initial.priority || 'medium');
      setSelectedLabelIds(initial.labelIds || []);
      setTitleError('');
      setShowColumnPicker(false);
      setShowPriorityPicker(false);
      setShowLabelPicker(false);
    }
  }, [open, initial, projects]);

  // Load global labels on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchLabels()
      .then((data) => {
        if (!cancelled) setProjectLabels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setProjectLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close popovers on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target as Node)) {
        setShowLabelPicker(false);
      }
      if (priorityPickerRef.current && !priorityPickerRef.current.contains(e.target as Node)) {
        setShowPriorityPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSubmit = () => {
    if (!taskTitle.trim()) {
      setTitleError('Title is required');
      titleRef.current?.focus();
      return;
    }
    setTitleError('');
    onSubmit({
      title: taskTitle.trim(),
      description: description.trim(),
      projectId,
      column,
      priority,
      labelIds: selectedLabelIds,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabelIds((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId],
    );
  };

  const currentColumn = colOptions.find((c) => c.id === column) ?? colOptions[0];
  const appliedLabels = projectLabels.filter((l) => selectedLabelIds.includes(l.id));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-rise mx-4 w-full max-w-[560px] rounded-[14px] border border-white/[0.08] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Breadcrumb header */}
        <div className="flex items-center justify-between px-[20px] pt-[16px] pb-[8px]">
          <div className="flex items-center gap-[6px]">
            {projects.length > 0 && (
              <>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="appearance-none bg-transparent text-[12px] text-ink-2 cursor-pointer outline-none transition-colors hover:text-ink-2"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface text-ink">
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[#454c55]">/</span>
              </>
            )}
            <span className="text-[12px] text-ink-2">New Task</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-[4px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink-2"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Title input */}
        <div className="px-[20px] pt-[4px]">
          <input
            ref={titleRef}
            type="text"
            value={taskTitle}
            onChange={(e) => {
              setTaskTitle(e.target.value);
              setTitleError('');
            }}
            aria-label="Title"
            placeholder="Task title"
            autoFocus
            className="w-full bg-transparent text-[20px] font-bold tracking-[-0.3px] text-white placeholder:text-[#454c55] outline-none"
          />
          {titleError && (
            <p className="mt-[4px] text-[12px] text-danger">{titleError}</p>
          )}
        </div>

        {/* Description */}
        <div className="px-[20px] pt-[10px] pb-[4px]">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
            rows={3}
            className="w-full resize-y bg-transparent text-[14px] leading-[1.55] text-ink-2 placeholder:text-[#454c55] outline-none"
          />
        </div>

        {/* Separator */}
        <div className="mx-[20px] border-b border-white/[0.06]" />

        {/* Property bar */}
        <div className="flex flex-wrap items-center gap-[6px] px-[20px] py-[10px]">
          {/* Column pill */}
          <div className="relative" ref={columnPickerRef}>
            <button
              type="button"
              onClick={() => {
                setShowColumnPicker((v) => !v);
                setShowLabelPicker(false);
              }}
              className="flex items-center gap-[5px] rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-[8px] py-[4px] text-[12px] text-ink-2 backdrop-blur-md transition-colors hover:border-white/[0.14] hover:bg-white/[0.06]"
            >
              <span
                className="size-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: currentColumn?.color ?? '#6b7280' }}
              />
              {currentColumn?.name ?? column}
            </button>
            {showColumnPicker && (
              <div className="absolute top-full left-0 z-50 mt-[4px] min-w-[160px] overflow-hidden rounded-[10px] border border-white/[0.08] bg-surface shadow-xl">
                {colOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setColumn(opt.id);
                      setShowColumnPicker(false);
                    }}
                    className={`flex w-full items-center gap-[6px] px-[10px] py-[7px] text-[12px] transition-colors hover:bg-white/[0.06] ${
                      column === opt.id ? 'text-ink' : 'text-ink-2'
                    }`}
                  >
                    <span
                      className="size-[6px] shrink-0 rounded-full"
                      style={{ backgroundColor: opt.color }}
                    />
                    {opt.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Priority pill */}
          <div className="relative" ref={priorityPickerRef}>
            <button
              type="button"
              onClick={() => {
                setShowPriorityPicker((v) => !v);
                setShowColumnPicker(false);
                setShowLabelPicker(false);
              }}
              className="flex items-center gap-[5px] rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-[8px] py-[4px] text-[12px] text-ink-2 backdrop-blur-md transition-colors hover:border-white/[0.14] hover:bg-white/[0.06]"
            >
              <span
                className="size-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: PRIORITY_META[priority].dot }}
              />
              {PRIORITY_META[priority].label}
            </button>
            {showPriorityPicker && (
              <div className="absolute top-full left-0 z-50 mt-[4px] min-w-[140px] overflow-hidden rounded-[10px] border border-white/[0.08] bg-surface shadow-xl">
                {PRIORITY_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPriority(p);
                      setShowPriorityPicker(false);
                    }}
                    className={`flex w-full items-center gap-[6px] px-[10px] py-[7px] text-[12px] transition-colors hover:bg-white/[0.06] ${
                      priority === p ? 'text-ink' : 'text-ink-2'
                    }`}
                  >
                    <span
                      className="size-[6px] shrink-0 rounded-full"
                      style={{ backgroundColor: PRIORITY_META[p].dot }}
                    />
                    {PRIORITY_META[p].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Labels pill */}
          <div className="relative" ref={labelPickerRef}>
            <button
              type="button"
              onClick={() => {
                setShowLabelPicker((v) => !v);
                setShowColumnPicker(false);
                setShowPriorityPicker(false);
              }}
              className="flex items-center gap-[5px] rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-[8px] py-[4px] text-[12px] text-ink-2 backdrop-blur-md transition-colors hover:border-white/[0.14] hover:bg-white/[0.06]"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1 1h6.5l7 7a1.414 1.414 0 0 1 0 2L9 15.5a1.414 1.414 0 0 1-2 0L.5 9V1z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
              </svg>
              {appliedLabels.length > 0 ? `${appliedLabels.length} label${appliedLabels.length > 1 ? 's' : ''}` : 'Labels'}
            </button>
            {showLabelPicker && (
              <div className="absolute top-full left-0 z-50 mt-[4px] min-w-[180px] overflow-hidden rounded-[10px] border border-white/[0.08] bg-surface shadow-xl">
                {projectLabels.length === 0 ? (
                  <p className="px-[10px] py-[8px] text-[12px] text-ink-3">
                    No labels for this project
                  </p>
                ) : (
                  projectLabels.map((label) => {
                    const isSelected = selectedLabelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => toggleLabel(label.id)}
                        className="flex w-full items-center gap-[7px] px-[10px] py-[7px] text-[12px] text-ink-2 transition-colors hover:bg-white/[0.06]"
                      >
                        <span
                          className="size-[8px] shrink-0 rounded-[2px]"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className={isSelected ? 'text-ink' : ''}>{label.name}</span>
                        {isSelected && (
                          <svg
                            className="ml-auto shrink-0"
                            width="11"
                            height="11"
                            viewBox="0 0 12 12"
                            fill="none"
                          >
                            <path
                              d="M2 6l3 3 5-5"
                              stroke="#5e6ad2"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Applied label chips */}
          {appliedLabels.map((label) => (
            <LabelChip
              key={label.id}
              label={label}
              size="sm"
              onRemove={() => toggleLabel(label.id)}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="mx-[20px] border-b border-white/[0.06]" />

        {/* Error */}
        {error && (
          <div className="mx-[20px] mt-[10px] rounded-[10px] border border-danger/30 bg-danger/10 px-[14px] py-[10px] text-[13px] text-danger backdrop-blur-md">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-[20px] py-[14px]">
          <span className="text-[11px] text-[#454c55]">
            <kbd className="font-['JetBrains_Mono']">Ctrl+Enter</kbd> to submit
          </span>
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[14px] py-[7px] text-[13px] font-medium text-ink-2 backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="kb-sheen relative flex items-center gap-[6px] overflow-hidden rounded-[9px] bg-accent px-[14px] py-[7px] text-[13px] font-bold text-bg transition-all hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
