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
          className="size-[8px] shrink-0 rounded-full"
          style={{ backgroundColor: col.color, boxShadow: `0 0 8px ${col.color}66` }}
        />
        <h3 className="font-['Syne'] text-[14px] font-bold tracking-[0.2px] text-[#e6e8eb]">
          {col.name}
        </h3>
        <span className="ml-[2px] rounded-full border border-white/[0.07] bg-white/[0.03] px-[8px] py-[1px] font-['JetBrains_Mono'] text-[11px] font-medium text-[#7a828c] tabular-nums">
          {tasks.length}
        </span>

        {onAddTask && (
          <button
            onClick={onAddTask}
            className="ml-auto rounded-[7px] p-[5px] text-[#5a626c] opacity-0 transition-all duration-150 hover:bg-white/[0.06] hover:text-[#b3e502] focus-visible:opacity-100 group-hover/col:opacity-100"
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
            <span className="font-['Inter'] text-[12px] font-medium">Add task</span>
          </button>
        )}
      </div>
    </section>
  );
}
