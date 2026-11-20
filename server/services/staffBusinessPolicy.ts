/**
 * Owner rule (Nov 20, 2026): one staff member, one business.
 * A non-super login that still holds several access rows keeps the business already flagged as its
 * default. No row is changed and no business is chosen here: if there is not exactly one default
 * row the mapping is ambiguous, so nothing is restricted and the owner has to decide.
 */
export interface StaffAccessRow { businessId: string; isDefault: boolean }

export function staffOwnBusinessId(rows: StaffAccessRow[]): string | null {
  if (rows.length <= 1) return null;
  const defaults = rows.filter(r => r.isDefault);
  return defaults.length === 1 ? defaults[0].businessId : null;
}

/** More than one access row without exactly one default: which business the login belongs to is unknown, so it is blocked until an administrator fixes the assignment. */
export function staffAccessAmbiguous(rows: StaffAccessRow[]): boolean {
  return rows.length > 1 && rows.filter(r => r.isDefault).length !== 1;
}

export const STAFF_ACCOUNT_CONFIGURATION_BODY = {
  success: false,
  error: 'ACCOUNT_CONFIGURATION',
  message: 'This login is not set up correctly. Please contact your administrator.',
};

export const STAFF_SINGLE_BUSINESS_BODY = {
  success: false,
  error: 'STAFF_SINGLE_BUSINESS',
  message: 'This login belongs to one business only.',
};
