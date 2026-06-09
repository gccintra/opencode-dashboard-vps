import { Elysia, t } from 'elysia';
import { signToken, verifyToken } from './jwt';
import { getAuthPassword } from './env';
import { authGuard } from './middleware';

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  // ── POST /api/auth/login ──────────────────────────────────────────
  .post(
    '/login',
    async ({ body, set }) => {
      if (body.password !== getAuthPassword()) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }

      const token = await signToken();
      return { token };
    },
    {
      body: t.Object({
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // ── GET /api/auth/verify ──────────────────────────────────────────
  .get('/verify', async ({ set, request }) => {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    try {
      await verifyToken(token);
      return { valid: true };
    } catch {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })

  // ── Protected routes ──────────────────────────────────────────────
  .guard(authGuard, (app) =>
    app.get('/protected', () => ({
      message: 'authenticated',
    })),
  );
