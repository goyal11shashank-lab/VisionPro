/**
 * Utility for formatting optical quantities and currency with exact precision.
 * Optical lenses are tracked in pairs (PRS) or pieces, with standard increments of 0.5, 1, 1.5, 2.
 * Ensures numbers are displayed cleanly (e.g. "0.5", "1", "1.5", "-2") and NEVER "1.500000" or "0.499999999".
 */

export function roundOpticalQty(val: number | null | undefined): number {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 10000) / 10000;
}

export function formatQuantity(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '0';
  const n = Number(val);
  const rounded = Math.round((n + Number.EPSILON) * 10000) / 10000;
  return rounded.toString();
}

export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '0.00';
  return Number(val).toFixed(2);
}
