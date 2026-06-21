export interface CanvasTemplate {
  id: string;
  label: string;
  slots: readonly string[];
}

export const CANVAS_TEMPLATES: readonly CanvasTemplate[] = [
  { id: 'single',      label: 'Single',    slots: ['a'] },
  { id: '2col',        label: '2 colunas', slots: ['a', 'b'] },
  { id: '2row',        label: '2 linhas',  slots: ['a', 'b'] },
  { id: 'left-stack',  label: 'Esq ×2',   slots: ['a', 'b', 'c'] },
  { id: 'right-stack', label: 'Dir ×2',   slots: ['a', 'b', 'c'] },
  { id: '2x2',         label: '2×2',       slots: ['a', 'b', 'c', 'd'] },
  { id: '3col',        label: '3 colunas', slots: ['a', 'b', 'c'] },
];

export const DEFAULT_TEMPLATE_ID = '2col';

export function getTemplate(id: string): CanvasTemplate {
  return (
    CANVAS_TEMPLATES.find((t) => t.id === id) ??
    CANVAS_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!
  );
}
