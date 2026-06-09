import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasSlot } from './CanvasSlot';

vi.mock('../Terminal', () => ({
  XTermTerminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="mock-xterm">Terminal: {sessionId}</div>
  ),
}));

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

const AVAILABLE_SESSIONS = [
  { sessionId: 'sess-a', name: 'Session A', status: 'active' },
  { sessionId: 'sess-b', name: 'Session B', status: 'waiting' },
];

const defaultEmptyProps = {
  slotIndex: 0,
  sessionId: null,
  sessionName: null,
  sessionStatus: null,
  isFocused: false,
  availableSessions: AVAILABLE_SESSIONS,
  onFocus: vi.fn(),
  onAssignSession: vi.fn(),
  onRemoveSession: vi.fn(),
  onCreateSession: vi.fn().mockResolvedValue(null),
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Empty state ── */

describe('CanvasSlot — empty state', () => {
  it('renders placeholder text', () => {
    render(<CanvasSlot {...defaultEmptyProps} />);
    expect(screen.getByText('Adicionar Terminal')).toBeInTheDocument();
  });

  it('renders dropdown with available sessions', () => {
    render(<CanvasSlot {...defaultEmptyProps} />);
    expect(screen.getByTestId('slot-session-select-0')).toBeInTheDocument();
    expect(screen.getByText('Session A')).toBeInTheDocument();
    expect(screen.getByText('Session B')).toBeInTheDocument();
  });

  it('renders Nova Sessão button', () => {
    render(<CanvasSlot {...defaultEmptyProps} />);
    expect(screen.getByTestId('slot-new-session-btn-0')).toBeInTheDocument();
    expect(screen.getByText('Nova Sessão')).toBeInTheDocument();
  });

  it('does not render dropdown when no available sessions', () => {
    render(<CanvasSlot {...defaultEmptyProps} availableSessions={[]} />);
    expect(screen.queryByTestId('slot-session-select-0')).not.toBeInTheDocument();
  });

  it('calls onAssignSession when a session is selected from dropdown', async () => {
    const onAssign = vi.fn();
    render(<CanvasSlot {...defaultEmptyProps} onAssignSession={onAssign} />);

    const select = screen.getByTestId('slot-session-select-0') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'sess-a');

    expect(onAssign).toHaveBeenCalledWith(0, 'sess-a');
  });

  it('calls onCreateSession when Nova Sessão button is clicked', async () => {
    const onCreate = vi.fn().mockResolvedValue(null);
    render(<CanvasSlot {...defaultEmptyProps} onCreateSession={onCreate} />);

    await userEvent.click(screen.getByTestId('slot-new-session-btn-0'));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('assigns session after onCreateSession returns a sessionId', async () => {
    const onAssign = vi.fn();
    const onCreate = vi.fn().mockResolvedValue('new-sess-id');
    render(<CanvasSlot {...defaultEmptyProps} onCreateSession={onCreate} onAssignSession={onAssign} />);

    await userEvent.click(screen.getByTestId('slot-new-session-btn-0'));

    expect(onAssign).toHaveBeenCalledWith(0, 'new-sess-id');
  });
});

/* ── Filled state ── */

const filledProps = {
  slotIndex: 1,
  sessionId: 'sess-a',
  sessionName: 'Session A',
  sessionStatus: 'active',
  isFocused: false,
  availableSessions: AVAILABLE_SESSIONS,
  onFocus: vi.fn(),
  onAssignSession: vi.fn(),
  onRemoveSession: vi.fn(),
  onCreateSession: vi.fn().mockResolvedValue(null),
};

describe('CanvasSlot — filled state', () => {
  it('renders session name in header', () => {
    render(<CanvasSlot {...filledProps} />);
    expect(screen.getByText('Session A')).toBeInTheDocument();
  });

  it('renders XTermTerminal with the correct sessionId', () => {
    render(<CanvasSlot {...filledProps} />);
    expect(screen.getByTestId('mock-xterm')).toBeInTheDocument();
    expect(screen.getByText('Terminal: sess-a')).toBeInTheDocument();
  });

  it('renders remove button', () => {
    render(<CanvasSlot {...filledProps} />);
    expect(screen.getByTestId('remove-slot-btn')).toBeInTheDocument();
  });

  it('calls onRemoveSession with slotIndex when remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(<CanvasSlot {...filledProps} onRemoveSession={onRemove} />);

    await userEvent.click(screen.getByTestId('remove-slot-btn'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('calls onFocus with slotIndex when slot is clicked', async () => {
    const onFocus = vi.fn();
    render(<CanvasSlot {...filledProps} onFocus={onFocus} />);

    await userEvent.click(screen.getByTestId('canvas-slot-1'));
    expect(onFocus).toHaveBeenCalledWith(1);
  });

  it('does not render placeholder when filled', () => {
    render(<CanvasSlot {...filledProps} />);
    expect(screen.queryByText('Adicionar Terminal')).not.toBeInTheDocument();
  });
});

/* ── Focus state ── */

describe('CanvasSlot — focus styles', () => {
  it('applies green border class when focused', () => {
    render(<CanvasSlot {...filledProps} isFocused />);
    const slot = screen.getByTestId('canvas-slot-1');
    expect(slot.className).toContain('border-[#af0]');
  });

  it('applies muted border class when not focused', () => {
    render(<CanvasSlot {...filledProps} isFocused={false} />);
    const slot = screen.getByTestId('canvas-slot-1');
    expect(slot.className).toContain('border-[rgba(255,255,255,0.08)]');
  });
});
