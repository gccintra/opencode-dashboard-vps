import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasToolbar } from './CanvasToolbar';
import { CANVAS_TEMPLATES } from './canvasTemplates';

describe('CanvasToolbar', () => {
  it('renders all template buttons', () => {
    render(<CanvasToolbar templateId="2col" onTemplateChange={vi.fn()} />);
    for (const t of CANVAS_TEMPLATES) {
      expect(screen.getByTestId(`layout-btn-${t.id}`)).toBeInTheDocument();
    }
  });

  it('marks active template button with aria-pressed=true', () => {
    render(<CanvasToolbar templateId="2col" onTemplateChange={vi.fn()} />);
    expect(screen.getByTestId('layout-btn-2col')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('layout-btn-single')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onTemplateChange with correct id when button is clicked', async () => {
    const onChange = vi.fn();
    render(<CanvasToolbar templateId="2col" onTemplateChange={onChange} />);
    await userEvent.click(screen.getByTestId('layout-btn-2x2'));
    expect(onChange).toHaveBeenCalledWith('2x2');
  });

  it('calls onTemplateChange with left-stack when that button is clicked', async () => {
    const onChange = vi.fn();
    render(<CanvasToolbar templateId="single" onTemplateChange={onChange} />);
    await userEvent.click(screen.getByTestId('layout-btn-left-stack'));
    expect(onChange).toHaveBeenCalledWith('left-stack');
  });

  it('buttons are keyboard-focusable', () => {
    render(<CanvasToolbar templateId="single" onTemplateChange={vi.fn()} />);
    const btn = screen.getByTestId('layout-btn-2x2');
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('active button has highlighted styles', () => {
    render(<CanvasToolbar templateId="right-stack" onTemplateChange={vi.fn()} />);
    const active = screen.getByTestId('layout-btn-right-stack');
    expect(active.className).toContain('text-[#5e6ad2]');
  });
});
