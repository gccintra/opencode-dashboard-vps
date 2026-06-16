import { LabelManager } from './LabelManager';

interface LabelsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Standalone global label management modal. Accessible from the KanbanBoard
 * header without opening a specific task. Creates, recolors, and deletes labels.
 */
export function LabelsModal({ open, onClose }: LabelsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-rise mx-4 flex w-full max-w-[480px] flex-col rounded-[14px] border border-white/[0.08] bg-[#111118] shadow-2xl"
        style={{ maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-[20px] py-[14px]">
          <div className="flex items-center gap-[8px]">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M1 1h6.5l7 7a1.414 1.414 0 0 1 0 2L9 15.5a1.414 1.414 0 0 1-2 0L.5 9V1z"
                stroke="#b3e502"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="4.5" cy="4.5" r="1" fill="#b3e502" />
            </svg>
            <h2 className="font-['Syne'] text-[17px] font-bold tracking-[-0.2px] text-white">
              Manage Labels
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-[6px] text-[#9aa3ad] transition-colors hover:bg-white/[0.06] hover:text-[#e6e8eb]"
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

        {/* Label manager — scrollable */}
        <div className="kb-scroll min-h-0 flex-1 overflow-y-auto px-[20px] py-[14px]">
          <LabelManager
            appliedIds={[]}
            onToggle={() => { /* standalone mode — no task association */ }}
            allowCreate={true}
          />
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.08] px-[20px] py-[12px]">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[9px] border border-white/[0.07] bg-white/[0.03] py-[8px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
