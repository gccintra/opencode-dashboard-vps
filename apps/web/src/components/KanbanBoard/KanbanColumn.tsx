import type { Task } from './KanbanCard';
import { KanbanCard } from './KanbanCard';
import type { KanbanColumn as KanbanColumnDef } from '../../lib/api';

interface KanbanColumnProps {
  col: KanbanColumnDef;
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onDrop: (taskId: string, columnId: string, beforeTaskId: string | null) => void;
  onAddTask?: () => void;
}

export function KanbanColumn({ col, tasks, onEdit, onDelete, onDrop, onAddTask }: KanbanColumnProps) {
  return (
    <section
      className="group/col flex h-full w-[68vw] max-w-[260px] shrink-0 flex-col sm:w-[312px]"
      aria-label={`${col.name} column`}
    >
      {/* Column header */}
      <header className="mb-[12px] flex items-center gap-[8px] px-[6px]">
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ backgroundColor: col.color }}
        />
        <h3 className="text-[13px] font-semibold tracking-[0.1px] text-ink">
          {col.name}
        </h3>
        <span className="mono-meta ml-[2px] text-[11px] tabular-nums text-ink-3">
          {tasks.length}
        </span>

        {onAddTask && (
          <button
            onClick={onAddTask}
            className="ml-auto rounded-[7px] p-[5px] text-ink-3 opacity-0 transition-all duration-150 hover:bg-white/[0.06] hover:text-accent focus-visible:opacity-100 group-hover/col:opacity-100"
            aria-label={`Add task to ${col.name}`}
            title={`Add task to ${col.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>

      {/* Drop zone / task list — data-column-id is the pointer-drag drop target */}
      <div
        data-column-id={col.id}
        className="kb-scroll flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto rounded-[16px] border border-white/[0.04] bg-white/[0.012] p-[8px] transition-colors duration-200"
      >
        {tasks.map((task, i) => (
          <KanbanCard
            key={task.id}
            task={task}
            index={i}
            accent={col.color}
            onEdit={() => onEdit(task)}
            onDelete={() => onDelete(task.id)}
            onMoveTo={onDrop}
          />
        ))}

        {tasks.length === 0 && (
          <button
            onClick={onAddTask}
            className="flex flex-1 flex-col items-center justify-center gap-[8px] rounded-[12px] border border-dashed border-white/[0.07] py-[36px] text-[#454c55] transition-colors duration-200 hover:border-white/[0.12] hover:text-[#6b7280]"
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="text-[12px] font-medium">Add task</span>
          </button>
        )}
      </div>
    </section>
  );
}
