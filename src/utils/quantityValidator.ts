/**
 * Canonical Unit-Aware Quantity Validator (Frontend)
 * 
 * Rules:
 * - PRS: Multiples of 0.5 (e.g., 0.5, 1.0, 1.5, 2.0).
 * - PCS: Whole positive integers (e.g., 1, 2, 3).
 * - Must be strictly positive (> 0) unless `allowZero` is explicitly enabled.
 * - Negative values are strictly rejected.
 */

export interface QuantityValidationResult {
  valid: boolean;
  error?: string;
  normalizedQuantity?: number;
}

export interface QuantityValidationOptions {
  allowZero?: boolean;
  fieldName?: string;
}

export function validateQuantity(
  quantity: number | string | undefined | null,
  unit?: string | null,
  options?: QuantityValidationOptions
): QuantityValidationResult {
  const fieldName = options?.fieldName || 'Quantity';

  if (quantity === undefined || quantity === null || String(quantity).trim() === '') {
    return { valid: false, error: `${fieldName} is required.` };
  }

  const num = typeof quantity === 'number' ? quantity : parseFloat(String(quantity).trim());

  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a valid numeric value.` };
  }

  if (options?.allowZero && Math.abs(num) < 0.0001) {
    return { valid: true, normalizedQuantity: 0 };
  }

  if (num <= 0) {
    return { valid: false, error: `${fieldName} must be greater than zero.` };
  }

  const normUnit = (unit || 'PRS').trim().toUpperCase();

  if (normUnit === 'PCS') {
    const isWhole = Math.abs(num - Math.round(num)) < 0.0001;
    if (!isWhole) {
      return {
        valid: false,
        error: `${fieldName} must be a whole number of PCS (e.g. 1, 2, 3).`,
      };
    }
    return { valid: true, normalizedQuantity: Math.round(num) };
  }

  // Default PRS rule
  const isMultipleOfHalf = Math.abs(Math.round(num * 2) - num * 2) < 0.0001;
  if (!isMultipleOfHalf) {
    return {
      valid: false,
      error: `${fieldName} must be in multiples of 0.5 PRS (e.g. 0.5, 1.0, 1.5, 2.0).`,
    };
  }

  return { valid: true, normalizedQuantity: Math.round(num * 2) / 2 };
}
