import { Elysia } from 'elysia';
import { readFileSync } from 'node:fs';
import { authGuard } from '../auth/middleware';

interface SystemStats {
  cpu: number;       // 0–100 percent
  memUsed: number;   // bytes
  memTotal: number;  // bytes
}

let prevIdle = 0;
let prevTotal = 0;

function readCpuPercent(): number {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0];
    // cpu  user nice system idle iowait irq softirq steal guest guest_nice
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + parts[4]; // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    const diffIdle = idle - prevIdle;
    const diffTotal = total - prevTotal;
    prevIdle = idle;
    prevTotal = total;
    if (diffTotal === 0) return 0;
    return Math.round((1 - diffIdle / diffTotal) * 100);
  } catch {
    return 0;
  }
}

function readMemStats(): { memUsed: number; memTotal: number } {
  try {
    const text = readFileSync('/proc/meminfo', 'utf8');
    const get = (key: string) => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) * 1024 : 0; // kB → bytes
    };
    const total = get('MemTotal');
    const free = get('MemFree');
    const buffers = get('Buffers');
    const cached = get('Cached');
    const sReclaimable = get('SReclaimable');
    const used = total - free - buffers - cached - sReclaimable;
    return { memUsed: Math.max(0, used), memTotal: total };
  } catch {
    return { memUsed: 0, memTotal: 0 };
  }
}

export const systemRoutes = new Elysia().guard(authGuard, (app) =>
  app.get('/api/system/stats', (): SystemStats => {
    const cpu = readCpuPercent();
    const { memUsed, memTotal } = readMemStats();
    return { cpu, memUsed, memTotal };
  }),
);
