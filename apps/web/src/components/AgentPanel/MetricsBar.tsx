/**
 * MetricsBar — horizontal bar showing agent counts.
 *
 * Displays total, active, waiting, and finished counts.
 * Click a metric to filter the agent grid.
 */

import type { AgentMetrics } from './useAgentList';

interface MetricsBarProps {
  metrics: AgentMetrics;
  activeFilter: string | null;
  onFilterClick: (status: string | null) => void;
}

export default function MetricsBar({ metrics, activeFilter, onFilterClick }: MetricsBarProps) {
  const items: {
    label: string;
    value: number;
    status: string | null;
    color: string;
    pulse?: boolean;
  }[] = [
    { label: 'Total', value: metrics.total, status: null, color: '#f0f0f0' },
    {
      label: 'Ativos',
      value: metrics.active,
      status: 'active',
      color: '#2d8',
    },
    {
      label: 'Aguardando',
      value: metrics.waiting,
      status: 'waiting',
      color: '#fa0',
      pulse: metrics.waiting > 0,
    },
    {
      label: 'Finalizados',
      value: metrics.finished,
      status: 'finished',
      color: '#5a626c',
    },
  ];

  return (
    <div
      className="flex shrink-0 items-center gap-[4px] border-b border-white/[0.07] px-[16px] py-[8px] overflow-x-auto"
      data-testid="metrics-bar"
    >
      {items.map((item) => (
        <button
          key={item.status ?? '__total'}
          className={`flex items-center gap-[6px] rounded-[6px] border px-[10px] py-[5px] font-['Inter'] text-[12px] font-medium transition-colors shrink-0 ${
            activeFilter === item.status
              ? 'border-[rgba(179,229,2,0.3)] bg-[rgba(179,229,2,0.1)] text-[#b3e502]'
              : 'border-[rgba(255,255,255,0.06)] bg-transparent text-[#9aa3ad] hover:border-[rgba(255,255,255,0.12)] hover:text-[#e6e8eb]'
          }`}
          onClick={() => onFilterClick(item.status)}
          data-testid={`metric-${item.status ?? 'total'}`}
        >
          <span
            className="inline-block size-[8px] shrink-0 rounded-[4px]"
            style={{
              backgroundColor: item.color,
              boxShadow:
                item.status === 'active' ? '0px 0px 4px 0px rgba(34,221,136,0.5)' : undefined,
            }}
          />
          <span>{item.label}</span>
          <span
            className={`font-['JetBrains_Mono'] text-[11px] ${item.pulse ? 'animate-pulse' : ''}`}
            style={{ color: item.color }}
          >
            {item.value}
          </span>
        </button>
      ))}
    </div>
  );
}
