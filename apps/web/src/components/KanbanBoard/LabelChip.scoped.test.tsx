import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabelChip, parseScopedLabel } from './LabelChip';

describe('parseScopedLabel', () => {
  it('parses GROUP::value into scope + value', () => {
    expect(parseScopedLabel('backend::api')).toEqual({ scope: 'backend', value: 'api' });
  });

  it('returns null scope for a plain name', () => {
    expect(parseScopedLabel('bug')).toEqual({ scope: null, value: 'bug' });
  });

  it('only splits on the first separator', () => {
    expect(parseScopedLabel('a::b::c')).toEqual({ scope: 'a', value: 'b::c' });
  });
});

describe('LabelChip scoped rendering', () => {
  it('renders both scope and value segments for a scoped label', () => {
    render(<LabelChip label={{ name: 'priority::high', color: '#f55' }} />);
    expect(screen.getByText('priority')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders a plain label as a single segment', () => {
    render(<LabelChip label={{ name: 'bug', color: '#f55' }} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
  });
});
