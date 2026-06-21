import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="panel-group" className={className}>{children}</div>
  ),
  Panel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel">{children}</div>
  ),
  Separator: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid="separator" className={className}>{children}</div>
  ),
}));

const SESSIONS = [
  { sessionId: 'sess-a', name: 'Session A', status: 'active' },
  { sessionId: 'sess-b', name: 'Session B', status: 'waiting' },
];

const defaultProps = {
  templateId: '2x2',
  storageKey: 'proj-test',
  slots: {},
  sessions: SESSIONS,
  onAssign: vi.fn(),
  onRemove: vi.fn(),
  onCreateSession: vi.fn().mockResolvedValue(null),
};

beforeEach(() => {
  localStorage.clear();
});

describe('CanvasGrid', () => {
  it('renders 1 slot for single template', () => {
    render(<CanvasGrid {...defaultProps} templateId="single" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(1);
  });

  it('renders 2 slots for 2col template', () => {
    render(<CanvasGrid {...defaultProps} templateId="2col" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(2);
  });

  it('renders 2 slots for 2row template', () => {
    render(<CanvasGrid {...defaultProps} templateId="2row" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(2);
  });

  it('renders 3 slots for left-stack template', () => {
    render(<CanvasGrid {...defaultProps} templateId="left-stack" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(3);
  });

  it('renders 3 slots for right-stack template', () => {
    render(<CanvasGrid {...defaultProps} templateId="right-stack" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(3);
  });

  it('renders 4 slots for 2x2 template', () => {
    render(<CanvasGrid {...defaultProps} templateId="2x2" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(4);
  });

  it('renders 3 slots for 3col template', () => {
    render(<CanvasGrid {...defaultProps} templateId="3col" />);
    expect(screen.getAllByTestId(/^canvas-slot-/)).toHaveLength(3);
  });

  it('renders filled slot with XTermTerminal when session is assigned', () => {
    const slots = { a: 'sess-a', b: null };
    render(<CanvasGrid {...defaultProps} templateId="2col" slots={slots} />);
    expect(screen.getByTestId('mock-xterm')).toBeInTheDocument();
    expect(screen.getByText('Terminal: sess-a')).toBeInTheDocument();
  });

  it('propagates onAssign with string slotId when session selected', async () => {
    const onAssign = vi.fn();
    render(<CanvasGrid {...defaultProps} templateId="2col" onAssign={onAssign} />);

    const select = screen.getByTestId('slot-session-select-0') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'sess-a');

    expect(onAssign).toHaveBeenCalledWith('a', 'sess-a');
  });

  it('propagates onRemove with string slotId when remove button clicked', async () => {
    const onRemove = vi.fn();
    const slots = { a: 'sess-a', b: null };
    render(<CanvasGrid {...defaultProps} templateId="2col" slots={slots} onRemove={onRemove} />);

    await userEvent.click(screen.getByTestId('remove-slot-btn'));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('does not show assigned sessions in other slots dropdowns', () => {
    const slots = { a: 'sess-a', b: null };
    render(<CanvasGrid {...defaultProps} templateId="2col" slots={slots} />);

    const select = screen.getByTestId('slot-session-select-1') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Session A' })).not.toBeInTheDocument();
  });
});
