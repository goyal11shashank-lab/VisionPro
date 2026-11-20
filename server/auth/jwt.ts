import jwt from 'jsonwebtoken';

// SECURITY: authentication tokens must be signed with a deployment-specific secret.
// FAIL CLOSED: the server refuses to start when JWT_SECRET is not configured (unset,
// empty, or whitespace-only). The previous built-in fallback secret is publicly visible
// in source control and has been removed; any deployment that relied on it must set
// JWT_SECRET before starting.
// NOTE: production was verified to have JWT_SECRET configured (non-empty, non-placeholder)
// before this change was prepared, so fail-closed startup does not lock it out.
// The configured secret is used verbatim for signing/verification (only the emptiness
// check trims), so existing tokens signed with the configured value remain valid.
const configuredJwtSecret = process.env.JWT_SECRET;

if (!configuredJwtSecret || !configuredJwtSecret.trim()) {
  throw new Error('[SECURITY] JWT_SECRET environment variable is not set. Refusing to start: set a deployment-specific JWT_SECRET before launching the server.');
}

const JWT_SECRET: string = configuredJwtSecret;
const DEFAULT_EXPIRATION = '8h';

export interface AuthJwtPayload {
  userId: string;
  username: string;
  email?: string | null;
  isSuperAdmin: boolean;
  businessId?: string | null;
}

export function generateAuthToken(payload: AuthJwtPayload, expiresIn: string = DEFAULT_EXPIRATION): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyAuthToken(token: string): AuthJwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthJwtPayload;
  } catch (error: any) {
    throw new Error('Invalid or expired authentication token');
  }
}
