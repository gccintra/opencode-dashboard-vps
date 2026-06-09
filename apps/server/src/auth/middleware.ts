import { verifyToken } from './jwt';

/**
 * Auth guard configuration for Elysia's .guard() method.
 *
 * Usage:
 *   import { authGuard } from './auth/middleware';
 *   app.guard(authGuard, (app) => app.get('/api/protected', () => ...));
 */
export const authGuard = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async beforeHandle({ set, request }: any) {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    try {
      await verifyToken(token);
    } catch {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  },
};
