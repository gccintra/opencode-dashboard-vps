import { useSystemStats } from '../hooks/useSystemStats';

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)}GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function statColor(pct: number): string {
  if (pct >= 85) return '#f54';
  if (pct >= 70) return '#fa0';
  return '#2d8';
}

export function VpsStatsWidget() {
  const stats = useSystemStats();
  if (!stats) return null;

  const memPct = stats.memTotal > 0 ? Math.round((stats.memUsed / stats.memTotal) * 100) : 0;
  const cpuColor = statColor(stats.cpu);
  const memColor = statColor(memPct);

  return (
    <div className="flex items-center gap-[10px]" title="Uso de recursos da VPS">
      <span className="flex items-center gap-[5px] font-['JetBrains_Mono'] text-[10px]">
        <span className="shrink-0 size-[6px] rounded-full" style={{ backgroundColor: cpuColor }} />
        <span style={{ color: cpuColor }}>CPU</span>
        <span className="text-[#9aa3ad]">{stats.cpu}%</span>
      </span>
      <span className="flex items-center gap-[5px] font-['JetBrains_Mono'] text-[10px]">
        <span className="shrink-0 size-[6px] rounded-full" style={{ backgroundColor: memColor }} />
        <span style={{ color: memColor }}>RAM</span>
        <span className="text-[#9aa3ad]">{fmtBytes(stats.memUsed)}/{fmtBytes(stats.memTotal)}</span>
        <span style={{ color: memColor }}>({memPct}%)</span>
      </span>
    </div>
  );
}
