import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasGrid } from './CanvasGrid';

vi.mock('../Terminal', () => ({
  XTermTerminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="mock-xterm">Terminal: {sessionId}</div>
  ),
}));

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

const SESSIONS = [
  { sessionId: 'sess-a', name: 'Session A', status: 'active' },
  { sessionId: 'sess-b', name: 'Session B', status: 'waiting' },
];

const defaultProps = {
  cols: 2,
  rows: 2,
  slots: {},
  sessions: SESSIONS,
  onAssign: vi.fn(),
  onRemove: vi.fn(),
  onCreateSession: vi.fn().mockResolvedValue(null),
};

describe('CanvasGrid', () => {
  it('renders correct number of slots for 1×1', () => {
    render(<CanvasGrid {...defaultProps} cols={1} rows={1} />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(1);
  });

  it('renders correct number of slots for 1×2', () => {
    render(<CanvasGrid {...defaultProps} cols={1} rows={2} />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(2);
  });

  it('renders correct number of slots for 2×1', () => {
    render(<CanvasGrid {...defaultProps} cols={2} rows={1} />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(2);
  });

  it('renders correct number of slots for 2×2', () => {
    render(<CanvasGrid {...defaultProps} cols={2} rows={2} />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(4);
  });

  it('renders correct number of slots for 2×3', () => {
    render(<CanvasGrid {...defaultProps} cols={2} rows={3} />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(6);
  });

  it('CSS grid template has correct columns', () => {
    render(<CanvasGrid {...defaultProps} cols={2} rows={2} />);
    const grid = screen.getByTestId('canvas-grid-inner');
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(2, 1fr)' });
  });

  it('CSS grid template has correct rows', () => {
    render(<CanvasGrid {...defaultProps} cols={2} rows={3} />);
    const grid = screen.getByTestId('canvas-grid-inner');
    expect(grid).toHaveStyle({ gridTemplateRows: 'repeat(3, 1fr)' });
  });

  it('renders filled slot with XTermTerminal when session is assigned', () => {
    const slots = { 0: 'sess-a', 1: null, 2: null, 3: null };
    render(<CanvasGrid {...defaultProps} slots={slots} />);
    expect(screen.getByTestId('mock-xterm')).toBeInTheDocument();
    expect(screen.getByText('Terminal: sess-a')).toBeInTheDocument();
  });

  it('propagates onAssign when session selected from slot dropdown', async () => {
    const onAssign = vi.fn();
    render(<CanvasGrid {...defaultProps} onAssign={onAssign} />);

    const select = screen.getByTestId('slot-session-select-0') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'sess-a');

    expect(onAssign).toHaveBeenCalledWith(0, 'sess-a');
  });

  it('propagates onRemove when remove button clicked in filled slot', async () => {
    const onRemove = vi.fn();
    const slots = { 0: 'sess-a', 1: null, 2: null, 3: null };
    render(<CanvasGrid {...defaultProps} slots={slots} onRemove={onRemove} />);

    await userEvent.click(screen.getByTestId('remove-slot-btn'));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('does not show assigned sessions in other slots dropdowns', () => {
    const slots = { 0: 'sess-a', 1: null, 2: null, 3: null };
    render(<CanvasGrid {...defaultProps} slots={slots} />);

    // Slot 1 is empty and should show dropdown; sess-a is assigned to slot 0
    const select = screen.getByTestId('slot-session-select-1') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // sess-a should not appear in the dropdown since it's already assigned
    expect(screen.queryByRole('option', { name: 'Session A' })).not.toBeInTheDocument();
  });
});
