import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MetricsBar from './MetricsBar';
import type { AgentMetrics } from './useAgentList';

const baseMetrics: AgentMetrics = {
  total: 5,
  active: 3,
  waiting: 1,
  finished: 1,
  emergency: 0,
};

function renderBar(metrics: Partial<AgentMetrics> = {}, activeFilter: string | null = null) {
  const onFilterClick = vi.fn();
  const result = render(
    <MetricsBar
      metrics={{ ...baseMetrics, ...metrics }}
      activeFilter={activeFilter}
      onFilterClick={onFilterClick}
    />,
  );
  return { onFilterClick, ...result };
}

describe('MetricsBar', () => {
  it('renders all metric buttons', () => {
    renderBar();
    expect(screen.getByTestId('metric-total')).toBeInTheDocument();
    expect(screen.getByTestId('metric-active')).toBeInTheDocument();
    expect(screen.getByTestId('metric-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('metric-finished')).toBeInTheDocument();
  });

  it('displays metric values', () => {
    renderBar();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // '1' appears twice (waiting and finished), use getAllByText
    expect(screen.getAllByText('1')).toHaveLength(2);
  });

  it('calls onFilterClick with status when clicked', async () => {
    const user = userEvent.setup();
    const { onFilterClick } = renderBar();
    await user.click(screen.getByTestId('metric-active'));
    expect(onFilterClick).toHaveBeenCalledWith('active');
  });

  it('calls onFilterClick with null for total', async () => {
    const user = userEvent.setup();
    const { onFilterClick } = renderBar();
    await user.click(screen.getByTestId('metric-total'));
    expect(onFilterClick).toHaveBeenCalledWith(null);
  });

  it('highlights active filter', () => {
    renderBar({}, 'active');
    const activeBtn = screen.getByTestId('metric-active');
    expect(activeBtn.className).toContain('bg-[rgba(179,229,2,0.1)]');
  });

  it('applies pulse animation when waiting > 0', () => {
    renderBar({ waiting: 2 });
    const waitingBtn = screen.getByTestId('metric-waiting');
    // The value span should have animate-pulse
    const valueSpan = waitingBtn.querySelector('.animate-pulse');
    expect(valueSpan).toBeTruthy();
  });
});
