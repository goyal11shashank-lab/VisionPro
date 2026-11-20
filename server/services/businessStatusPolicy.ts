/**
 * Business status access policy (owner decision, Nov 20, 2026):
 * when a Business is INACTIVE (or otherwise not ACTIVE), its staff lose access:
 * they cannot log in and cannot make new entries, and the business is hidden
 * from their business dropdown. Historical data is preserved (super admin
 * retains full read/manage access).
 *
 * This module is the single source of truth for that rule; it is enforced
 * per-request in server/middleware/auth.ts (blocks entries for existing
 * sessions) and at login in server/routes/auth.ts (immediate feedback, no
 * token issued bound to an inactive business).
 */

export interface BusinessStatusLike {
  id: string;
  name?: string;
  status?: string;
}

export function businessUsableByStaff(business: BusinessStatusLike | null | undefined): boolean {
  return !!business && business.status === 'ACTIVE';
}

export const BUSINESS_INACTIVE_ERROR = 'BUSINESS_INACTIVE';

export function businessInactiveMessage(business: BusinessStatusLike | null | undefined): string {
  const label = business?.name ? `"${business.name}"` : 'This business';
  return `${label} is inactive. New logins and entries are stopped. Please contact the Super Administrator.`;
}

export function businessInactiveBody(business: BusinessStatusLike | null | undefined) {
  return {
    success: false,
    error: BUSINESS_INACTIVE_ERROR,
    message: businessInactiveMessage(business),
  };
}
