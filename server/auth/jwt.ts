import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'optical-billing-erp-system-production-secret-2026';
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
