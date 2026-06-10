import { describe, it, expect } from 'vitest';
import { healthRoutes } from './health';

describe('GET /api/health', () => {
  it('returns 200 with status, uptime, and pid', async () => {
    const res = await healthRoutes.handle(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; uptime: number; pid: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.pid).toBe(process.pid);
  });
});
