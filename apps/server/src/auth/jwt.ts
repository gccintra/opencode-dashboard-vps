import { SignJWT, jwtVerify } from 'jose';
import { getJwtExpiry, getJwtSecret } from './env';

function getSecret(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

/**
 * Sign a JWT with a minimal session payload.
 * Uses HS256 algorithm with expiry from JWT_EXPIRY config.
 */
export async function signToken(): Promise<string> {
  return new SignJWT({ sub: 'dashboard' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(getJwtExpiry())
    .sign(getSecret());
}

/**
 * Verify a JWT and return its payload.
 * Throws on invalid signature, expired token, or malformed input.
 */
export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload;
}
