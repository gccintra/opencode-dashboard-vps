import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasToolbar } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  it('renders all 5 layout buttons', () => {
    render(<CanvasToolbar layout={{ cols: 2, rows: 2 }} onLayoutChange={vi.fn()} />);
    expect(screen.getByTestId('layout-btn-1×1')).toBeInTheDocument();
    expect(screen.getByTestId('layout-btn-1×2')).toBeInTheDocument();
    expect(screen.getByTestId('layout-btn-2×1')).toBeInTheDocument();
    expect(screen.getByTestId('layout-btn-2×2')).toBeInTheDocument();
    expect(screen.getByTestId('layout-btn-2×3')).toBeInTheDocument();
  });

  it('marks active layout button with aria-pressed=true', () => {
    render(<CanvasToolbar layout={{ cols: 2, rows: 2 }} onLayoutChange={vi.fn()} />);
    expect(screen.getByTestId('layout-btn-2×2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('layout-btn-1×1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onLayoutChange with correct dims when button is clicked', async () => {
    const onChange = vi.fn();
    render(<CanvasToolbar layout={{ cols: 2, rows: 2 }} onLayoutChange={onChange} />);

    await userEvent.click(screen.getByTestId('layout-btn-1×2'));
    expect(onChange).toHaveBeenCalledWith({ cols: 1, rows: 2 });
  });

  it('calls onLayoutChange with 2×3 when that button is clicked', async () => {
    const onChange = vi.fn();
    render(<CanvasToolbar layout={{ cols: 1, rows: 1 }} onLayoutChange={onChange} />);

    await userEvent.click(screen.getByTestId('layout-btn-2×3'));
    expect(onChange).toHaveBeenCalledWith({ cols: 2, rows: 3 });
  });

  it('buttons are keyboard-focusable', () => {
    render(<CanvasToolbar layout={{ cols: 1, rows: 1 }} onLayoutChange={vi.fn()} />);
    const btn = screen.getByTestId('layout-btn-2×2');
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('active button has highlighted styles', () => {
    render(<CanvasToolbar layout={{ cols: 2, rows: 3 }} onLayoutChange={vi.fn()} />);
    const active = screen.getByTestId('layout-btn-2×3');
    expect(active.className).toContain('text-[#af0]');
  });
});
