import { useState, useEffect } from 'react';

export interface TaskFormData {
  title: string;
  description: string;
  projectId: string;
}

interface Project {
  id: string;
  name: string;
}

interface TaskModalProps {
  open: boolean;
  title: string;
  initial: TaskFormData;
  projects: Project[];
  onClose: () => void;
  onSubmit: (data: TaskFormData) => void;
  error: string | null;
  loading: boolean;
}

export function TaskModal({
  open,
  title,
  initial,
  projects,
  onClose,
  onSubmit,
  error,
  loading,
}: TaskModalProps) {
  const [taskTitle, setTaskTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [titleError, setTitleError] = useState('');

  useEffect(() => {
    if (open) {
      setTaskTitle(initial.title);
      setDescription(initial.description);
      setProjectId(initial.projectId);
      setTitleError('');
    }
  }, [open, initial]);

  const handleSubmit = () => {
    if (!taskTitle.trim()) {
      setTitleError('Title is required');
      return;
    }
    setTitleError('');
    onSubmit({
      title: taskTitle.trim(),
      description: description.trim(),
      projectId,
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[420px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">{title}</h3>

        <div className="mt-[18px] space-y-[14px]">
          {/* Title */}
          <div>
            <label
              htmlFor="task-title"
              className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
            >
              Title
            </label>
            <input
              id="task-title"
              type="text"
              value={taskTitle}
              onChange={(e) => {
                setTaskTitle(e.target.value);
                setTitleError('');
              }}
              className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="Task title"
              autoFocus
            />
            {titleError && (
              <p className="mt-[4px] font-['Inter'] text-[12px] text-red-400">{titleError}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="task-description"
              className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
            >
              Description <span className="text-[#556] font-normal normal-case">(optional)</span>
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="Optional description"
            />
          </div>

          {/* Project selector */}
          {projects.length > 0 && (
            <div>
              <label
                htmlFor="task-project"
                className="mb-[5px] block font-['Inter'] text-[12px] font-medium uppercase tracking-[0.48px] text-[#445]"
              >
                Project
              </label>
              <select
                id="task-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] outline-none focus:border-[rgba(255,255,255,0.16)] appearance-none"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-[14px] rounded-[6px] border border-red-500/30 bg-red-500/10 px-[12px] py-[8px] font-['Inter'] text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-[6px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
