import { CANVAS_TEMPLATES } from './canvasTemplates';

function TemplateIcon({ id }: { id: string }) {
  const W = 20;
  const H = 13;
  const g = 1;
  const p = 1;
  const w = W - 2 * p;
  const h = H - 2 * p;
  const hw = (w - g) / 2;
  const hh = (h - g) / 2;
  const tw = (w - 2 * g) / 3;

  const r = (x: number, y: number, rw: number, rh: number, key: string) => (
    <rect key={key} x={x} y={y} width={rw} height={rh} rx={0.5} />
  );

  const rects = (() => {
    switch (id) {
      case 'single':
        return [r(p, p, w, h, 'a')];
      case '2col':
        return [r(p, p, hw, h, 'a'), r(p + hw + g, p, hw, h, 'b')];
      case '2row':
        return [r(p, p, w, hh, 'a'), r(p, p + hh + g, w, hh, 'b')];
      case 'left-stack':
        return [
          r(p, p, hw, hh, 'a'),
          r(p, p + hh + g, hw, hh, 'b'),
          r(p + hw + g, p, hw, h, 'c'),
        ];
      case 'right-stack':
        return [
          r(p, p, hw, h, 'a'),
          r(p + hw + g, p, hw, hh, 'b'),
          r(p + hw + g, p + hh + g, hw, hh, 'c'),
        ];
      case '2x2':
        return [
          r(p, p, hw, hh, 'a'),
          r(p, p + hh + g, hw, hh, 'b'),
          r(p + hw + g, p, hw, hh, 'c'),
          r(p + hw + g, p + hh + g, hw, hh, 'd'),
        ];
      case '3col':
        return [
          r(p, p, tw, h, 'a'),
          r(p + tw + g, p, tw, h, 'b'),
          r(p + 2 * (tw + g), p, tw, h, 'c'),
        ];
      default:
        return [r(p, p, hw, h, 'a'), r(p + hw + g, p, hw, h, 'b')];
    }
  })();

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="currentColor">
      {rects}
    </svg>
  );
}

interface CanvasToolbarProps {
  templateId: string;
  onTemplateChange: (templateId: string) => void;
  onResetLayout?: () => void;
}

export function CanvasToolbar({ templateId, onTemplateChange, onResetLayout }: CanvasToolbarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-[8px] border-b border-white/[0.07] bg-[#111118] px-[20px] py-[10px]"
      data-testid="canvas-toolbar"
    >
      <span className="text-[11px] text-[#5a626c] shrink-0">Layout:</span>
      <div className="flex items-center gap-[4px]" role="group" aria-label="Layout do canvas">
        {CANVAS_TEMPLATES.map((t) => {
          const isActive = templateId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTemplateChange(t.id)}
              aria-pressed={isActive}
              title={t.label}
              className={`rounded-[5px] px-[8px] py-[5px] transition-colors ${
                isActive
                  ? 'bg-[rgba(179,229,2,0.15)] text-[#b3e502] border border-[rgba(179,229,2,0.3)]'
                  : 'border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb]'
              }`}
              data-testid={`layout-btn-${t.id}`}
            >
              <TemplateIcon id={t.id} />
            </button>
          );
        })}
      </div>
      {onResetLayout && (
        <>
          <div className="h-[14px] w-px bg-white/[0.08]" />
          <button
            onClick={onResetLayout}
            title="Restaurar tamanhos iguais"
            className="flex items-center justify-center size-[27px] rounded-[5px] border border-white/[0.07] text-[#9aa3ad] hover:border-white/[0.12] hover:text-[#e6e8eb] transition-colors"
            data-testid="reset-layout-btn"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6a4 4 0 1 0 .8-2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M2 2.5v2.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
