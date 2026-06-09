import type { CanvasLayout } from '../../hooks/useCanvasState';

interface LayoutOption {
  cols: number;
  rows: number;
  label: string;
}

const LAYOUTS: LayoutOption[] = [
  { cols: 1, rows: 1, label: '1×1' },
  { cols: 1, rows: 2, label: '1×2' },
  { cols: 2, rows: 1, label: '2×1' },
  { cols: 2, rows: 2, label: '2×2' },
  { cols: 2, rows: 3, label: '2×3' },
];

interface CanvasToolbarProps {
  layout: Pick<CanvasLayout, 'cols' | 'rows'>;
  onLayoutChange: (dims: { cols: number; rows: number }) => void;
}

export function CanvasToolbar({ layout, onLayoutChange }: CanvasToolbarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-[8px] border-b border-[rgba(255,255,255,0.08)] bg-[#111118] px-[20px] py-[10px]"
      data-testid="canvas-toolbar"
    >
      <span className="font-['Inter'] text-[11px] text-[#556] shrink-0">Layout:</span>
      <div className="flex items-center gap-[4px]" role="group" aria-label="Layout do canvas">
        {LAYOUTS.map((opt) => {
          const isActive = layout.cols === opt.cols && layout.rows === opt.rows;
          return (
            <button
              key={opt.label}
              onClick={() => onLayoutChange({ cols: opt.cols, rows: opt.rows })}
              aria-pressed={isActive}
              className={`rounded-[5px] px-[10px] py-[5px] font-['JetBrains_Mono'] text-[12px] font-medium transition-colors ${
                isActive
                  ? 'bg-[rgba(170,255,0,0.15)] text-[#af0] border border-[rgba(170,255,0,0.3)]'
                  : 'border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]'
              }`}
              data-testid={`layout-btn-${opt.label}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
