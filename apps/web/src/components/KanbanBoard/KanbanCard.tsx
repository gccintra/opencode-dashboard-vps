import {
  TaskBadge,
  IssueBadge,
  LabelBadge,
  ProjectBadge,
  SessionBadge,
  type GitHubLabel,
} from './TaskBadge';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  source: string;
  column: string;
  sortOrder: number;
  githubIssueUrl: string | null;
  githubLabels: GitHubLabel[] | null;
  githubIssueNumber: number | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
}

interface KanbanCardProps {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  draggable?: boolean;
}

export function KanbanCard({ task, onEdit, onDelete, draggable = true }: KanbanCardProps) {
  const isGithub = task.source === 'github';
  const labels = task.githubLabels || [];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <article
      draggable={draggable}
      onDragStart={handleDragStart}
      onClick={onEdit}
      className="flex cursor-pointer flex-col gap-[10px] rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[14px] transition-colors hover:border-[rgba(255,255,255,0.16)] active:cursor-grabbing"
    >
      {/* Top row: badges */}
      <div className="flex flex-wrap items-center gap-[6px]">
        {isGithub ? <IssueBadge number={task.githubIssueNumber || 0} /> : <TaskBadge />}
        {task.sessionId && <SessionBadge />}
        {task.projectName && <ProjectBadge name={task.projectName} />}
      </div>

      {/* Title */}
      <h4 className="font-['Inter'] text-[13.5px] font-semibold leading-[1.35] text-[#f0f0f0] line-clamp-2">
        {task.title}
      </h4>

      {/* Description (truncated) */}
      {task.description && (
        <p className="font-['Inter'] text-[12px] leading-[1.4] text-[#667] line-clamp-2">
          {task.description}
        </p>
      )}

      {/* GitHub labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-[4px]">
          {labels.map((label) => (
            <LabelBadge key={label.name} label={label} />
          ))}
        </div>
      )}

      {/* Bottom row: actions + external link */}
      <div className="flex items-center justify-between pt-[4px]">
        {/* Open in GitHub link */}
        {task.githubIssueUrl && (
          <a
            href={task.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-[4px] font-['Inter'] text-[11px] font-medium text-[#58a6ff] hover:underline"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Open
          </a>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-auto rounded-[4px] p-[4px] font-['Inter'] text-[11px] font-medium text-[#445] hover:text-red-400 transition-colors"
          aria-label="Delete task"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 3h8M4.5 3V2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5 5.5v3M7 5.5v3M3.5 3l.5 7a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l.5-7"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </article>
  );
}
