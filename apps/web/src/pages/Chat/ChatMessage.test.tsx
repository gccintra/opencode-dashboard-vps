import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessageData } from './types';

describe('ChatMessage', () => {
  it('renders user message right-aligned with neon styling', () => {
    const msg: ChatMessageData = { id: '1', role: 'user', content: 'hello' };
    render(<ChatMessage message={msg} />);
    const el = screen.getByTestId('chat-message');
    expect(el).toHaveAttribute('data-role', 'user');
    expect(el.className).toContain('justify-end');
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders assistant message left-aligned with card styling', () => {
    const msg: ChatMessageData = { id: '2', role: 'assistant', content: 'hi there' };
    render(<ChatMessage message={msg} />);
    const el = screen.getByTestId('chat-message');
    expect(el).toHaveAttribute('data-role', 'assistant');
    expect(el.className).toContain('justify-start');
    expect(screen.getByText('hi there')).toBeInTheDocument();
  });

  it('shows a streaming cursor only when streaming', () => {
    const msg: ChatMessageData = { id: '3', role: 'assistant', content: 'typing' };
    const { rerender } = render(<ChatMessage message={msg} streaming />);
    expect(screen.getByTestId('streaming-cursor')).toBeInTheDocument();

    rerender(<ChatMessage message={msg} />);
    expect(screen.queryByTestId('streaming-cursor')).not.toBeInTheDocument();
  });

  it('renders tool calls above assistant text', () => {
    const msg: ChatMessageData = {
      id: '4',
      role: 'assistant',
      content: 'done',
      toolCalls: [{ id: 't1', name: 'bash', input: { cmd: 'ls' }, status: 'done' }],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('chat-message-tools')).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
  });

  it('does not render a tools container for user messages', () => {
    const msg: ChatMessageData = { id: '5', role: 'user', content: 'q' };
    render(<ChatMessage message={msg} />);
    expect(screen.queryByTestId('chat-message-tools')).not.toBeInTheDocument();
  });
});
