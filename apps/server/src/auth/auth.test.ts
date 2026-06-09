import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elysia } from 'elysia';

// ── env validation tests ──────────────────────────────────────────────────

describe('env validation', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    // Reset modules so env.ts re-evaluates with new process.env
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.AUTH_PASSWORD;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRY;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('exits when AUTH_PASSWORD is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    process.env.JWT_SECRET = 'test-secret';
    const { validateAuthEnv } = await import('./env');
    validateAuthEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits when JWT_SECRET is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    process.env.AUTH_PASSWORD = 'test-pass';
    const { validateAuthEnv } = await import('./env');
    validateAuthEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits when both are missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const { validateAuthEnv } = await import('./env');
    validateAuthEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('succeeds when both are present', async () => {
    process.env.AUTH_PASSWORD = 'test-pass';
    process.env.JWT_SECRET = 'test-secret';
    const { validateAuthEnv } = await import('./env');
    expect(() => validateAuthEnv()).not.toThrow();
  });

  it('uses default JWT_EXPIRY of 7d when not set', async () => {
    process.env.AUTH_PASSWORD = 'test-pass';
    process.env.JWT_SECRET = 'test-secret';
    const { getJwtExpiry, validateAuthEnv } = await import('./env');
    validateAuthEnv();
    expect(getJwtExpiry()).toBe('7d');
  });

  it('uses custom JWT_EXPIRY when set', async () => {
    process.env.AUTH_PASSWORD = 'test-pass';
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRY = '2h';
    const { getJwtExpiry, validateAuthEnv } = await import('./env');
    validateAuthEnv();
    expect(getJwtExpiry()).toBe('2h');
  });
});

// ── auth routes integration tests ─────────────────────────────────────────

describe('auth routes', () => {
  const OLD_ENV = { ...process.env };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AUTH_PASSWORD = 'correct-password';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.JWT_EXPIRY = '7d';

    // Validate and set up the env
    const { validateAuthEnv } = await import('./env');
    validateAuthEnv();

    // Build the app
    const { authRoutes } = await import('./index');
    app = new Elysia().use(authRoutes);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  // ── POST /api/auth/login ───────────────────────────────────────────────
  describe('POST /api/auth/login', () => {
    it('returns a token with correct password', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'correct-password' }),
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      expect(body.token.split('.').length).toBe(3);
    });

    it('returns 401 with wrong password', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'wrong-password' }),
        }),
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid credentials');
      expect(body.error).not.toContain('wrong');
      expect(body.error).not.toContain('correct');
    });

    it('returns 401 with empty password (validated as minLength)', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: '' }),
        }),
      );

      // Elysia t.String({ minLength: 1 }) returns 422 for empty string
      expect(res.status).toBe(422);
    });

    it('returns 422 when password field is missing', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(422);
    });
  });

  // ── GET /api/auth/verify ────────────────────────────────────────────────
  describe('GET /api/auth/verify', () => {
    async function getValidToken(): Promise<string> {
      const loginRes = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'correct-password' }),
        }),
      );
      const { token } = (await loginRes.json()) as { token: string };
      return token;
    }

    it('returns valid:true with a valid token', async () => {
      const token = await getValidToken();
      const res = await app.handle(
        new Request('http://localhost/api/auth/verify', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { valid: boolean };
      expect(body.valid).toBe(true);
    });

    it('returns 401 without Authorization header', async () => {
      const res = await app.handle(new Request('http://localhost/api/auth/verify'));

      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed token', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/verify', {
          headers: { Authorization: 'Bearer not.a.valid.jwt' },
        }),
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 with expired token', async () => {
      const { getJwtSecret } = await import('./env');
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(getJwtSecret());
      const expiredToken = await new SignJWT({ sub: 'dashboard' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(-1)
        .sign(secret);

      // Brief delay to ensure token is past its expiry
      await new Promise((r) => setTimeout(r, 50));

      const res = await app.handle(
        new Request('http://localhost/api/auth/verify', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 with token signed by a different secret', async () => {
      const { SignJWT } = await import('jose');
      const wrongSecret = new TextEncoder().encode('different-secret-that-does-not-match');
      const badToken = await new SignJWT({ sub: 'dashboard' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(wrongSecret);

      const res = await app.handle(
        new Request('http://localhost/api/auth/verify', {
          headers: { Authorization: `Bearer ${badToken}` },
        }),
      );

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/auth/protected ─────────────────────────────────────────────
  describe('GET /api/auth/protected', () => {
    async function getValidToken(): Promise<string> {
      const loginRes = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'correct-password' }),
        }),
      );
      const { token } = (await loginRes.json()) as { token: string };
      return token;
    }

    it('returns 401 without token', async () => {
      const res = await app.handle(new Request('http://localhost/api/auth/protected'));

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 200 with valid token', async () => {
      const token = await getValidToken();
      const res = await app.handle(
        new Request('http://localhost/api/auth/protected', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe('authenticated');
    });

    it('returns 401 with expired token', async () => {
      const { getJwtSecret } = await import('./env');
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(getJwtSecret());
      const expiredToken = await new SignJWT({ sub: 'dashboard' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(-1)
        .sign(secret);

      await new Promise((r) => setTimeout(r, 50));

      const res = await app.handle(
        new Request('http://localhost/api/auth/protected', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed Bearer token', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/protected', {
          headers: { Authorization: 'Bearer garbage' },
        }),
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 with empty Bearer header', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/protected', {
          headers: { Authorization: 'Bearer ' },
        }),
      );

      expect(res.status).toBe(401);
    });
  });
});
