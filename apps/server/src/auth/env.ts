/**
 * Environment variable provider for auth.
 * Values are validated lazily via validateAuthEnv() called at server startup.
 * If validation fails, the server exits before listening on any port.
 */

let _password: string | null = null;
let _secret: string | null = null;
let _expiry: string | null = null;

/**
 * Validate that required auth env vars exist. Must be called once at startup.
 * Throws (or exits) if AUTH_PASSWORD or JWT_SECRET are missing.
 */
export function validateAuthEnv(): void {
  const missing: string[] = [];

  const pw = process.env.AUTH_PASSWORD;
  if (!pw || pw.trim() === '') missing.push('AUTH_PASSWORD');
  else _password = pw;

  const sec = process.env.JWT_SECRET;
  if (!sec || sec.trim() === '') missing.push('JWT_SECRET');
  else _secret = sec;

  _expiry = process.env.JWT_EXPIRY || '7d';

  if (missing.length > 0) {
    const msg = `[auth] Missing required environment variables: ${missing.join(', ')}. Add them to your .env file.`;
    console.error(msg);
    process.exit(1);
  }
}

/** Password required to obtain a JWT token. Only valid after validateAuthEnv(). */
export function getAuthPassword(): string {
  if (!_password) throw new Error('[auth] Auth not initialized. Call validateAuthEnv() first.');
  return _password;
}

/** Secret key for signing/verifying JWTs. Only valid after validateAuthEnv(). */
export function getJwtSecret(): string {
  if (!_secret) throw new Error('[auth] Auth not initialized. Call validateAuthEnv() first.');
  return _secret;
}

/** JWT expiry string. Always returns a value (defaults to '7d'). */
export function getJwtExpiry(): string {
  return _expiry || '7d';
}
