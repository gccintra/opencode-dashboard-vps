import { Elysia } from 'elysia';

export const healthRoutes = new Elysia().get('/api/health', () => ({
  status: 'ok',
  uptime: Math.round(process.uptime()),
  pid: process.pid,
}));
