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

export const STAFF_SINGLE_BUSINESS_BODY = {
  success: false,
  error: 'STAFF_SINGLE_BUSINESS',
  message: 'This login belongs to one business only.',
};
