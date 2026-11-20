import type { Business } from '../types/index.js';

const opticalBusinessId = 'c43b93ef-8569-4857-80ff-faca53b4ed7c';
export const usesOpticalPrintBrand = (business: Business | null) => business?.id === opticalBusinessId;

// Output-only alias requested by the owner. Never send this view to a save API.
export function printBusinessView(business: Business | null): Business | null {
  if (!usesOpticalPrintBrand(business)) return business;
  return { ...business!, name: 'Optical Shop', tradeName: '', addressLine1: 'Delhi',
    addressLine2: '', city: '', state: '', pincode: '', phone: '', email: '', pan: '' };
}
