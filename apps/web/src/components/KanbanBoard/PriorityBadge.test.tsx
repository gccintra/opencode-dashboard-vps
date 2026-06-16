import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge, PRIORITY_META, PRIORITY_ORDER } from './PriorityBadge';

describe('PriorityBadge', () => {
  it('renders the label for each priority level', () => {
    for (const p of PRIORITY_ORDER) {
      const { unmount } = render(<PriorityBadge priority={p} />);
      expect(screen.getByText(PRIORITY_META[p].label)).toBeInTheDocument();
      unmount();
    }
  });

  it('exposes low/medium/high in order', () => {
    expect(PRIORITY_ORDER).toEqual(['low', 'medium', 'high']);
  });
});
