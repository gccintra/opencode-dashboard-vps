import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallCard } from './ToolCallCard';
import type { ToolCall } from './types';

const base: ToolCall = {
  id: 't1',
  name: 'bash',
  input: { command: 'ls -la' },
  result: 'file1\nfile2',
  status: 'done',
};

describe('ToolCallCard', () => {
  it('renders collapsed by default (body hidden)', () => {
    render(<ToolCallCard toolCall={base} />);
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-call-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-call-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands on click to reveal input and result', async () => {
    const user = userEvent.setup();
    render(<ToolCallCard toolCall={base} />);
    await user.click(screen.getByTestId('tool-call-toggle'));
    expect(screen.getByTestId('tool-call-body')).toBeInTheDocument();
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
    expect(screen.getByText(/file1/)).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses again on second click', async () => {
    const user = userEvent.setup();
    render(<ToolCallCard toolCall={base} />);
    const toggle = screen.getByTestId('tool-call-toggle');
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByTestId('tool-call-body')).not.toBeInTheDocument();
  });

  it('renders the correct status dot for pending/done/error', () => {
    const { rerender } = render(<ToolCallCard toolCall={{ ...base, status: 'pending' }} />);
    expect(screen.getByTestId('tool-call-status-dot')).toHaveAttribute('data-status', 'pending');

    rerender(<ToolCallCard toolCall={{ ...base, status: 'done' }} />);
    expect(screen.getByTestId('tool-call-status-dot')).toHaveAttribute('data-status', 'done');

    rerender(<ToolCallCard toolCall={{ ...base, status: 'error' }} />);
    expect(screen.getByTestId('tool-call-status-dot')).toHaveAttribute('data-status', 'error');
  });

  it('handles missing result gracefully when expanded', async () => {
    const user = userEvent.setup();
    render(<ToolCallCard toolCall={{ ...base, result: undefined }} />);
    await user.click(screen.getByTestId('tool-call-toggle'));
    expect(screen.getByTestId('tool-call-body')).toBeInTheDocument();
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });
});
