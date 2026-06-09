import type { Task } from './KanbanCard';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  id: string;
  title: string;
  count: number;
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onDrop: (taskId: string, column: string) => void;
}

const COLUMN_COLORS: Record<string, string> = {
  backlog: '#445',
  in_progress: '#fa0',
  done: '#2d8',
};

const COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
};

export function KanbanColumn({ id, tasks, onEdit, onDelete, onDrop }: KanbanColumnProps) {
  const color = COLUMN_COLORS[id] || '#445';
  const label = COLUMN_LABELS[id] || id;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      onDrop(taskId, id);
    }
  };

  return (
    <div
      className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-[8px] border-b border-[rgba(255,255,255,0.06)] px-[16px] py-[12px]">
        <span
          className="size-[8px] shrink-0 rounded-[4px]"
          style={{ backgroundColor: color, boxShadow: `0px 0px 6px 0px ${color}40` }}
        />
        <h3 className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">{label}</h3>
        <span className="ml-auto font-['JetBrains_Mono'] text-[11px] font-medium text-[#445]">
          {tasks.length}
        </span>
      </div>

      {/* Tasks list */}
      <div className="flex flex-col gap-[8px] overflow-y-auto p-[10px]">
        {tasks.map((task) => (
          <KanbanCard
            key={task.id}
            task={task}
            onEdit={() => onEdit(task)}
            onDelete={() => onDelete(task.id)}
          />
        ))}

        {/* Empty state */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[40px] text-center">
            <p className="font-['Inter'] text-[12px] text-[#445]">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
}
